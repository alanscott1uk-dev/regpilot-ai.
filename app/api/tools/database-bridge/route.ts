import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeAuditZip} from '../../../../lib/audit-archive';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(){
 const files=[['database-bridge','watch.py'],['database-bridge','collect.py'],['database-bridge','native_sql.py'],['database-bridge','setup.txt'],['instrument-bridge','deliver.py']];
 const entries=await Promise.all(files.map(async([dir,name])=>({name,bytes:await readFile(join(process.cwd(),'public',dir,name))})));
 return new Response(new Uint8Array(makeAuditZip(entries)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="regpilot-database-bridge.zip"'}});
}
