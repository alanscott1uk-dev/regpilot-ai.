import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportQuestionnaire} from "../../../../../../lib/server/customer-assurance-service";
import {writeQuestionnaireXlsx,QuestionnaireWorkbookError} from "../../../../../../lib/server/questionnaire-workbook.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(r:Request,p:{params:Promise<{id:string}>}){
 try{
  const params=new URL(r.url).searchParams,c=await context(r,params.get("organizationId"),true),format=params.get("format")||"csv";
  if(params.getAll("format").length>1||!["csv","xlsx"].includes(format))return reply({error:"Choose CSV or XLSX export"},400);
  const value=await exportQuestionnaire(c,validId((await p.params).id));
  if(format==="xlsx")return new Response(new Uint8Array(writeQuestionnaireXlsx(value)),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=questionnaire.xlsx","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  return new Response(value.csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=questionnaire.csv","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){if(e instanceof QuestionnaireWorkbookError)return reply({error:e.message},e.status);return fail(e);}
}
