import {auditFileResponse} from "../../../../../../lib/server/audit-file-response";
import {verifyAiIdentity} from "../../../../../../lib/server/ai-auth";
import {fail,validId} from "../../../../../../lib/server/operations-http";
import {downloadAuditEvidence} from "../../../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(request:Request,{params}:{params:Promise<{id:string;evidenceId:string}>}){
 try{
  const identity=await verifyAiIdentity(request),p=await params;
  const file=await downloadAuditEvidence(identity,validId(p.id),validId(p.evidenceId));
  return auditFileResponse(file,request.signal,true);
 }catch(e){return fail(e);}
}
