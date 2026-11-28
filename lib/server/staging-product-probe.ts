import type {Prisma} from '@prisma/client';
import {pilotReceipt,type PilotWindow} from '../pilot-receipt';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pdConfig} from '../connectors/pipedream-client';
import {pdApp,pdAction,pdAccount,readProduct} from '../connectors/pipedream';
import {recipeFor} from '../connectors/product-recipes';
import {CollectionError} from '../connectors/collection-error';
import {githubInventoryLabels,githubInventoryRevision} from '../connectors/github-inventory-checks';

const targetSchema=z.object({org:z.uuid(),account:pdAccount,app:pdApp,action:pdAction}).strict();

export function stagingProbeTarget(){
 const selected=process.env.REGPILOT_PIPEDREAM_STAGING_PROBE;
 if(!selected||process.env.VERCEL_ENV!=='preview')return null;
 const config=pdConfig();
 if(config?.environment!=='development')return null;
 const target=targetSchema.parse(JSON.parse(selected));
 const recipe=recipeFor(target.app,target.action);
 if(!recipe)throw new CollectionError('INVALID_TARGET');
 const scopeHash=createHash('sha256').update(JSON.stringify([config.project,config.environment,target.org,target.account,recipe.app,recipe.action,recipe.version])).digest('hex');
 const policyRevision=recipe.app==='github'&&recipe.action==='list-repositories'?githubInventoryRevision:0;
 return {org:target.org,account:target.account,recipe,scopeHash,policyRevision};
}

export async function runStagingProductProbe(target:NonNullable<ReturnType<typeof stagingProbeTarget>>,fetcher:typeof fetch=fetch){
 const {scopeHash,recipe}=target;
 const metadata={scopeHash,policyRevision:target.policyRevision,app:recipe.app,action:recipe.action,version:recipe.version};
 try{
  const {count,digest,providerHealth,policyChecks}=await readProduct(target.org,target.account,recipe,fetcher);
  const checks=policyChecks?.map(({id,status})=>({id,status}));
  return {...metadata,count,digest,providerHealth,...(checks?{checks}:{}),state:'read' as const,checkedAt:new Date().toISOString()};
 }catch(error){
  return {...metadata,state:'attention' as const,code:error instanceof CollectionError?error.code:'INVALID_RESPONSE',
   step:error instanceof CollectionError?error.step??'grant':'grant',checkedAt:new Date().toISOString()};
 }
}

const checkSchema=z.object({id:z.string().refine(id=>githubInventoryLabels.has(id)),status:z.enum(['PASS','FAIL','UNKNOWN'])});
const receiptSchema=z.discriminatedUnion('state',[
 z.object({state:z.literal('read'),checkedAt:z.iso.datetime(),count:z.number().int().nonnegative(),digest:z.string().regex(/^[a-f0-9]{64}$/),checks:z.array(checkSchema).max(githubInventoryLabels.size).optional(),providerHealth:z.boolean().nullable().optional(),inventory:z.enum(['first','unchanged','changed']).optional()}),
 z.object({state:z.literal('attention'),checkedAt:z.iso.datetime(),code:z.string().regex(/^[A-Z_]{2,40}$/)})
]);

/** Only the organisation whose account was authorised can see the retained worker readings. */
export async function stagingProductHistory(org:string){
 const target=stagingProbeTarget();
 if(!target||target.org!==org)return null;
 const {db}=await import('./db');
 const now=Date.now(),day=86400000;
 const midnight=Math.floor(now/day)*day,yesterday=midnight-day;
 // A worker can start before midnight and finish its read inside the reporting window.
 const since=new Date(yesterday-180000);
 const runs=await db.workerRun.findMany({where:{slot:0,startedAt:{gte:since},finishedAt:{not:null},
  summary:{path:['stagingProduct','scopeHash'],equals:target.scopeHash}},
  orderBy:{startedAt:'desc'},select:{summary:true,startedAt:true,finishedAt:true}});
 const receipts=runs.flatMap(r=>{
  const row=z.object({stagingProduct:receiptSchema}).safeParse(r.summary);
  if(!row.success||!r.finishedAt)return [];
  const item=row.data.stagingProduct,time=Date.parse(item.checkedAt);
  return time>=r.startedAt.getTime()-1000&&time<=r.finishedAt.getTime()+1000?[item]:[];
 });
 receipts.sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
 const previous=receipts.filter(r=>Date.parse(r.checkedAt)>=yesterday&&Date.parse(r.checkedAt)<midnight);
 const priorReads=previous.filter(r=>r.state==='read');
 const observed=new Set(priorReads.map(r=>r.checkedAt.slice(11,13)));
 const previousDay={date:new Date(yesterday).toISOString().slice(0,10),hours:observed.size,
  missing:Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).filter(h=>!observed.has(h)),
  failures:previous.filter(r=>r.state==='attention').length,providerWarnings:priorReads.filter(r=>r.providerHealth===false).length,
  changed:priorReads.filter(r=>r.inventory==='changed').length};
 const rolling=receipts.filter(r=>Date.parse(r.checkedAt)>=now-day&&Date.parse(r.checkedAt)<=now);
 const reads=rolling.filter(r=>r.state==='read');
 const last=reads[0],latest=rolling[0];
 return {previousDay,providerHealth:last?.providerHealth??null,product:target.recipe.name,action:target.recipe.action,hours:new Set(reads.map(r=>r.checkedAt.slice(0,13))).size,
  checks:last?.checks?.map(c=>({id:c.id,status:c.status,label:githubInventoryLabels.get(c.id)!}))??[],
  reads:reads.length,lastReadAt:last?.checkedAt??null,count:last?.count??null,latestError:latest?.state==='attention'?latest.code:null};
}
export type StagingProductHistory=NonNullable<Awaited<ReturnType<typeof stagingProductHistory>>>;

/** Select only a completed upstream read inside the requested UTC day and authorised account. */
export async function trialPilotReceipt(tx:Prisma.TransactionClient,org:string,window:PilotWindow,now=Date.now()){
 const target=stagingProbeTarget();
 if(!target||target.org!==org||target.recipe.app!=='github'||target.recipe.action!=='list-repositories')return null;
 const day=86400000,start=Math.floor(now/day)*day-(window==='previous_day'?day:0);
 const from=new Date(start).toISOString(),until=new Date(start+day).toISOString();
 const rows=await tx.workerRun.findMany({where:{slot:0,finishedAt:{not:null},AND:[
  {summary:{path:['stagingProduct','scopeHash'],equals:target.scopeHash}},
  {summary:{path:['stagingProduct','state'],equals:'read'}},
  {summary:{path:['stagingProduct','app'],equals:'github'}},
  {summary:{path:['stagingProduct','action'],equals:'list-repositories'}},
  {summary:{path:['stagingProduct','checkedAt'],gte:from}},
  {summary:{path:['stagingProduct','checkedAt'],lt:until}}
 ]},orderBy:[{startedAt:'desc'},{id:'desc'}],select:{id:true,startedAt:true,finishedAt:true,summary:true,codeCommit:true}});
 const receipts=rows.flatMap(row=>{
  const parsed=z.object({stagingProduct:receiptSchema}).safeParse(row.summary);
  if(!parsed.success||parsed.data.stagingProduct.state!=='read')return [];
  const r=parsed.data.stagingProduct,time=Date.parse(r.checkedAt);
  if(!row.finishedAt||time>now||time<row.startedAt.getTime()-1000||time>row.finishedAt.getTime()+1000)return [];
  return [pilotReceipt.parse({id:row.id,checkedAt:r.checkedAt,revision:row.codeCommit,action:'list-repositories',
   count:r.count,digest:r.digest,providerHealth:r.providerHealth??null,
   checks:(r.checks??[]).map(c=>({...c,label:githubInventoryLabels.get(c.id)!}))})];
 });
 return receipts.sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0]??null;
}
