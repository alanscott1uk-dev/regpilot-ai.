import {brokerOrigin} from './hosted-oauth';
import {checkedJson} from '../services/http';

export type ModelAccount={key:string;integration:string;connectionId:string;provider:'openai'|'anthropic';model:string};
export async function generateCustomerDraft(account:ModelAccount,system:string,prompt:string,schema:unknown,fetcher:typeof fetch=fetch){
 const openai=account.provider==='openai';
 const instruction=system+'\nRespond with one JSON object satisfying this schema:\n'+JSON.stringify(schema);
 const body=openai?{model:account.model,store:false,max_completion_tokens:3500,response_format:{type:'json_object'},messages:[{role:'system',content:instruction},{role:'user',content:prompt}]}:
 {model:account.model,max_tokens:3500,system:instruction,messages:[{role:'user',content:prompt}]};
 const response=await fetcher(brokerOrigin+'/proxy/v1/'+(openai?'chat/completions':'messages'),{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(40000),
  headers:{Authorization:'Bearer '+account.key,'Provider-Config-Key':account.integration,'Connection-Id':account.connectionId,Retries:'0','Content-Type':'application/json',...(openai?{}:{'Nango-Proxy-anthropic-version':'2023-06-01'})},body:JSON.stringify(body)});
 const result=await checkedJson(response,80000);
 const text=openai?(result.choices?.length===1&&result.choices[0].finish_reason==='stop'?result.choices[0].message?.content:null):
  (result.stop_reason==='end_turn'&&result.content?.length===1&&result.content[0].type==='text'?result.content[0].text:null);
 if(typeof text!=='string')throw Error('Incomplete provider response');
 return {output:JSON.parse(text),usage:{inputTokens:result.usage?.prompt_tokens??result.usage?.input_tokens??null,outputTokens:result.usage?.completion_tokens??result.usage?.output_tokens??null}};
}
