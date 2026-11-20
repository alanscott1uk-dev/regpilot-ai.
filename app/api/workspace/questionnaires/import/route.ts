import {context,reply,fail} from '../../../../../lib/server/operations-http';
import {createQuestionnaire} from '../../../../../lib/server/customer-assurance-service';
import {inspectQuestionnaireFile,mapQuestionnaireWorkbook,readQuestionnaireForm,questionnaireFormFile,QuestionnaireWorkbookError} from '../../../../../lib/server/questionnaire-workbook.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

function field(form:FormData,name:string,max:number){
  const values=form.getAll(name);
  if(values.length!==1||typeof values[0]!=='string'||values[0].length>max)throw new QuestionnaireWorkbookError('Check the '+name+' import field.',400);
  return values[0];
}
function json(value:string){try{return JSON.parse(value) as unknown;}catch{throw new QuestionnaireWorkbookError('The import metadata or mapping is not valid JSON.',400);}}

export async function POST(request:Request){
  try{
    const params=new URL(request.url).searchParams;
    if(params.getAll('organizationId').length!==1)return reply({error:'Choose one organisation'},400);
    const ctx=await context(request,params.get('organizationId'),true);
    const form=await readQuestionnaireForm(request);
    if([...form.keys()].some(key=>!['file','metadata','mapping','expectedSha256'].includes(key)))return reply({error:'The import contains an unsupported field'},400);
    const file=questionnaireFormFile(form),metadata=json(field(form,'metadata',4000)),mapping=json(field(form,'mapping',30000)),expected=field(form,'expectedSha256',64);
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).some(key=>!['title','recipient','scope','ownerId','requestKey','confirm'].includes(key)))return reply({error:'Check the questionnaire details'},400);
    if(!/^[a-f0-9]{64}$/.test(expected))return reply({error:'Inspect the questionnaire file before importing'},400);
    const workbook=await inspectQuestionnaireFile(new Uint8Array(await file.arrayBuffer()),file.name);
    if(workbook.sha256!==expected)return reply({error:'The file changed after inspection. Inspect the selected file again.'},409);
    const rows=mapQuestionnaireWorkbook(workbook,mapping);
    const result=await createQuestionnaire(ctx,{...metadata,rows},{verifiedFile:{filename:workbook.filename,sha256:workbook.sha256}});
    return reply(result,result.reused?200:201);
  }catch(error){
    if(error instanceof QuestionnaireWorkbookError)return reply({error:error.message},error.status);
    return fail(error);
  }
}
