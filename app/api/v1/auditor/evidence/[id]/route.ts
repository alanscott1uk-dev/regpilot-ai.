import {auditorApiFailure,auditorFile} from "../../../../../../lib/server/auditor-api";
import {auditFileResponse} from "../../../../../../lib/server/audit-file-response";
export const runtime="nodejs", dynamic="force-dynamic", maxDuration=60;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{return auditFileResponse(await auditorFile(request,(await params).id),request.signal);}
  catch(error){return auditorApiFailure(error);}
}
