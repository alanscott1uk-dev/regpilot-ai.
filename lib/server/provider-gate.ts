import type {Prisma,ProviderPermit} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {db} from './db';

const PROVIDERS=['GITHUB','MICROSOFT365','GOOGLE_WORKSPACE','GITLAB','CLOUDFLARE','COMPANIES_HOUSE','VERCEL','SUPABASE'];
const CAPACITY=4,LEASE_MS=90000,FAILURE_WINDOW_MS=60000;
// Credential errors and tenant-specific quotas must never trip a shared circuit.
const OUTAGES=new Set(['PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE']);
export type ProviderAdmission={allowed:true;permit:ProviderPermit}|{allowed:false;reason:'PROVIDER_BUSY'|'PROVIDER_CIRCUIT_OPEN';retryAt:Date};
async function lock(tx:Prisma.TransactionClient,provider:string){
 if(!PROVIDERS.includes(provider))throw Error('Unsupported provider gate');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(710241115,${PROVIDERS.indexOf(provider)}::integer)`;
 return tx.providerGate.upsert({where:{provider},create:{provider},update:{}});
}
export async function acquireProviderPermit(provider:string,organizationId:string):Promise<ProviderAdmission>{
 const scopeHash=createHash('sha256').update(organizationId).digest('hex');
 return db.$transaction(async tx=>{
  const gate=await lock(tx,provider),now=new Date();
  await tx.providerPermit.deleteMany({where:{provider,expiresAt:{lte:now}}});
  if(gate.openUntil&&gate.openUntil>now)return {allowed:false,reason:'PROVIDER_CIRCUIT_OPEN',retryAt:gate.openUntil};
  if(gate.probeUntil&&gate.probeUntil>now)return {allowed:false,reason:'PROVIDER_CIRCUIT_OPEN',retryAt:gate.probeUntil};
  const probe=!!gate.openUntil;
  const active=await tx.providerPermit.count({where:{provider,expiresAt:{gt:now}}});
  if(active>=(probe?1:CAPACITY))return {allowed:false,reason:'PROVIDER_BUSY',retryAt:new Date(now.getTime()+5000)};
  const token=randomUUID(),expiresAt=new Date(now.getTime()+LEASE_MS);
  // New probe generations fence late results from an expired probe.
  const generation=probe?gate.generation+1:gate.generation;
  if(probe)await tx.providerGate.update({where:{provider},data:{generation,probeToken:token,probeUntil:expiresAt}});
  const permit=await tx.providerPermit.create({data:{token,provider,generation,scopeHash,probe,expiresAt}});
  return {allowed:true,permit};
 },{timeout:10000});
}
export async function settleProviderPermit(permit:ProviderPermit,outcome:'SUCCESS'|'NEUTRAL'|string){
 return db.$transaction(async tx=>{
  const gate=await lock(tx,permit.provider),now=new Date();
  const removed=await tx.providerPermit.deleteMany({where:{token:permit.token,provider:permit.provider,generation:permit.generation,expiresAt:{gt:now}}});
  if(!removed.count||gate.generation!==permit.generation)return;
  const outage=OUTAGES.has(outcome);
  if(permit.probe){
   if(gate.probeToken!==permit.token)return;
   if(outcome==='SUCCESS'){
    await tx.providerGate.update({where:{provider:permit.provider},data:{generation:{increment:1},failures:0,failureScopes:[],lastFailureAt:null,trips:0,openUntil:null,probeToken:null,probeUntil:null}});return;
   }
   // Unrelated errors are not proof of recovery; try another probe after a short delay.
   const trips=outage?Math.min(10,gate.trips+1):gate.trips;
   await tx.providerGate.update({where:{provider:permit.provider},data:{generation:{increment:1},trips,openUntil:new Date(now.getTime()+(outage?Math.min(900000,60000*2**Math.max(0,trips-1)):30000)),probeToken:null,probeUntil:null}});return;
  }
  if(!outage)return;
  const scopes=(Array.isArray(gate.failureScopes)?gate.failureScopes:[]).filter((s):s is {hash:string;at:number}=>!!s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.hash==='string'&&typeof s.at==='number'&&now.getTime()-s.at<FAILURE_WINDOW_MS&&s.hash!==permit.scopeHash);
  scopes.push({hash:permit.scopeHash,at:now.getTime()});
  const failureScopes=scopes.slice(-3),failures=failureScopes.length;
  // Require failures in three distinct workspaces. One broken account cannot
  // turn off a provider for every other customer.
  if(failures<3){await tx.providerGate.update({where:{provider:permit.provider},data:{failures,failureScopes,lastFailureAt:now}});return;}
  const trips=Math.min(10,gate.trips+1);
  await tx.providerGate.update({where:{provider:permit.provider},data:{generation:{increment:1},failures,failureScopes,lastFailureAt:now,trips,openUntil:new Date(now.getTime()+Math.min(900000,60000*2**(trips-1))),probeToken:null,probeUntil:null}});
 },{timeout:10000});
}

export async function providerGateHealth(providers:string[]){
 const rows=await db.providerGate.findMany({where:{provider:{in:providers}}});
 const now=new Date();
 return providers.map(provider=>{const row=rows.find(r=>r.provider===provider);return {provider,state:row?.probeUntil&&row.probeUntil>now?'probing':row?.openUntil?(row.openUntil>now?'open':'awaiting_probe'):'closed',retryAt:row?.openUntil?.toISOString()??null};});
}
