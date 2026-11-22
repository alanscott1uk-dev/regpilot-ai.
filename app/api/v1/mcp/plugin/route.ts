import {makeAuditZip} from '../../../../../lib/audit-archive';
export const runtime='nodejs',dynamic='force-dynamic';
export function GET(request:Request){
 const origin=new URL(request.url).origin;
 const plugin={$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'regpilot-workspace',version:'1.0.0',description:'Read granted RegPilot controls, tasks and reviewed regulatory sources.',author:{name:'RegPilot'}};
 const connection={$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{regpilot:{type:'streamable-http',url:origin+'/api/v1/mcp',extensions:{'com.openai':{auth:{type:'api_key',headerScheme:'bearer'}}}}}};
 const zip=makeAuditZip([{name:'plugin.json',bytes:Buffer.from(JSON.stringify(plugin,null,2))},{name:'mcp.json',bytes:Buffer.from(JSON.stringify(connection,null,2))}]);
 return new Response(new Uint8Array(zip),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="regpilot-workspace-plugin.zip"','Cache-Control':'no-store'}});
}
