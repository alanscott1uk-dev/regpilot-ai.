import {modelEndpoint,type ModelConnector} from './direct-model';
import {brokerOrigin} from './hosted-oauth';
import {checkedJson} from '../services/http';

type BrokerAccount={key:string;integration:string;connectionId:string;provider:'openai'|'anthropic';model:string};
type DirectAccount={transport:'direct';modelConnector:ModelConnector;scope:string;connectionId:string;key:string;provider:'openai'|'private';model:string};
export type ModelAccount=BrokerAccount|DirectAccount;
export async function generateCustomerDraft(account:ModelAccount,system:string,prompt:string,schema:unknown,fetcher:typeof fetch=fetch){
 const openai=account.provider!=='anthropic';
 const instruction=system+'\nRespond with one JSON object satisfying this schema:\n'+JSON.stringify(schema);
 const body=openai?{model:account.model,store:false,max_completion_tokens:3500,response_format:{type:'json_object'},messages:[{role:'system',content:instruction},{role:'user',content:prompt}]}:
 {model:account.model,max_tokens:3500,system:instruction,messages:[{role:'user',content:prompt}]};
 const endpoint='transport' in account?modelEndpoint(account.modelConnector,account.scope,account.model,account.key):{
  base:brokerOrigin+'/proxy/v1',headers:{Authorization:'Bearer '+account.key,'Provider-Config-Key':account.integration,'Connection-Id':account.connectionId,Retries:'0',...(openai?{}:{'Nango-Proxy-anthropic-version':'2023-06-01'})}
 };
 const response=await fetcher(endpoint.base+'/'+(openai?'chat/completions':'messages'),{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(40000),
  headers:{...endpoint.headers,'Content-Type':'application/json'},body:JSON.stringify(account.provider==='private'?{...body,store:undefined,max_completion_tokens:undefined,max_tokens:3500,response_format:{type:'json_schema',json_schema:{name:'regpilot_draft',schema}}}:body)});
 const result=await checkedJson(response,80000);
 const text=openai?(result.choices?.length===1&&result.choices[0].finish_reason==='stop'?result.choices[0].message?.content:null):
  (result.stop_reason==='end_turn'&&result.content?.length===1&&result.content[0].type==='text'?result.content[0].text:null);
 if(typeof text!=='string')throw Error('Incomplete provider response');
 return {output:JSON.parse(text),usage:{inputTokens:result.usage?.prompt_tokens??result.usage?.input_tokens??null,outputTokens:result.usage?.completion_tokens??result.usage?.output_tokens??null}};
}
