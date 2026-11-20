import {customerApiOpenApi} from '../../../../lib/customer-api-openapi';
import {customerApiReply} from '../../../../lib/server/customer-api-http';
export const runtime='nodejs',dynamic='force-dynamic';
export function GET(){return customerApiReply(customerApiOpenApi);}
