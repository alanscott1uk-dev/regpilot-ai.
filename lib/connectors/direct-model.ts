import {z} from 'zod';
import {providerReader} from './bounded-http';
import {CollectionError} from './collection-error';
import type {Observation} from './observation';

const modelId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
export const openAiProjectTarget=z.object({scope:z.string().regex(/^proj_[A-Za-z0-9_-]{3,90}$/),record:modelId});
export const privateModelTarget=z.object({scope:z.string().max(100).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/),record:modelId});
export type ModelConnector='OPENAI_PROJECT_MODEL'|'PRIVATE_AI_MODEL';
export function isModelConnector(value:string):value is ModelConnector{return value==='OPENAI_PROJECT_MODEL'||value==='PRIVATE_AI_MODEL';}
export function modelEndpoint(provider:ModelConnector,scope:string,model:string,key:string){
 const headers:Record<string,string>={Authorization:'Bearer '+key};
 if(provider==='OPENAI_PROJECT_MODEL'){
  openAiProjectTarget.parse({scope,record:model});
  headers['OpenAI-Project']=scope;
  return {base:'https://api.openai.com/v1',headers};
 }
 privateModelTarget.parse({scope,record:model});
 if(scope!==process.env.REGPILOT_PRIVATE_MODEL_HOST)throw new CollectionError('INVALID_TARGET');
 return {base:'https://'+scope+'/v1',headers};
}
export async function collectModelAccess(provider:ModelConnector,target:{scope:string;record:string},key:string,fetcher:typeof fetch=fetch):Promise<Observation>{
 const {scope,record}=target;
 const {base,headers}=modelEndpoint(provider,scope,record,key);
 if(provider==='PRIVATE_AI_MODEL'){
  const anonymous=await fetcher(base+'/models',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  await anonymous.body?.cancel();
  if(![401,403].includes(anonymous.status))throw new CollectionError('MODEL_AUTH_UNCONFIRMED');
 }
 const list=provider==='PRIVATE_AI_MODEL',sourceUrl=base+'/models'+(list?'':'/'+encodeURIComponent(record));
 const {body}=(await providerReader(fetcher,headers)(sourceUrl))!;
 const found=list?z.array(z.object({id:z.string()})).max(500).parse(body.data).filter(r=>r.id===record):[body];
 if(found.length!==1||found[0].id!==record||!list&&body.object!=='model')throw new CollectionError('TARGET_MISMATCH');
 return {engine:'model-access-v1',sourceUrl,capturedAt:new Date().toISOString(),checks:[
  {id:'model-access',label:'Credential can read the selected model',status:'PASS',observed:record,nextStep:'Reauthorise this account if model access changes.'}
 ],limitations:['Confirms model visibility with the supplied credential. Generation permission and output quality require a separate inference run.']};
}
