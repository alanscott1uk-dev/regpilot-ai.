import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportQuestionnaire} from "../../../../../../lib/server/customer-assurance-service";
import {writeQuestionnaireXlsx,QuestionnaireWorkbookError} from "../../../../../../lib/server/questionnaire-workbook.mjs";
import {exportQuestionnaireResponsePack} from "../../../../../../lib/server/questionnaire-response-pack-service";
import {verifiedDownloadResponse} from "../../../../../../lib/server/verified-download";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(r:Request,p:{params:Promise<{id:string}>}){
 try{
  const params=new URL(r.url).searchParams;if(params.getAll("organizationId").length!==1)return reply({error:"Choose one organisation"},400);const c=await context(r,params.get("organizationId"),true),format=params.get("format")||"csv";
  if(params.getAll("format").length>1||!["csv","xlsx","zip"].includes(format))return reply({error:"Choose CSV, XLSX or evidence ZIP export"},400);
  const id=validId((await p.params).id);
  if(format==="zip")return await verifiedDownloadResponse(()=>exportQuestionnaireResponsePack(c,id),{filename:"questionnaire-response-pack.zip",contentType:"application/zip",signal:r.signal});
  const value=await exportQuestionnaire(c,id);
  if(format==="xlsx")return await verifiedDownloadResponse(()=>writeQuestionnaireXlsx(value),{filename:"questionnaire.xlsx",contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",signal:r.signal});
  return await verifiedDownloadResponse(()=>Buffer.from(value.csv,'utf8'),{filename:"questionnaire.csv",contentType:"text/csv; charset=utf-8",signal:r.signal});
 }catch(e){if(e instanceof QuestionnaireWorkbookError)return reply({error:e.message},e.status);return fail(e);}
}
