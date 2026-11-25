import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pdConfig} from '../connectors/pipedream-client';
import {pdApp,pdAction,pdAccount,probeProduct} from '../connectors/pipedream';
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
  const reading=await probeProduct(target.org,target.account,recipe,fetcher);
  return {...metadata,...reading,state:'read' as const,checkedAt:new Date().toISOString()};
 }catch(error){
  return {...metadata,state:'attention' as const,code:error instanceof CollectionError?error.code:'INVALID_RESPONSE',
   step:error instanceof CollectionError?error.step??'grant':'grant',checkedAt:new Date().toISOString()};
 }
}
