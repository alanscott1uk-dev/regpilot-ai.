import {researchRequirements} from './requirement-research';
import {supplierResearch} from "./vendor-service";
import {connectionEvidence} from "./connector-health-service";
import {relevantConnections,operatorQuestions} from "../operator-answer";
import {Prisma,type KnowledgeIndexRun,type KnowledgeSearchRun} from "@prisma/client";
import {z} from "zod";
import {hashValue} from "../regulatory/intelligence";
import {KNOWLEDGE_ENGINE,KNOWLEDGE_LIMITS,knowledgeIndexInput,knowledgeSearchInput,knowledgeMethod,knowledgeChunkSchema,knowledgeHitsSchema,chunkKnowledgeDocument,checkedVector,vectorForKnowledgeStorage,checkedStoredKnowledgeVector,storedKnowledgeHits,restoredKnowledgeHits,rankKnowledgeChunks,citationHash,type KnowledgeChunkValue,type KnowledgeMethod,type SearchableKnowledgeChunk} from "../company-knowledge";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,WRITER,ADMIN} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {reviewedFiles,reviewedFileSchema,type ReviewedFile} from "./reviewed-files";
import {completionParticipants} from "./work-completion-service";
import {assertAssuranceParticipants} from "./customer-assurance-service";
import {assuranceConfigured,assuranceAiConfigured} from "./assurance-service";
import {downloadEvidence} from "./evidence-service";
import {extractDocument} from "./document-extraction";
import type {EvidenceObjectStore} from "./evidence-storage";
import {embedKnowledge,type KnowledgeEmbeddingResult} from "./knowledge-embedding-model";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import {filterKnowledgeEvidence} from "./product-service";
import {supportingPassages,workspaceResearchInput} from '../workspace-research';
import {searchWorkspaceRecords} from './workspace-record-search';
import type {searchOfficialPublications} from './publication-research';
import {EvidenceError} from "../evidence/file-guard.mjs";

type Tx=Prisma.TransactionClient;
type Dependencies={storage?:EvidenceObjectStore;embed?:(values:string[],model:string)=>Promise<KnowledgeEmbeddingResult>};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const org=(c:AuthorizedContext)=>({organizationId:c.organizationId});
const peopleSchema=z.array(z.object({id:z.uuid(),role:z.string(),approved:z.boolean()}).strict());
const contextSchema=z.object({engine:z.literal(KNOWLEDGE_ENGINE),method:knowledgeMethod,createdById:z.uuid(),file:reviewedFileSchema,participants:peopleSchema,model:z.string().nullable()}).strict();
const searchContextSchema=z.object({engine:z.literal(KNOWLEDGE_ENGINE),method:knowledgeMethod,query:z.string().min(3).max(KNOWLEDGE_LIMITS.queryCharacters),productId:z.uuid().nullable(),model:z.string().nullable(),corpusHash:z.string().regex(/^[a-f0-9]{64}$/),scope:z.unknown()}).strict();
const useDeclaration={purpose:"Retrieve relevant passages from approved company evidence",dataCategory:"Private reviewed business evidence",recordPurpose:"Human review of exact citations before response preparation",humanReviewRequired:true};
class KnowledgeFailure extends IntelligenceError {constructor(message:string,public code:string,status=409){super(message,status);}}
export function knowledgeSemanticReady(){return assuranceAiConfigured()&&process.env.REGPILOT_KNOWLEDGE_SEMANTIC_ENABLED==="true"&&/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(process.env.REGPILOT_KNOWLEDGE_EMBEDDING_MODEL||"");}
const modelFor=(method:KnowledgeMethod)=>method==="SEMANTIC"?process.env.REGPILOT_KNOWLEDGE_EMBEDDING_MODEL||"":null;
function configured(method:KnowledgeMethod){if(!assuranceConfigured()||method==="SEMANTIC"&&!knowledgeSemanticReady())throw new IntelligenceError(method==="SEMANTIC"?"Semantic retrieval awaits an explicitly configured embedding model and reviewed AI/privacy/paid activation. Content search remains available.":"Private evidence processing awaits activation",503);}
async function event(tx:Tx,c:AuthorizedContext,id:string,action:string,details:Prisma.InputJsonValue={}){await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:"CompanyKnowledge",entityId:id,action:"company_knowledge."+action,details}});}
async function expireProcessing(tx:Tx,c:AuthorizedContext){
 const expired={...org(c),status:"PROCESSING",createdAt:{lt:new Date(Date.now()-KNOWLEDGE_LIMITS.processingTimeoutMs)}};
 await tx.knowledgeIndexRun.updateMany({where:expired,data:{status:"FAILED",failureCode:"INTERRUPTED"}});
 await tx.knowledgeSearchRun.updateMany({where:expired,data:{status:"FAILED",failureCode:"INTERRUPTED"}});
}
function captured(file:ReviewedFile,participants:z.infer<typeof peopleSchema>,creator:string,method:KnowledgeMethod,model:string|null){return contextSchema.parse({engine:KNOWLEDGE_ENGINE,method,createdById:creator,file,participants,model});}
async function captureFile(tx:Tx,c:AuthorizedContext,evidenceId:string,creator:string,method:KnowledgeMethod,model:string|null){
 await requireMember(tx,c,WRITER);const [file]=await reviewedFiles(tx,c.organizationId,[evidenceId]);
 if(!/\.(pdf|docx)$/i.test(file.filename))throw new IntelligenceError("Only complete readable PDF and DOCX evidence can be indexed",409);
 const people=await assertAssuranceParticipants(tx,c.organizationId,[file],[creator]);return captured(file,people,creator,method,model);
}
function stored(run:KnowledgeIndexRun){
 const parsed=contextSchema.safeParse(run.context);if(!parsed.success||parsed.data.file.id!==run.evidenceId||parsed.data.createdById!==run.createdById||parsed.data.method!==run.method||parsed.data.model!==run.model||run.engineVersion!==KNOWLEDGE_ENGINE||hashValue(parsed.data)!==run.inputHash)throw new IntelligenceError("Index context integrity failed",409);return parsed.data;
}
async function assertCurrentRun(tx:Tx,c:AuthorizedContext,run:KnowledgeIndexRun){
 const previous=stored(run),current=await captureFile(tx,c,run.evidenceId,run.createdById,previous.method,previous.model);
 if(hashValue(current)!==run.inputHash)throw new IntelligenceError("Evidence or participant permissions changed during indexing. Review the current source before indexing it again.",409);
 const pending=await tx.knowledgeIndexRun.findFirst({where:{id:run.id,...org(c)}});if(!pending||pending.status!=="PROCESSING"||pending.expiresAt<new Date())throw new IntelligenceError("This index attempt is no longer pending",409);
 configured(previous.method);if(modelFor(previous.method)!==previous.model)throw new IntelligenceError("The embedding model changed during indexing",409);return current;
}
type CheckedIndex={run:KnowledgeIndexRun;context:z.infer<typeof contextSchema>|null;current:boolean;reason:string;filename:string|null;chunks:KnowledgeChunkValue[]};
/** One scoped evidence read and one ordered participant lock cover the whole bounded corpus. */
async function checkedIndexes(tx:Tx,c:AuthorizedContext,exact?:KnowledgeIndexRun):Promise<CheckedIndex[]>{
 const [recent,active]=await Promise.all([tx.knowledgeIndexRun.findMany({where:org(c),orderBy:[{createdAt:"desc"},{id:"asc"}],take:KNOWLEDGE_LIMITS.indexHistory}),tx.knowledgeIndexRun.findMany({where:{...org(c),status:{in:["READY","PROCESSING"]}},orderBy:[{createdAt:"desc"},{id:"asc"}],take:KNOWLEDGE_LIMITS.documents*2+1})]);
 if(active.length>KNOWLEDGE_LIMITS.documents*2)throw new IntelligenceError("Active knowledge indexes exceed the supported document bound",409);
 const runs=[...new Map([...recent,...active,...(exact?[exact]:[])].map(run=>[run.id,run])).values()].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||a.id.localeCompare(b.id));
 const fileIds=[...new Set(runs.map(run=>run.evidenceId))],files=await tx.evidence.findMany({where:{...org(c),id:{in:fileIds}},select:{id:true,filename:true,sha256:true,reviewVersion:true,contentType:true,sizeBytes:true,uploadedById:true,reviewerId:true,scanStatus:true,reviewStatus:true,reviewedAt:true},orderBy:{id:"asc"}}),usable=new Map<string,ReviewedFile>();
 for(const file of files){const parsed=reviewedFileSchema.safeParse(file);if(parsed.success&&file.scanStatus==="CLEAN"&&file.reviewStatus==="APPROVED"&&file.reviewedAt&&file.uploadedById!==file.reviewerId)usable.set(file.id,parsed.data);}
 const people=await completionParticipants(tx,c,[...runs.map(run=>run.createdById),...files.flatMap(file=>[file.uploadedById,file.reviewerId])]),now=new Date();
 const checked:CheckedIndex[]=runs.map(run=>{let context:null|z.infer<typeof contextSchema>=null,current=false,reason="";try{
  context=stored(run);if(run.status!=="READY")throw new IntelligenceError(run.status==="FAILED"?run.failureCode==="EXTRACTION_UNSUPPORTED"?"Document extraction was incomplete, unreadable or exceeded the bounded index limit. Review the original before retrying.":run.failureCode==="SOURCE_INTEGRITY_CHANGED"?"Private source bytes failed verification. Review the source evidence before indexing.":"Indexing failed. Inspect the recorded attempt before explicitly retrying.":run.status==="RETIRED"?"This index was removed or replaced.":"Indexing is still in progress.",409);
  if(run.expiresAt<now)throw new IntelligenceError("The index expired. Verify and reindex the current evidence.",409);
  const file=usable.get(run.evidenceId);if(!file)throw new IntelligenceError("Source evidence is no longer independently approved and available",409);
  const ids=new Set([run.createdById,file.uploadedById,file.reviewerId]),participants=people.filter(person=>ids.has(person.id)),allowed=(id:string,roles:string[])=>participants.some(person=>person.id===id&&person.approved&&roles.includes(person.role));
  if(!allowed(run.createdById,WRITER)||!allowed(file.uploadedById,WRITER)||!allowed(file.reviewerId,ADMIN))throw new IntelligenceError("An index author, evidence uploader or reviewer no longer has current company permission",409);
  if(hashValue(captured(file,participants,run.createdById,context.method,context.model))!==run.inputHash)throw new IntelligenceError("Evidence review or participant permissions changed. Index the current reviewed version.",409);
  current=true;
 }catch(problem){if(!(problem instanceof IntelligenceError)&&!(problem instanceof z.ZodError))throw problem;reason=problem instanceof IntelligenceError?problem.message:"Index context could not be verified";}
 return {run,context,current,reason,filename:files.find(file=>file.id===run.evidenceId)?.filename||null,chunks:[]};});
 const ready=checked.filter(item=>item.current),chunks=ready.length?await tx.knowledgeChunk.findMany({where:{...org(c),indexRunId:{in:ready.map(item=>item.run.id)}},orderBy:[{indexRunId:"asc"},{ordinal:"asc"}],take:KNOWLEDGE_LIMITS.corpusChunks+1}):[];
 if(chunks.length>KNOWLEDGE_LIMITS.corpusChunks)throw new IntelligenceError("The indexed corpus exceeds the 1,600-chunk retrieval limit",409);
 for(const item of ready){try{
  item.chunks=chunks.filter(chunk=>chunk.indexRunId===item.run.id).map(chunk=>knowledgeChunkSchema.parse({ordinal:chunk.ordinal,unit:chunk.unit,unitKind:chunk.unitKind,start:chunk.start,end:chunk.end,text:chunk.text,textHash:chunk.textHash,vector:chunk.vector}));
  if(!item.chunks.length||item.chunks.length!==item.run.chunkCount||item.chunks.some((chunk,index)=>chunk.ordinal!==index)||hashValue(item.chunks)!==item.run.chunksHash)throw new Error("Indexed text or vector integrity failed");
  for(const chunk of item.chunks){if(item.run.method==="SEMANTIC"){if(!item.run.dimensions)throw new Error("Embedding dimensions missing");checkedStoredKnowledgeVector(chunk.vector,item.run.dimensions);}else if(chunk.vector!==null||item.run.dimensions!==null)throw new Error("Unexpected content-search embedding");}
 }catch{item.current=false;item.reason="Indexed text or vectors failed their integrity check. Reindex the reviewed source.";item.chunks=[];}}
 return checked;
}
function viewIndex(item:CheckedIndex){const run=item.run;return {id:run.id,evidenceId:run.evidenceId,filename:item.filename,requestKey:run.requestKey,method:run.method,status:run.status,current:item.current,staleReason:item.reason,chunkCount:run.chunkCount,dimensions:run.dimensions,embeddingModel:run.model,semanticCurrent:item.current&&run.method==="SEMANTIC"&&run.model===modelFor("SEMANTIC"),expiresAt:run.expiresAt.toISOString(),createdAt:run.createdAt.toISOString(),failureCode:run.failureCode,usage:run.usage};}
const indexReceiptKey=(c:AuthorizedContext,requestKey:string)=>hashValue({organizationId:c.organizationId,requestKey});
async function reusedIndexReceipt(tx:Tx,c:AuthorizedContext,requestKey:string){
 const receipt=await tx.auditEvent.findFirst({where:{...org(c),entityType:"KnowledgeIndexRequest",entityId:indexReceiptKey(c,requestKey),action:"company_knowledge.index_reused"}});
 if(!receipt)return null;
 const detail=z.object({requestKey:z.uuid(),requestHash:z.string().regex(/^[a-f0-9]{64}$/),indexId:z.uuid(),evidenceId:z.uuid()}).strict().safeParse(receipt.details);
 if(!detail.success||detail.data.requestKey!==requestKey||receipt.actorId!==c.userId)throw new IntelligenceError("This indexing receipt belongs to a different request",409);
 const run=await tx.knowledgeIndexRun.findFirst({where:{id:detail.data.indexId,...org(c),evidenceId:detail.data.evidenceId}});return {run,requestHash:detail.data.requestHash};
}
export async function knowledgeIndex(c:AuthorizedContext,filter:{requestKey?:string;runId?:string}){
 if(!filter.requestKey&&!filter.runId)throw new IntelligenceError("Select the exact saved indexing request",400);if(filter.requestKey)z.uuid().parse(filter.requestKey);if(filter.runId)z.uuid().parse(filter.runId);
 return transaction(c,async tx=>{
  await requireMember(tx,c,WRITER);await expireProcessing(tx,c);let run=await tx.knowledgeIndexRun.findFirst({where:{...org(c),...(filter.runId?{id:filter.runId}:{}),...(filter.requestKey?{requestKey:filter.requestKey,createdById:c.userId}:{})}}),reused=false;
  if(!run&&filter.requestKey){const receipt=await reusedIndexReceipt(tx,c,filter.requestKey);if(receipt){run=receipt.run;reused=true;if(!run)throw new IntelligenceError("The original indexed evidence was removed; this request will not be repeated automatically",410);if(filter.runId&&run.id!==filter.runId)throw new IntelligenceError("The indexed request does not match this record",409);}}
  if(!run)return null;const item=(await checkedIndexes(tx,c,run)).find(item=>item.run.id===run!.id)!;return {...viewIndex(item),requestKey:filter.requestKey||run.requestKey,reused};
 });
}

export async function knowledgeWorkspace(c:AuthorizedContext){return transaction(c,async tx=>{
 await requireMember(tx,c,WRITER);await expireProcessing(tx,c);const indexes=await checkedIndexes(tx,c),files=await tx.evidence.findMany({where:{...org(c),scanStatus:"CLEAN",reviewStatus:"APPROVED"},select:{id:true,filename:true},orderBy:{createdAt:"desc"},take:100});
 return {configuration:{contentReady:assuranceConfigured(),semanticReady:knowledgeSemanticReady(),embeddingModel:knowledgeSemanticReady()?modelFor("SEMANTIC"):null},limits:KNOWLEDGE_LIMITS,indexes:indexes.map(viewIndex),documents:files.map(file=>{const current=indexes.find(item=>item.run.evidenceId===file.id&&item.current),latest=current||indexes.find(item=>item.run.evidenceId===file.id);return {evidenceId:file.id,filename:file.filename,eligible:/\.(pdf|docx)$/i.test(file.filename),reason:/\.(pdf|docx)$/i.test(file.filename)?"":"Only PDF and DOCX documents can be indexed",currentIndex:latest?viewIndex(latest):null};})};
});}

async function failIndex(c:AuthorizedContext,id:string,error:unknown){await transaction(c,async tx=>{await tx.knowledgeIndexRun.updateMany({where:{id,...org(c),status:"PROCESSING"},data:{status:"FAILED",failureCode:error instanceof KnowledgeFailure?error.code:error instanceof EvidenceError?"SOURCE_INTEGRITY_CHANGED":error instanceof DailyLimitError?"DAILY_LIMIT":error instanceof IntelligenceError?"CONTEXT_OR_CONFIGURATION_CHANGED":"INDEXING_FAILED"}});await event(tx,c,id,"index_failed");});}
function throwOperationError(error:unknown){if(error instanceof DailyLimitError)throw new IntelligenceError(error.message,429);if(error instanceof IntelligenceError)throw error;if(error instanceof EvidenceError)throw new IntelligenceError(error.message,error.status);throw new IntelligenceError("The recorded operation failed. No automatic repeat was sent. Inspect its status before explicitly retrying.",502);}
export async function indexKnowledgeEvidence(c:AuthorizedContext,input:unknown,dependencies:Dependencies={}){
 const d=knowledgeIndexInput.parse(input),requestHash=hashValue(d),prepared=await transaction(c,async tx=>{
  await requireMember(tx,c,WRITER);await expireProcessing(tx,c);const existing=await tx.knowledgeIndexRun.findUnique({where:{organizationId_requestKey:{organizationId:c.organizationId,requestKey:d.requestKey}}});
  if(existing){if(existing.createdById!==c.userId||existing.requestHash!==requestHash)throw new IntelligenceError("This indexing request key belongs to different inputs",409);return {existing};}
  const receipt=await reusedIndexReceipt(tx,c,d.requestKey);if(receipt){if(receipt.requestHash!==requestHash)throw new IntelligenceError("This indexing request key belongs to different inputs",409);if(!receipt.run)throw new IntelligenceError("The original indexed evidence was removed; this request will not repeat automatically",410);return {existing:receipt.run};}
  configured(d.method);const state=await captureFile(tx,c,d.evidenceId,c.userId,d.method,modelFor(d.method)),inputHash=hashValue(state),indexes=await checkedIndexes(tx,c);
  const reusable=indexes.find(item=>item.current&&item.run.evidenceId===d.evidenceId&&(d.method==="CONTENT"||item.run.method==="SEMANTIC"&&item.run.model===state.model));
  if(reusable){if(await tx.auditEvent.count({where:{...org(c),entityType:"KnowledgeIndexRequest",action:"company_knowledge.index_reused",createdAt:{gte:new Date(Date.now()-86400000)}}})>=KNOWLEDGE_LIMITS.dailyIndexReuses)throw new IntelligenceError("The daily limit of 100 new index reuse requests has been reached. Existing requests remain recoverable.",429);await tx.auditEvent.create({data:{...org(c),actorId:c.userId,entityType:"KnowledgeIndexRequest",entityId:indexReceiptKey(c,d.requestKey),action:"company_knowledge.index_reused",details:{requestKey:d.requestKey,requestHash,indexId:reusable.run.id,evidenceId:d.evidenceId}}});return {existing:reusable.run};}
  const pending=indexes.find(item=>item.run.status==="PROCESSING"&&item.run.evidenceId===d.evidenceId);if(pending)throw new IntelligenceError("This evidence already has an indexing attempt in progress. Inspect its saved status.",409);
  const failed=await tx.knowledgeIndexRun.findFirst({where:{...org(c),evidenceId:d.evidenceId,inputHash,status:"FAILED"},orderBy:{createdAt:"desc"}});
  if(failed&&d.retryOfId!==failed.id)throw new IntelligenceError("An attempt with these exact inputs failed. Open that attempt and explicitly retry it.",409);
  if(d.retryOfId&&!await tx.knowledgeIndexRun.findFirst({where:{...org(c),id:d.retryOfId,evidenceId:d.evidenceId,status:"FAILED"}}))throw new IntelligenceError("The requested failed indexing attempt is unavailable",409);
  if(await tx.knowledgeIndexRun.count({where:{...org(c),createdAt:{gte:new Date(Date.now()-86400000)}}})>=KNOWLEDGE_LIMITS.dailyIndexes)throw new IntelligenceError("The daily limit of 20 document indexing attempts has been reached",429);
  if(new Set(indexes.filter(item=>["READY","PROCESSING"].includes(item.run.status)).map(item=>item.run.evidenceId)).size>=KNOWLEDGE_LIMITS.documents&&!indexes.some(item=>item.run.evidenceId===d.evidenceId&&["READY","PROCESSING"].includes(item.run.status)))throw new IntelligenceError("The 40-document index limit has been reached. Remove an old index before adding a new source.",429);
  const run=await tx.knowledgeIndexRun.create({data:{...org(c),evidenceId:d.evidenceId,createdById:c.userId,requestKey:d.requestKey,requestHash,inputHash,engineVersion:KNOWLEDGE_ENGINE,method:d.method,model:state.model,context:json(state),retryOfId:d.retryOfId,expiresAt:new Date(Date.now()+KNOWLEDGE_LIMITS.indexDays*86400000)}});
  const previous=indexes.find(item=>item.current&&item.run.evidenceId===d.evidenceId);await event(tx,c,run.id,"index_processing_consented",{method:d.method,inputHash});return {run,state,reusableChunks:previous?.chunks};
 });
 if(prepared.existing)return {id:prepared.existing.id,requestKey:d.requestKey,status:prepared.existing.status,reused:true};
 const {run,state}=prepared;
 try{
  const actual=await downloadEvidence(c,d.evidenceId,dependencies.storage);if(actual.sha256!==state.file.sha256||actual.filename!==state.file.filename)throw new IntelligenceError("Evidence changed during private byte verification",409);
  let chunks:KnowledgeChunkValue[];
  if(prepared.reusableChunks)chunks=prepared.reusableChunks.map(chunk=>({...chunk,vector:null}));
  else{let document;try{document=await extractDocument(actual.bytes,actual.filename);}catch{throw new KnowledgeFailure("The document could not be completely read. Use a readable PDF or DOCX and inspect its original content.","EXTRACTION_UNSUPPORTED");}try{chunks=chunkKnowledgeDocument(document);}catch(error){throw new KnowledgeFailure(error instanceof z.ZodError?"The document exceeds the supported chunk or location limits. No partial index was retained.":error instanceof Error?error.message:"The extracted document is not supported","EXTRACTION_UNSUPPORTED");}}
  await transaction(c,tx=>assertCurrentRun(tx,c,run));let usage:KnowledgeEmbeddingResult["usage"]|null=null;
  if(d.method==="SEMANTIC"){
   await reserveAiRequest(c,"KNOWLEDGE_INDEX",useDeclaration,chunks.length);
   const embeddings=await (dependencies.embed||embedKnowledge)(chunks.map(chunk=>chunk.text),state.model!);if(embeddings.vectors.length!==chunks.length)throw new Error("Embedding values are incomplete");
   const dimensions=checkedVector(embeddings.vectors[0]).length;chunks=chunks.map((chunk,index)=>({...chunk,vector:vectorForKnowledgeStorage(embeddings.vectors[index],dimensions)}));usage=embeddings.usage;
  }
  await transaction(c,async tx=>{
   await assertCurrentRun(tx,c,run);const others=await tx.knowledgeIndexRun.findMany({where:{...org(c),evidenceId:d.evidenceId,status:"READY",id:{not:run.id}},select:{id:true}}),otherIds=others.map(item=>item.id),existingChunks=await tx.knowledgeChunk.count({where:{...org(c),indexRunId:{notIn:otherIds}}});
   if(existingChunks+chunks.length>KNOWLEDGE_LIMITS.corpusChunks)throw new IntelligenceError("The 1,600-chunk company index allowance would be exceeded",429);
   await tx.knowledgeChunk.deleteMany({where:{...org(c),indexRunId:{in:otherIds}}});await tx.knowledgeIndexRun.updateMany({where:{...org(c),id:{in:otherIds}},data:{status:"RETIRED"}});
   await tx.knowledgeChunk.createMany({data:chunks.map(chunk=>({...chunk,vector:chunk.vector?json(chunk.vector):Prisma.DbNull,organizationId:c.organizationId,indexRunId:run.id}))});
   await tx.knowledgeIndexRun.update({where:{id:run.id},data:{status:"READY",chunkCount:chunks.length,chunksHash:hashValue(chunks),dimensions:chunks[0].vector?.length||null,usage:usage?json(usage):Prisma.DbNull}});await event(tx,c,run.id,"index_ready",{method:d.method,chunkCount:chunks.length,characters:chunks.reduce((sum,chunk)=>sum+chunk.text.length,0),chunksHash:hashValue(chunks)});
  });
  return {id:run.id,requestKey:run.requestKey,status:"READY",reused:false};
 }catch(error){await failIndex(c,run.id,error);throwOperationError(error);}
}

export async function retireKnowledgeIndex(c:AuthorizedContext,id:string){z.uuid().parse(id);return transaction(c,async tx=>{
 await requireMember(tx,c,WRITER);const run=await tx.knowledgeIndexRun.findFirst({where:{id,...org(c)}});if(!run)throw new IntelligenceError("Knowledge index not found",404);
 await tx.knowledgeChunk.deleteMany({where:{...org(c),indexRunId:id}});await tx.knowledgeIndexRun.update({where:{id},data:{status:"RETIRED"}});await event(tx,c,id,"index_removed");return {id,status:"RETIRED"};
});}

async function corpus(tx:Tx,c:AuthorizedContext,productId:string|null,method:KnowledgeMethod){
 await requireMember(tx,c,WRITER);const indexes=await checkedIndexes(tx,c),candidates=indexes.filter(item=>item.current&&(method==="CONTENT"||item.run.method==="SEMANTIC"&&item.run.model===modelFor(method)));
 const scoped=await filterKnowledgeEvidence(tx,c.organizationId,[...new Set(candidates.map(item=>item.run.evidenceId))],productId),eligible=new Set(scoped.eligibleEvidenceIds),chosen=new Map<string,CheckedIndex>();
 for(const item of candidates)if(eligible.has(item.run.evidenceId)&&!chosen.has(item.run.evidenceId))chosen.set(item.run.evidenceId,item);
 const records=[...chosen.values()].sort((a,b)=>a.run.evidenceId.localeCompare(b.run.evidenceId)),manifest=records.map(item=>({id:item.run.id,evidenceId:item.run.evidenceId,inputHash:item.run.inputHash,chunksHash:item.run.chunksHash,expiresAt:item.run.expiresAt.toISOString()})),corpusHash=hashValue({manifest,scope:scoped.scope,method,model:modelFor(method)});
 const chunks:SearchableKnowledgeChunk[]=records.flatMap(item=>item.chunks.map(chunk=>({...chunk,evidenceId:item.run.evidenceId,filename:item.context!.file.filename,indexId:item.run.id})));
 return {corpusHash,chunks,files:records.map(item=>item.context!.file),scope:scoped.scope,documents:records.length};
}
function searchStored(run:KnowledgeSearchRun){const context=searchContextSchema.safeParse(run.context);if(!context.success||context.data.method!==run.method||context.data.model!==run.model||hashValue(context.data)!==run.inputHash||hashValue(context.data.query)!==run.queryHash)throw new IntelligenceError("Saved search integrity failed",409);return context.data;}
function validCachedVector(run:KnowledgeSearchRun){try{const value=checkedStoredKnowledgeVector(run.vector);if(hashValue(value)!==run.vectorHash)throw new Error("Saved query vector integrity failed");return value;}catch{throw new IntelligenceError("Saved query vector integrity failed",409);}}
async function searchView(tx:Tx,c:AuthorizedContext,run:KnowledgeSearchRun,sharedEvaluation=false){
 if(run.createdById!==c.userId&&!sharedEvaluation)throw new IntelligenceError("Knowledge search not found",404);
 let current=false,reason="",hits:z.infer<typeof knowledgeHitsSchema>=[],scope:unknown=null,corpusHash:string|null=null;
 try{
  const previous=searchStored(run);corpusHash=previous.corpusHash;
  if(run.status!=="READY")throw new IntelligenceError(run.status==="FAILED"?"The recorded search failed. Review its status before explicitly retrying.":"Search is still processing; recover its saved status before sending another request.",409);
  if(run.expiresAt<new Date())throw new IntelligenceError("This saved search expired. Run a new search against the current index.",409);
  const fresh=await corpus(tx,c,previous.productId,previous.method);if(fresh.corpusHash!==previous.corpusHash)throw new IntelligenceError("The source index, product scope, evidence review or permissions changed. Search again for current citations.",409);
  const parsed=restoredKnowledgeHits(run.result);if(hashValue(run.result)!==run.resultHash)throw new IntelligenceError("Saved search result integrity failed",409);
  for(const hit of parsed){const chunk=fresh.chunks.find(chunk=>chunk.indexId===hit.indexId&&chunk.evidenceId===hit.evidenceId&&chunk.unit===hit.unit&&chunk.start===hit.start&&chunk.end===hit.end);if(!chunk||chunk.text!==hit.quote||chunk.filename!==hit.filename||chunk.unitKind!==hit.unitKind||citationHash(hit)!==hit.quoteHash||hit.scoreKind!==(previous.method==="SEMANTIC"?"COSINE_SIMILARITY":"CONTENT_MATCH"))throw new IntelligenceError("A saved quotation no longer matches the current index",409);}
  if(previous.method==="SEMANTIC")validCachedVector(run);hits=parsed;scope=fresh.scope;current=true;
 }catch(error){if(!(error instanceof IntelligenceError)&&!(error instanceof z.ZodError))throw error;reason=error instanceof IntelligenceError?error.message:"Saved search result could not be verified";}
 return {id:run.id,requestKey:run.requestKey,status:run.status,method:run.method,current,semanticReady:knowledgeSemanticReady(),hits,reason,failureCode:run.failureCode,scope,corpusHash,expiresAt:run.expiresAt.toISOString(),usage:run.usage};
}
/** Only the evaluation service uses this bounded company-shared view; no general search sharing route. */
export async function evaluationKnowledgeSearch(tx:Tx,c:AuthorizedContext,id:string){
 await requireMember(tx,c,WRITER);const run=await tx.knowledgeSearchRun.findFirst({where:{id,...org(c)}});if(!run)return null;
 const people=await completionParticipants(tx,c,[run.createdById]);if(!people.some(person=>person.id===run.createdById&&person.approved&&WRITER.includes(person.role as typeof WRITER[number])))throw new IntelligenceError("The search author no longer has current company permission",409);
 const context=searchStored(run);return {...await searchView(tx,c,run,true),query:context.query,productId:context.productId,model:context.model,createdById:run.createdById,resultHash:run.resultHash};
}
export async function evaluationKnowledgeCorpus(tx:Tx,c:AuthorizedContext,productId:string|null,method:KnowledgeMethod){
 const value=await corpus(tx,c,productId,method);return {corpusHash:value.corpusHash,scope:value.scope,evidenceIds:[...new Set(value.chunks.map(chunk=>chunk.evidenceId))],model:modelFor(method)};
}
export async function knowledgeSearch(c:AuthorizedContext,filter:{requestKey?:string;runId?:string}){
 if(!filter.requestKey&&!filter.runId)throw new IntelligenceError("Select the exact saved search request",400);if(filter.requestKey)z.uuid().parse(filter.requestKey);if(filter.runId)z.uuid().parse(filter.runId);
 return transaction(c,async tx=>{await requireMember(tx,c,WRITER);await expireProcessing(tx,c);const run=await tx.knowledgeSearchRun.findFirst({where:{...org(c),createdById:c.userId,...(filter.requestKey?{requestKey:filter.requestKey}:{}),...(filter.runId?{id:filter.runId}:{})}});return run?searchView(tx,c,run):null;});
}
export async function searchKnowledge(c:AuthorizedContext,input:unknown,dependencies:Dependencies={}){
 const d=knowledgeSearchInput.parse(input),requestHash=hashValue({...d,productId:d.productId||null}),prepared=await transaction(c,async tx=>{
  await requireMember(tx,c,WRITER);await expireProcessing(tx,c);const existing=await tx.knowledgeSearchRun.findUnique({where:{organizationId_requestKey:{organizationId:c.organizationId,requestKey:d.requestKey}}});
  if(existing){if(existing.createdById!==c.userId||existing.requestHash!==requestHash)throw new IntelligenceError("This search request key belongs to different inputs",409);return {existing};}
  configured(d.method);const current=await corpus(tx,c,d.productId||null,d.method);if(!current.chunks.length)throw new IntelligenceError(d.method==="SEMANTIC"?"No current semantic indexes apply to this product. Index approved evidence with this embedding model, or use content search.":"No current indexed evidence applies to this product. Index approved evidence and record its product applicability first.",409);
  const context=searchContextSchema.parse({engine:KNOWLEDGE_ENGINE,method:d.method,query:d.query,productId:d.productId||null,model:modelFor(d.method),corpusHash:current.corpusHash,scope:current.scope}),inputHash=hashValue(context);
  const same=await tx.knowledgeSearchRun.findFirst({where:{...org(c),inputHash,status:"PROCESSING"}});if(same)throw new IntelligenceError("This exact search is already processing. Recover its saved request before another search.",409);
  const latest=await tx.knowledgeSearchRun.findFirst({where:{...org(c),createdById:c.userId,inputHash},orderBy:[{createdAt:"desc"},{id:"desc"}]}),failed=latest?.status==="FAILED"?latest:null;
  if(failed&&d.retryOfId!==failed.id)throw new IntelligenceError("This exact search has a failed attempt. Inspect it and explicitly retry with its identifier.",409);
  if(d.retryOfId&&!await tx.knowledgeSearchRun.findFirst({where:{id:d.retryOfId,...org(c),createdById:c.userId,status:"FAILED",queryHash:hashValue(d.query),method:d.method}}))throw new IntelligenceError("The failed search attempt is unavailable",409);
  if(await tx.knowledgeSearchRun.count({where:{...org(c),createdAt:{gte:new Date(Date.now()-86400000)}}})>=KNOWLEDGE_LIMITS.dailySearches)throw new IntelligenceError("The daily limit of 100 knowledge searches has been reached",429);
  let cachedVector:number[]|null=null;
  if(d.method==="SEMANTIC"){
   const previous=await tx.knowledgeSearchRun.findFirst({where:{...org(c),queryHash:hashValue(d.query),model:context.model,status:"READY",expiresAt:{gt:new Date()}},orderBy:{createdAt:"desc"}});
   if(previous){try{searchStored(previous);cachedVector=validCachedVector(previous);}catch{cachedVector=null;}}
  }
  const run=await tx.knowledgeSearchRun.create({data:{...org(c),createdById:c.userId,requestKey:d.requestKey,requestHash,inputHash,queryHash:hashValue(d.query),method:d.method,model:context.model,context:json(context),expiresAt:new Date(Date.now()+KNOWLEDGE_LIMITS.searchHours*3600000)}});
  await event(tx,c,run.id,"search_processing_consented",{method:d.method,corpusHash:current.corpusHash,queryHash:run.queryHash,documents:current.documents,reusedQueryEmbedding:!!cachedVector});return {run,context,corpus:current,cachedVector};
 });
 if(prepared.existing)return transaction(c,tx=>searchView(tx,c,prepared.existing));
 const {run,context}=prepared;
 try{
  let vector=prepared.cachedVector,usage:KnowledgeEmbeddingResult["usage"]|null=null;
  if(d.method==="SEMANTIC"&&!vector){await reserveAiRequest(c,"KNOWLEDGE_SEARCH",useDeclaration);const embedding=await (dependencies.embed||embedKnowledge)([d.query],context.model!);if(embedding.vectors.length!==1)throw new Error("Query embedding is incomplete");vector=vectorForKnowledgeStorage(embedding.vectors[0]);usage=embedding.usage;}
  const result=storedKnowledgeHits(rankKnowledgeChunks(d.query,prepared.corpus.chunks,d.method,vector||undefined));
  await transaction(c,async tx=>{
   configured(d.method);const current=await corpus(tx,c,d.productId||null,d.method);if(current.corpusHash!==context.corpusHash||context.model!==modelFor(d.method))throw new IntelligenceError("The evidence index, product scope, permissions or embedding model changed during search",409);
   const changed=await tx.knowledgeSearchRun.updateMany({where:{id:run.id,...org(c),status:"PROCESSING",expiresAt:{gt:new Date()}},data:{status:"READY",result:json(result),resultHash:hashValue(result),vector:vector?json(vector):Prisma.DbNull,vectorHash:vector?hashValue(vector):null,usage:usage?json(usage):Prisma.DbNull}});if(changed.count!==1)throw new IntelligenceError("This saved search is no longer pending",409);await event(tx,c,run.id,"search_ready",{method:d.method,hitCount:result.length,resultHash:hashValue(result),reusedQueryEmbedding:!!prepared.cachedVector});
  });return (await knowledgeSearch(c,{runId:run.id}))!;
 }catch(error){await transaction(c,async tx=>{await tx.knowledgeSearchRun.updateMany({where:{id:run.id,...org(c),status:"PROCESSING"},data:{status:"FAILED",failureCode:error instanceof DailyLimitError?"DAILY_LIMIT":error instanceof IntelligenceError?"CONTEXT_OR_CONFIGURATION_CHANGED":"SEARCH_FAILED"}});await event(tx,c,run.id,"search_failed");});throwOperationError(error);}
}

export async function researchWorkspaceQuestion(c:AuthorizedContext,input:unknown,readOfficial:typeof searchOfficialPublications){
 const {question,asset,productId,nation}=workspaceResearchInput.parse(input);
 configured('CONTENT');
 await transaction(c,tx=>requireMember(tx,c,ADMIN));
 // Only fixed register URLs are fetched by the public reader. Do not hold a database lock during that read.
 const official=await readOfficial({question,...(nation?{nation}:{})});
 return transaction(c,async tx=>{
  await requireMember(tx,c,ADMIN);
  const current=await corpus(tx,c,productId,'CONTENT');
  const files=new Map(current.files.map(file=>[file.id,file]));
  const policies=new Map<string,{title:string;number:number}|null>();
  const revisions=current.files.length?await tx.policyRevision.findMany({
   where:{...org(c),OR:current.files.map(file=>({file:{path:['id'],equals:file.id}}))},
   select:{number:true,createdById:true,reviewerId:true,publishedAt:true,file:true,fileHash:true,status:true,
    policy:{select:{title:true,currentRevision:true,active:true,controlledEffectivity:true}},
    releases:{where:{state:'EFFECTIVE'},take:1,select:{id:true}}}
  }):[];
  for(const revision of revisions){
   const file=reviewedFileSchema.safeParse(revision.file);
   if(!file.success)throw new IntelligenceError('Policy file snapshot could not be verified',409);
   const id=file.data.id;
   if(!policies.has(id))policies.set(id,null);
   if(revision.status==='PUBLISHED'&&revision.policy.active&&revision.number===revision.policy.currentRevision&&
    revision.publishedAt&&revision.reviewerId&&revision.createdById!==revision.reviewerId&&
    (!revision.policy.controlledEffectivity||revision.releases.length>0)&&
    hashValue(file.data)===revision.fileHash&&hashValue(files.get(id))===revision.fileHash){
    policies.set(id,{title:revision.policy.title,number:revision.number});
   }
  }
  const records=productId?[]:await searchWorkspaceRecords(tx,c.organizationId,question,asset);
  const requirements=await researchRequirements(tx,c,question,{asset,productId,nation});
  const passages=supportingPassages(question,asset,current.chunks,policies);
  const connections=productId?[]:relevantConnections(question,asset,(await connectionEvidence(tx,c.organizationId,true)).items);
  const suppliers=await supplierResearch(tx,c,records.filter(r=>r.kind==="Supplier").map(r=>r.id),asset);
  const clarifications=operatorQuestions(question,asset,!!passages.procedures.length,!!passages.evidence.length,connections);
  return {organizationId:c.organizationId,productId,asset,question,nation:nation||null,records,documents:current.documents,official,connections,suppliers,requirements,clarifications,...passages};
 });
}
