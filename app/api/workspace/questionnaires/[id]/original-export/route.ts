import {context,reply,fail,validId} from '../../../../../../lib/server/operations-http';
import {exportQuestionnaireOriginal} from '../../../../../../lib/server/questionnaire-response-pack-service';
import {readQuestionnaireForm,questionnaireFormFile,QuestionnaireWorkbookError} from '../../../../../../lib/server/questionnaire-workbook.mjs';
import {verifiedDownloadResponse} from '../../../../../../lib/server/verified-download';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(r:Request,p:{params:Promise<{id:string}>}){
 try{
  const params=new URL(r.url).searchParams;if(params.getAll('organizationId').length!==1)return reply({error:'Choose one organisation'},400);
  const c=await context(r,params.get('organizationId'),true),id=validId((await p.params).id),form=await readQuestionnaireForm(r);
  if([...form.keys()].some(key=>!['file','mapping','expectedVersion'].includes(key)))return reply({error:'Unsupported original export field'},400);
  const file=questionnaireFormFile(form),mappings=form.getAll('mapping'),versions=form.getAll('expectedVersion');
  if(mappings.length!==1||typeof mappings[0]!=='string'||mappings[0].length>30000||versions.length!==1||typeof versions[0]!=='string'||!/^\d{1,9}$/.test(versions[0]))return reply({error:'Check the answer columns and questionnaire version'},400);
  let mapping;try{mapping=JSON.parse(mappings[0]);}catch{return reply({error:'Answer-column mapping must be valid JSON'},400);}
  const input={bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,mappings:mapping,expectedVersion:Number(versions[0])};
  return await verifiedDownloadResponse(()=>exportQuestionnaireOriginal(c,id,input),{filename:'completed-original.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',signal:r.signal});
 }catch(e){if(e instanceof QuestionnaireWorkbookError)return reply({error:e.message},e.status);return fail(e);}
}
