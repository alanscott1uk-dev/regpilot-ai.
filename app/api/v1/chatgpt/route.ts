import {customerApiOpenApi} from '../../../../lib/customer-api-openapi';
import {customerApiReply} from '../../../../lib/server/customer-api-http';
export const runtime='nodejs',dynamic='force-dynamic';
export function GET(request:Request){
 const origin=new URL(request.url).origin;
 const allowed=['/controls','/tasks','/regulatory-sources'] as const;
 return customerApiReply({...customerApiOpenApi,info:{title:'RegPilot workspace lookup',version:'1.0.0',description:'Retrieve the controls, tasks and reviewed publication metadata granted to this private workspace credential.'},
  servers:[{url:origin+'/api/v1'}],paths:Object.fromEntries(allowed.map(p=>[p,{get:customerApiOpenApi.paths[p].get}])),
  components:{securitySchemes:customerApiOpenApi.components.securitySchemes,schemas:{Error:customerApiOpenApi.components.schemas.Error}}});
}
