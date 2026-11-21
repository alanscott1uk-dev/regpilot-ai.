import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember} from "./workspace-member";
import {downloadEvidence} from "./evidence-service";
import {evidenceConfigured,type EvidenceObjectStore} from "./evidence-storage";
import {extractDocument} from "./document-extraction";
import {extractionBlocked,coverageOf} from "../documents/coverage";

/** On-demand, metered local extraction. Does not call a model or retain text. */
export async function inspectEvidence(ctx:AuthorizedContext,id:string,store?:EvidenceObjectStore){
  if(!evidenceConfigured())throw new IntelligenceError("Evidence processing awaits activation",503);
  await transaction(ctx,async tx=>{
    await requireMember(tx,ctx);
    if(!await tx.evidence.findFirst({where:{id,organizationId:ctx.organizationId,scanStatus:"CLEAN"},select:{id:true}}))throw new IntelligenceError("Evidence not found",404);
    const count=await tx.auditEvent.count({where:{organizationId:ctx.organizationId,action:"evidence.extraction_requested",createdAt:{gte:new Date(Date.now()-3600000)}}});
    if(count>=30)throw new IntelligenceError("Document inspection limit reached. Try again within an hour.",429);
    await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"evidence.extraction_requested",entityType:"Evidence",entityId:id,details:{}}});
  });
  const file=await downloadEvidence(ctx,id,store),document=await extractDocument(file.bytes,file.filename,{allowEmpty:true});
  await transaction(ctx,tx=>requireMember(tx,ctx));
  if(!evidenceConfigured())throw new IntelligenceError("Evidence processing activation changed",503);
  return {id,filename:file.filename,sha256:file.sha256,engine:document.version,coverage:coverageOf(document),units:document.pages,characters:document.characters,blocked:extractionBlocked(document),warnings:document.warnings||["PDF extraction cannot verify images, signatures, reading order or implementation. Inspect the original."],nextStep:extractionBlocked(document)?"Resolve the listed extraction issues before accepting a programme or evidence assessment.":"Text is available for review. Inspect the original and confirm the scope; extraction does not prove compliance."};
}
