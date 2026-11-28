import {context,reply,fail} from '../../../../../lib/server/operations-http';
import {inspectQuestionnaireFile,readQuestionnaireForm,questionnaireFormFile,QuestionnaireWorkbookError} from '../../../../../lib/server/questionnaire-workbook.mjs';
import {inspectQuestionnaireDocument} from '../../../../../lib/server/questionnaire-document';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

export async function POST(request:Request){
  try{
    const params=new URL(request.url).searchParams;
    if(params.getAll('organizationId').length!==1)return reply({error:'Choose one organisation'},400);
    const ctx=await context(request,params.get('organizationId'),true);
    const form=await readQuestionnaireForm(request);
    if([...form.keys()].some(key=>key!=='file'))return reply({error:'Inspection accepts one questionnaire file'},400);
    const file=questionnaireFormFile(form);
    const bytes=new Uint8Array(await file.arrayBuffer()),workbook=await (/\.(pdf|docx)$/i.test(file.name)?inspectQuestionnaireDocument(bytes,file.name):inspectQuestionnaireFile(bytes,file.name));
    return reply({organizationId:ctx.organizationId,...workbook});
  }catch(error){
    if(error instanceof QuestionnaireWorkbookError)return reply({error:error.message},error.status);
    return fail(error);
  }
}
