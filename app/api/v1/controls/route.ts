import {customerApiHandler} from '../../../../lib/server/customer-api-http';
import {listCustomerApiResource} from '../../../../lib/server/customer-api-service';
export const runtime='nodejs',dynamic='force-dynamic';
export function GET(request:Request){return customerApiHandler(request,'controls:read',session=>listCustomerApiResource(session,'controls',request.url));}
