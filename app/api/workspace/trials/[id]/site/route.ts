import {context,fail,readBody,reply,validId} from '../../../../../../lib/server/operations-http';
import {IntelligenceError} from '../../../../../../lib/server/intelligence-service';
import {createHash} from 'node:crypto';
import {auditFileResponse} from '../../../../../../lib/server/audit-file-response';
import {siteInspectionArchive} from '../../../../../../lib/server/site-inspection-archive';
import {recordSiteDecision,siteQualification} from '../../../../../../lib/server/site-qualification-service';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=60;
type Args={params:Promise<{id:string}>};
async function scope(request:Request,args:Args){
 const params=new URL(request.url).searchParams;
 if(params.getAll('organizationId').length!==1)throw new IntelligenceError('Choose one workspace.');
 return {ctx:await context(request,params.get('organizationId'),true),id:validId((await args.params).id)};
}
export async function GET(request:Request,args:Args){
 try{
  const {ctx,id}=await scope(request,args);
  if(new URL(request.url).searchParams.get('download')==='inspection'){
   const zip=await siteInspectionArchive(ctx,id);
   return auditFileResponse({bytes:zip,filename:'regpilot-site-'+id+'.zip',contentType:'application/zip',sha256:createHash('sha256').update(zip).digest('hex')},request.signal);
  }
  const packet=await siteQualification(ctx,id);
  const response=reply(packet);
  if(new URL(request.url).searchParams.get('download')==='1')response.headers.set('Content-Disposition',`attachment; filename="regpilot-site-${id}.json"`);
  return response;
 }catch(e){return fail(e);}
}
export async function POST(request:Request,args:Args){
 try{const {ctx,id}=await scope(request,args);return reply(await recordSiteDecision(ctx,id,await readBody(request,5000)));}
 catch(e){return fail(e);}
}
