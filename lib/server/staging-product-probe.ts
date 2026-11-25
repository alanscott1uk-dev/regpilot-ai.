import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pdConfig} from '../connectors/pipedream-client';
import {pdApp,pdAction,pdAccount,readProduct} from '../connectors/pipedream';
import {recipeFor} from '../connectors/product-recipes';
import {CollectionError} from '../connectors/collection-error';

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
 return {org:target.org,account:target.account,recipe,scopeHash};
}

export async function runStagingProductProbe(target:NonNullable<ReturnType<typeof stagingProbeTarget>>,fetcher:typeof fetch=fetch){
 const {scopeHash,recipe}=target;
 const metadata={scopeHash,app:recipe.app,action:recipe.action,version:recipe.version};
 try{
  const {count,digest,providerHealth}=await readProduct(target.org,target.account,recipe,fetcher);
  return {...metadata,count,digest,providerHealth,state:'read' as const,checkedAt:new Date().toISOString()};
 }catch(error){
  return {...metadata,state:'attention' as const,code:error instanceof CollectionError?error.code:'INVALID_RESPONSE',
   step:error instanceof CollectionError?error.step??'grant':'grant',checkedAt:new Date().toISOString()};
 }
}

const receiptSchema=z.discriminatedUnion('state',[
 z.object({state:z.literal('read'),checkedAt:z.iso.datetime(),count:z.number().int().nonnegative(),digest:z.string().regex(/^[a-f0-9]{64}$/)}),
 z.object({state:z.literal('attention'),checkedAt:z.iso.datetime(),code:z.string().regex(/^[A-Z_]{2,40}$/)})
]);

/** Only the organisation whose account was authorised can see the retained worker readings. */
export async function stagingProductHistory(org:string){
 const target=stagingProbeTarget();
 if(!target||target.org!==org)return null;
 const {db}=await import('./db');
 const since=new Date(Date.now()-24*3600000);
 const runs=await db.workerRun.findMany({where:{slot:0,startedAt:{gte:since},finishedAt:{not:null},
  summary:{path:['stagingProduct','scopeHash'],equals:target.scopeHash}},
  orderBy:{startedAt:'desc'},take:48,select:{summary:true,startedAt:true,finishedAt:true}});
 const receipts=runs.flatMap(r=>{
  const row=z.object({stagingProduct:receiptSchema}).safeParse(r.summary);
  if(!row.success||!r.finishedAt)return [];
  const item=row.data.stagingProduct,time=Date.parse(item.checkedAt);
  return time>=r.startedAt.getTime()-1000&&time<=r.finishedAt.getTime()+1000?[item]:[];
 });
 const reads=receipts.filter(r=>r.state==='read');
 const last=reads[0],latest=receipts[0];
 return {product:target.recipe.name,action:target.recipe.action,hours:new Set(reads.map(r=>r.checkedAt.slice(0,13))).size,
  reads:reads.length,lastReadAt:last?.checkedAt??null,count:last?.count??null,latestError:latest?.state==='attention'?latest.code:null};
}
export type StagingProductHistory=NonNullable<Awaited<ReturnType<typeof stagingProductHistory>>>;
