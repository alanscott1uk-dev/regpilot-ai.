import {z} from 'zod';
import {publicRegisterHistory,registerStagingEnabled} from '../../../../lib/server/public-register-history';
import {publicRegisters,referenceRegisters} from '../../../../lib/connectors/pharma-registers';
import {evaluateRegisterBatch} from '../../../../lib/connectors/register-benchmark';

export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){
 if(!registerStagingEnabled())return new Response(null,{status:404});
 const params=new URL(request.url).searchParams;
 const id=z.uuid().safeParse(params.get('batch')),provider=z.enum(publicRegisters).safeParse(params.get('provider'));
 if(!id.success||!provider.success)return new Response(null,{status:400});
 try{
  const rows=(await publicRegisterHistory()).filter(row=>row.batch===id.data&&row.provider===provider.data);
  if(!rows.length)return new Response(null,{status:404});
  const target=referenceRegisters.find(r=>r.provider===provider.data)!;
  const receipt=await evaluateRegisterBatch(target,rows);
  return Response.json({format:'regpilot-public-register-v1',provider:target.provider,target:target.target,receipt,sources:rows.map(r=>({
   url:r.url,receivedAt:r.finished_at,httpStatus:r.http_status,metadata:r.metadata,storedMetadataSha256:r.fingerprint,integrityChecked:r.intact
  }))},{headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="'+provider.data+'-'+id.data+'.json"'}});
 }catch{return new Response(null,{status:503});}
}
