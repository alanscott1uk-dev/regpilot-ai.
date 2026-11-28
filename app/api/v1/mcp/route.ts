import {z} from 'zod';
import {authenticateCustomerApi,CustomerApiError} from '../../../../lib/server/customer-api-auth';
import {listCustomerApiResource} from '../../../../lib/server/customer-api-service';
import {readBoundedJson} from '../../../../lib/connectors/bounded-http';
import {IntelligenceError} from '../../../../lib/server/intelligence-service';

export const runtime='nodejs',dynamic='force-dynamic';
const versions=['2025-11-25','2025-06-18','2025-03-26'];
const tools=[
 {name:'list_controls',scope:'controls:read',resource:'controls',description:'Read operating controls granted to this connection.'},
 {name:'list_tasks',scope:'tasks:read',resource:'tasks',description:'Read tasks on granted controls. Optionally select one control.'},
 {name:'list_reviewed_sources',scope:'regulatory:read',resource:'regulatory-sources',description:'Read reviewed regulatory publication metadata for this organisation.'}
] as const;
const page=z.object({limit:z.number().int().min(1).max(25).optional(),cursor:z.string().min(1).max(1500).optional()}).strict();
const taskPage=page.extend({controlId:z.uuid().optional()});
const envelope=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string().max(200),z.number().int()]).optional(),method:z.string().max(100),params:z.record(z.string(),z.unknown()).optional()}).strict();
function failure(id:unknown,status:number,code:number,message:string,headers:Record<string,string>={}){
 return Response.json({jsonrpc:'2.0',id:id??null,error:{code,message}},{status,headers:{'Cache-Control':'no-store',...headers}});
}
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin&&origin!=='https://chatgpt.com')return failure(null,403,-32600,'Invalid request origin');
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return failure(null,415,-32600,'Use application/json');
 const requested=request.headers.get('mcp-protocol-version');
 if(requested&&!versions.includes(requested))return failure(null,400,-32600,'Unsupported protocol version');
 let id:string|number|undefined;
 try{
  const session=await authenticateCustomerApi(request,tools.map(t=>t.scope));
  const raw=await readBoundedJson(new Response(request.body),16384).catch(()=>undefined);
  const parsed=envelope.safeParse(raw);
  if(!parsed.success)return failure(null,400,-32600,'Invalid JSON-RPC request');
  const rpc=parsed.data;id=rpc.id;
  const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store','X-RateLimit-Remaining':String(session.rate.remaining)}});
  if(id===undefined){
   if(rpc.method.startsWith('notifications/'))return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
   return failure(null,400,-32600,'A request identifier is required');
  }
  if(rpc.method==='initialize'){
   const proposed=rpc.params?.protocolVersion;
   return reply({protocolVersion:typeof proposed==='string'&&versions.includes(proposed)?proposed:versions[0],
    capabilities:{tools:{listChanged:false}},serverInfo:{name:'regpilot-workspace',version:'1.0.0'}});
  }
  if(rpc.method==='ping')return reply({});
  const allowed=tools.filter(t=>session.grantedScopes.includes(t.scope));
  if(rpc.method==='tools/list')return reply({tools:allowed.map(t=>({name:t.name,description:t.description,inputSchema:z.toJSONSchema(t.resource==='tasks'?taskPage:page),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}))});
  if(rpc.method!=='tools/call')return failure(id,200,-32601,'Unknown method');
  const tool=allowed.find(t=>t.name===rpc.params?.name);
  if(!tool)return failure(id,200,-32602,'Tool unavailable for this credential');
  const args=(tool.resource==='tasks'?taskPage:page).safeParse(rpc.params?.arguments??{});
  if(!args.success)return failure(id,200,-32602,'Check tool arguments');
  const url=new URL(request.url);
  url.search=new URLSearchParams(Object.entries({...args.data,limit:args.data.limit??10}).map(([k,v])=>[k,String(v)])).toString();
  const result=await listCustomerApiResource(session,tool.resource,url.href);
  return reply({content:[{type:'text',text:JSON.stringify(result)}]});
 }catch(e){
  const status=e instanceof IntelligenceError?e.status:503;
  const headers:Record<string,string>={};
  if(status===401)headers['WWW-Authenticate']='Bearer realm="RegPilot workspace"';
  if(e instanceof CustomerApiError&&e.retryAfter)headers['Retry-After']=String(e.retryAfter);
  return failure(id,status,-32000,e instanceof IntelligenceError?e.message:'Workspace connection unavailable',headers);
 }
}
