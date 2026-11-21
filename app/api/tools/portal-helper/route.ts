import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeAuditZip} from '../../../../lib/audit-archive';
export async function GET(){
 const names=['manifest.json','popup.html','popup.js','fields.js'];
 const entries=await Promise.all(names.map(async name=>({name,bytes:await readFile(join(process.cwd(),'public','portal-helper',name))})));
 return new Response(new Uint8Array(makeAuditZip(entries)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="regpilot-portal-helper.zip"'}});
}
