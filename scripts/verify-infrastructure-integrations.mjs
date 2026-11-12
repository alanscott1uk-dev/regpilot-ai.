/** Optional live read-contract checks. Missing credentials are NOT_CONFIGURED, never verified. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as module from '../lib/connectors/infrastructure.ts';
const {collectVercel,collectSupabase}=module.default||module;
const definitions=[
 {provider:'VERCEL',keys:['REGPILOT_VERCEL_PROJECT_ID','REGPILOT_VERCEL_TEAM_ID','REGPILOT_VERCEL_READ_TOKEN'],collect:(v)=>collectVercel({projectId:v[0],teamId:v[1]},v[2])},
 {provider:'SUPABASE',keys:['REGPILOT_SUPABASE_PROJECT_REF','REGPILOT_SUPABASE_ORGANIZATION_ID','REGPILOT_SUPABASE_READ_TOKEN'],collect:(v)=>collectSupabase({projectRef:v[0],providerOrganizationId:v[1]},v[2])}
];
const reports=[];
for(const d of definitions){
 const values=d.keys.map(k=>process.env[k]||'');let state='NOT_CONFIGURED',checks=null,hash=null;
 if(values.some(Boolean))try{
  if(values.some(v=>!v))throw Error('incomplete configuration');
  const result=await d.collect(values);state='READ_CONTRACT_VERIFIED';checks=Object.fromEntries(['PASS','FAIL','UNKNOWN'].map(s=>[s,result.checks.filter(c=>c.status===s).length]));hash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
 }catch{state='READ_CONTRACT_FAILED';process.exitCode=1;}
 reports.push({provider:d.provider,state,checks,observationHash:hash});
}
const report={format:'regpilot-infrastructure-contract-v1',checkedAt:new Date().toISOString(),reports,limitation:'Read-contract verification does not approve security or compliance. Unknown checks require review. No targets, secrets or raw responses are published.'};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/infrastructure-contracts.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
