import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeAuditZip} from '../../../../lib/audit-archive';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const {origin,protocol,hostname}=new URL(request.url);
 if(protocol!=='https:'&&!(protocol==='http:'&&['localhost','127.0.0.1'].includes(hostname)))return new Response('Use HTTPS to download the helper.',{status:400});
 const names=['manifest.json','popup.html','popup.js','fields.js','worker.js','bridge.js'];
 const entries=await Promise.all(names.map(async name=>{
  let bytes=await readFile(join(process.cwd(),'public','portal-helper',name));
  if(name==='manifest.json'){
   const manifest=JSON.parse(bytes.toString('utf8'));
   manifest.homepage_url=origin+'/team/questionnaires';manifest.externally_connectable={matches:[protocol+'//'+hostname+'/*']};
   bytes=Buffer.from(JSON.stringify(manifest,null,2));
  }
  return {name,bytes};
 }));
 const archive=makeAuditZip(entries),digest=createHash('sha256').update(archive).digest();
 const etag='"'+digest.toString('hex')+'"';
 const headers={'ETag':etag,'Content-Digest':'sha-256=:'+digest.toString('base64')+':','Cache-Control':'private, no-cache'};
 if(request.headers.get('if-none-match')?.split(',').some(tag=>tag.trim().replace(/^W\//,'')===etag||tag.trim()==='*'))
  return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':headers['Cache-Control']}});
 return new Response(new Uint8Array(archive),{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="regpilot-portal-helper.zip"'}});
}
