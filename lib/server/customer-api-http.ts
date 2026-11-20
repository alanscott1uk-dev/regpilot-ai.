import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {CUSTOMER_API_VERSION,type CustomerApiScope} from '../customer-api';
import {IntelligenceError} from './intelligence-service';
import {authenticateCustomerApi,CustomerApiError,type CustomerApiSession} from './customer-api-auth';

export function customerApiReply(value:unknown,status=200,requestId=randomUUID(),session?:CustomerApiSession){
 const headers:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-RegPilot-API-Version':CUSTOMER_API_VERSION,'X-Request-Id':requestId};
 if(session){headers['X-RateLimit-Limit']=String(session.rate.limit);headers['X-RateLimit-Remaining']=String(session.rate.remaining);headers['X-RateLimit-Reset']=String(session.rate.reset);}
 return NextResponse.json(value,{status,headers});
}
export async function customerApiHandler(request:Request,scope:CustomerApiScope,run:(session:CustomerApiSession)=>Promise<unknown>,status=200){
 const requestId=randomUUID();let session:CustomerApiSession|undefined;
 try{session=await authenticateCustomerApi(request,scope);return customerApiReply(await run(session),status,requestId,session);}
 catch(error){
  const known=error instanceof IntelligenceError,invalid=error instanceof z.ZodError||error instanceof SyntaxError;
  const response=customerApiReply({error:{code:error instanceof CustomerApiError?error.code:invalid?'invalid_request':known?'request_rejected':'service_unavailable',message:invalid?'Check the request fields and JSON format':known?error.message:'The customer API is temporarily unavailable'},requestId},known?error.status:invalid?400:503,requestId,session);
  if(error instanceof CustomerApiError&&error.retryAfter)response.headers.set('Retry-After',String(error.retryAfter));
  if(response.status===401)response.headers.set('WWW-Authenticate','Bearer realm="RegPilot customer API"');
  return response;
 }
}
