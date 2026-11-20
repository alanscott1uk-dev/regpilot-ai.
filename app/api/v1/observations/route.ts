import {CUSTOMER_API_LIMITS} from '../../../../lib/customer-api';
import {CustomerApiError} from '../../../../lib/server/customer-api-auth';
import {customerApiHandler} from '../../../../lib/server/customer-api-http';
import {readBody} from '../../../../lib/server/intelligence-http';
import {listCustomerApiResource,submitCustomerApiObservation} from '../../../../lib/server/customer-api-service';
export const runtime='nodejs',dynamic='force-dynamic';
export function GET(request:Request){return customerApiHandler(request,'observations:read',session=>listCustomerApiResource(session,'observations',request.url));}
export function POST(request:Request){return customerApiHandler(request,'observations:write',async session=>{if(new URL(request.url).search)throw new CustomerApiError('Observation submissions do not accept query parameters',400,'invalid_query');return submitCustomerApiObservation(session,request.headers.get('Idempotency-Key')||'',await readBody(request,CUSTOMER_API_LIMITS.bodyBytes));},201);}
