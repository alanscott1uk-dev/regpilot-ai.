import {context,validId,reply,fail} from '../../../../../../../lib/server/operations-http';
import {IntelligenceError} from '../../../../../../../lib/server/intelligence-service';
import {retainedValidation,retainValidation,maxValidationArchive} from '../../../../../../../lib/server/retained-validation';
export const runtime='nodejs',dynamic='force-dynamic';
type P={params:Promise<{id:string}>};
export async function GET(req:Request,{params}:P){try{
 const query=new URL(req.url).searchParams,ctx=await context(req,query.get('organizationId'),true),r=await retainedValidation(ctx,validId((await params).id));
 if(query.get('download')!=='1')return reply({revision:r.revision,archive:r.saved?.meta??null});
 if(!r.saved)throw new IntelligenceError('No supplier validation archive is retained for this release.',404);
 return new Response(new Uint8Array(r.saved.bytes),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="regpilot-validation-'+r.revision+'.zip"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return fail(e);}}
export async function POST(req:Request,{params}:P){try{
 const ctx=await context(req,new URL(req.url).searchParams.get('organizationId'),true),id=validId((await params).id);
 if(req.headers.get('content-type')!=='application/zip'||!req.body)throw new IntelligenceError('Choose the original GitHub validation ZIP.',415);
 if(Number(req.headers.get('content-length'))>maxValidationArchive)throw new IntelligenceError('Archive exceeds 256 KiB.',413);
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>maxValidationArchive)throw new IntelligenceError('Archive exceeds 256 KiB.',413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return reply(await retainValidation(ctx,id,Buffer.concat(chunks)));
 }catch(e){return fail(e);}}
