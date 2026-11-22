import {searchOfficialPublications} from "../../../../lib/server/publication-research";
import {IntelligenceError} from "../../../../lib/server/intelligence-service";
import {NextResponse} from "next/server";
import {resolveCustomerAi} from "../../../../lib/server/integration-marketplace";
import {connectorProviderEnabled} from '../../../../lib/server/connector-flags';
import {brokerKey} from "../../../../lib/connectors/marketplace";
import {aiProcessingAllowed,aiConfigured,workspaceConfigured,AccessError,authorisedAiContext} from "../../../../lib/server/ai-auth";
import {reserveAiRequest,DailyLimitError} from "../../../../lib/server/ai-meter";
import {loadOfficialSource,SourceUnavailable} from "../../../../lib/server/ai-sources";
import {runRegPilotAi} from "../../../../lib/server/ai-model";
import {saveGeneratedReview} from "../../../../lib/server/ai-reviews";
import {downloadEvidence} from "../../../../lib/server/evidence-service";
import {evidenceConfigured} from "../../../../lib/server/evidence-storage";
import {EvidenceError} from "../../../../lib/evidence/file-guard.mjs";
import {validateAiRequest,InputError} from "../../../../lib/ai/contract.mjs";
import {aiBoundarySummary} from "../../../../lib/ai/regulated-use.mjs";
import {extractDocument} from "../../../../lib/server/document-extraction";
import {coverageOf} from "../../../../lib/documents/coverage";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function limitedBody(request:Request){
 const reader=request.body?.getReader();
 if(!reader)throw new InputError("Request body missing");
 const chunks:Uint8Array[]=[];let sum=0;
 while(true){
  const {done,value}=await reader.read();if(done)break;
  sum+=value.byteLength;if(sum>3_000_000){void reader.cancel();throw new InputError("Request exceeds 3 MB");}
  chunks.push(value);
 }
 return JSON.parse(Buffer.concat(chunks.map(x=>Buffer.from(x))).toString("utf8"));
}
const customerProcessing=()=>aiProcessingAllowed()&&(!!brokerKey()||connectorProviderEnabled('OPENAI_PROJECT_MODEL'));
export async function GET(){
 return json({enabled:aiConfigured(),customerEnabled:customerProcessing(),workspaceEnabled:workspaceConfigured(),mode:"private-pilot",privacy:"Use fictional or non-sensitive working drafts only. Model processing may occur outside the UK.",requiresAuth:true,intendedUse:aiBoundarySummary()});
}
export async function POST(request:Request){
 const choice=request.headers.get('x-regpilot-ai-binding');
 if(choice&&!/^[a-f0-9-]{36}$/i.test(choice))return json({error:'Invalid AI connection'},400);
 if(choice?!customerProcessing():!aiConfigured())return json({error:"Private AI pilot not configured"},503);
 if(!choice&&!process.env.AI_GATEWAY_API_KEY&&!process.env.VERCEL_OIDC_TOKEN)return json({error:"AI Gateway authentication not configured"},503);
 const contentType=request.headers.get("content-type")||"";
 if(contentType.toLowerCase().split(";")[0].trim()!=="application/json")return json({error:"Send application/json"},415);
 const size=Number(request.headers.get("content-length")||"0");
 if(size>3_000_000)return json({error:"Request exceeds 3 MB"},413);
 let requestId:string|null=null;
 try{
  const raw=await limitedBody(request);
  const input=validateAiRequest(raw);
  const ctx=await authorisedAiContext(request,input.organizationId);
  const official=await loadOfficialSource(input.sourceId);
  const research=input.mode==="assistant"&&!input.sourceId?await searchOfficialPublications({question:input.question}):undefined;
  if(research&&!research.citations.length){
   const message=research.unavailable?"Some official publications could not be checked. Open the source research results or try again later.":"No supporting passage was found. Refine the question or select an official publication.";
   return json({error:message,research},422);
  }
  let aiInput:Parameters<typeof runRegPilotAi>[0]=input;
  if(input.evidenceId&&process.env.REGPILOT_AI_PRIVATE_EVIDENCE_APPROVED!=="true")return json({error:"AI processing of private evidence is not approved for this pilot. Use a synthetic working draft instead."},403);
  if(input.evidenceId){
   if(!evidenceConfigured())return json({error:"Private evidence vault not configured"},503);
   const stored=await downloadEvidence(ctx,input.evidenceId);
   if(stored.bytes.byteLength>2_000_000)return json({error:"AI currently supports private evidence documents up to 2 MB"},413);
   aiInput={...input,fileBytes:Uint8Array.from(stored.bytes),fileFormat:stored.filename.toLowerCase().endsWith(".docx")?"DOCX":"PDF"};
  }
  if(aiInput.fileBytes){const extracted=await extractDocument(aiInput.fileBytes,aiInput.fileFormat==="DOCX"?"input.docx":"input.pdf",{allowEmpty:true});aiInput={...aiInput,fileBytes:extracted.format==="DOCX"?null:aiInput.fileBytes,documentUnitKind:extracted.unitKind,documentPages:extracted.pages,documentCoverage:{...coverageOf(extracted),unreadablePages:extracted.skippedPages}};}
  const account=choice?await resolveCustomerAi(ctx,choice):undefined;
  requestId=await reserveAiRequest(ctx,input.mode,input.useDeclaration);
  const ai=await runRegPilotAi(aiInput,official,research,account);
  let reviewId:string|null=null,storageWarning:string|null=null;
  if(input.retainDraft){
   try{
    const stored=await saveGeneratedReview(ctx,{requestId,mode:input.mode,ai});
    reviewId=stored.id;
   }catch{
    // Never discard a paid AI result solely because the optional review save failed.
    storageWarning="Your AI review was generated but not saved to the team inbox. Download the draft before leaving.";
   }
  }
  return json({requestId,ai,reviewId,storageWarning});
 }catch(error){
  if(error instanceof InputError)return json({error:error.message},400);
  if(error instanceof IntelligenceError)return json({error:error.message},error.status);
  if(error instanceof AccessError)return json({error:error.message},error.status);
  if(error instanceof SourceUnavailable)return json({error:error.message},422);
  if(error instanceof DailyLimitError)return json({error:error.message},429);
  if(error instanceof EvidenceError)return json({error:error.message},error.status);
  // Internal provider errors must never return credentials, submitted documents or provider payloads.
  return json({error:requestId?"AI generation unavailable or invalid; allowance was reserved. Retry later.":"AI service or organisation store unavailable."},503);
 }
}
