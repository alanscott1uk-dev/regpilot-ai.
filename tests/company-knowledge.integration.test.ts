import './helpers/paid-fixture';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {createEvidence,reviewEvidence,downloadEvidence} from '../lib/server/evidence-service';
import {extractDocument} from '../lib/server/document-extraction';
import {createProduct,changeProduct,setEvidenceApplicability} from '../lib/server/product-service';
import {indexKnowledgeEvidence,knowledgeWorkspace,knowledgeIndex,searchKnowledge,knowledgeSearch,retireKnowledgeIndex,knowledgeSemanticReady} from '../lib/server/company-knowledge-service';
import {fixturePdf} from './helpers/pdf-fixture.mjs';
import {hashValue} from '../lib/regulatory/intelligence';
import type {KnowledgeEmbeddingResult} from '../lib/server/knowledge-embedding-model';
import {vectorForKnowledgeStorage} from '../lib/company-knowledge';

function config(){Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',REGPILOT_ASSURANCE_ENABLED:'true',REGPILOT_ASSURANCE_AI_ENABLED:'true',REGPILOT_AI_ENABLED:'true',REGPILOT_AI_SAFEGUARDS_VERIFIED:'true',REGPILOT_AI_PROCESSOR_REVIEWED:'true',REGPILOT_AI_TRANSFER_REVIEWED:'true',REGPILOT_AI_INTENDED_USE_REVIEWED:'true',REGPILOT_AI_MODEL:'test/fictional',REGPILOT_KNOWLEDGE_SEMANTIC_ENABLED:'true',REGPILOT_KNOWLEDGE_EMBEDDING_MODEL:'test/fictional-embedding',AI_GATEWAY_API_KEY:'fixture-never-used',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',REGPILOT_EVIDENCE_BUCKET:'fixture',REGPILOT_CLAMD_HOST:'fixture',REGPILOT_AI_DAILY_USER_LIMIT:'10',REGPILOT_AI_DAILY_ORG_LIMIT:'20'});}
type Fixture=Awaited<ReturnType<typeof assuranceFixture>>;
const indexInput=(evidenceId:string,method:'CONTENT'|'SEMANTIC'='CONTENT')=>({evidenceId,method,requestKey:randomUUID(),confirm:true as const});
const queryInput=(method:'CONTENT'|'SEMANTIC'='CONTENT',productId:string|null=null)=>({query:'Fictional assurance document',method,productId,requestKey:randomUUID(),confirm:true as const});
async function scope(x:Fixture,id:string,productIds:string[]=[]){const file=await db.evidence.findUniqueOrThrow({where:{id}});await setEvidenceApplicability(x.ad,{evidenceId:id,reviewVersion:file.reviewVersion,mode:productIds.length?'PRODUCT':'GLOBAL',productIds,notes:'Fictional evidence applies to the explicitly selected business scope.',requestKey:randomUUID(),confirm:true});}
const embedding=(values:string[]):KnowledgeEmbeddingResult=>({vectors:values.map(()=>[1,0.1]),usage:{tokens:values.length*7,inputValues:values.length,inputCharacters:values.reduce((sum,value)=>sum+value.length,0)}});
async function cleanup(x:Fixture){await db.knowledgeSearchRun.deleteMany({where:{organizationId:{in:[x.a.id,x.b.id]}}});await db.aiDailyUsage.deleteMany({where:{organizationId:{in:[x.a.id,x.b.id]}}});await x.cleanup();}

test('persistent PDF knowledge verifies actual bytes, keeps exact citations, reuses unchanged extraction and isolates tenant/writer access',async()=>{
 const x=await assuranceFixture();config();try{
  const file=await x.file();await scope(x,file.id);let reads=0;const store={...x.store,async get(key:string){reads++;return x.store.get(key);}},request=indexInput(file.id);
  await assert.rejects(()=>indexKnowledgeEvidence(x.out,request,{storage:store}),rejects(409));await assert.rejects(()=>knowledgeWorkspace(x.st),rejects(403));
  const first=await indexKnowledgeEvidence(x.ed,request,{storage:store});assert.equal(first!.status,'READY');assert.equal(reads,1);
  assert.equal((await indexKnowledgeEvidence(x.ed,request,{storage:store}))!.id,first!.id);const alias=indexInput(file.id);assert.equal((await indexKnowledgeEvidence(x.ed,alias,{storage:store}))!.id,first!.id);assert.equal(reads,1,'unchanged current evidence is not re-downloaded or extracted');
  const recoveredAlias=await knowledgeIndex(x.ed,{requestKey:alias.requestKey});assert.equal(recoveredAlias!.id,first!.id);assert.equal(recoveredAlias!.requestKey,alias.requestKey);assert.equal(recoveredAlias!.reused,true);assert.equal(recoveredAlias!.current,true);await indexKnowledgeEvidence(x.ed,alias,{storage:store});assert.equal(reads,1);assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id,entityType:'KnowledgeIndexRequest'}}),1);
  await assert.rejects(()=>indexKnowledgeEvidence(x.ed,{...request,method:'SEMANTIC'},{storage:store}),rejects(409));
  const input=queryInput(),result=await searchKnowledge(x.ed,input);assert.equal(result!.status,'READY');assert.equal(result!.current,true);assert.equal(result!.hits.length,1);assert.equal(result!.hits[0].scoreKind,'CONTENT_MATCH');assert.equal(await db.aiDailyUsage.count({where:{organizationId:x.a.id}}),0);
  const actual=await downloadEvidence(x.ed,file.id,x.store),document=await extractDocument(actual.bytes,actual.filename),hit=result!.hits[0];assert.equal(document.pages.find(page=>page.page===hit.unit)!.text.slice(hit.start,hit.end),hit.quote);assert.equal(hit.unitKind,'page');
  assert.equal((await knowledgeSearch(x.ed,{requestKey:input.requestKey}))!.id,result!.id);assert.equal(await knowledgeSearch(x.out,{requestKey:input.requestKey}),null);assert.equal(await knowledgeSearch(x.re,{requestKey:input.requestKey}),null);
  const view=await knowledgeWorkspace(x.ed);assert.equal(view.indexes[0].current,true);assert.doesNotMatch(JSON.stringify(view),/storageKey|private-objects|vector|Fictional assurance document/);assert.doesNotMatch(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:x.a.id,entityType:'CompanyKnowledge'}})),/Fictional assurance document|storageKey/);
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});assert.equal((await knowledgeWorkspace(x.ed)).indexes[0].current,false);const stale=await knowledgeSearch(x.ed,{runId:result!.id});assert.equal(stale!.current,false);assert.deepEqual(stale!.hits,[]);
 }finally{await cleanup(x);}
});

test('product-scoped retrieval excludes unscoped and unrelated evidence and invalidates stale product snapshots',async()=>{
 const x=await assuranceFixture();config();try{
  const a=await createProduct(x.ad,{code:'KA',name:'Fictional product A',description:'Knowledge scope fixture',requestKey:randomUUID(),confirm:true}),b=await createProduct(x.ad,{code:'KB',name:'Fictional product B',description:'Knowledge scope fixture',requestKey:randomUUID(),confirm:true}),file=await x.file();
  await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store});await assert.rejects(()=>searchKnowledge(x.ed,queryInput()),rejects(409));
  await scope(x,file.id,[a.id]);await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store});const search=await searchKnowledge(x.ed,queryInput('CONTENT',a.id));assert.equal(search!.hits[0].evidenceId,file.id);
  await assert.rejects(()=>searchKnowledge(x.ed,queryInput('CONTENT',b.id)),rejects(409));await assert.rejects(()=>searchKnowledge(x.ed,queryInput()),rejects(409));
  await changeProduct(x.ad,a.id,{action:'UPDATE',version:1,code:'KA',name:'Fictional product A revised',description:'Changed product scope fixture',notes:'Fictional product details independently reviewed and revised.',confirm:true});const stale=await knowledgeSearch(x.ed,{runId:search!.id});assert.equal(stale!.current,false);assert.deepEqual(stale!.hits,[]);
  await scope(x,file.id);await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store});assert.equal((await searchKnowledge(x.ed,queryInput('CONTENT',b.id)))!.hits.length,1);
  await changeProduct(x.ad,b.id,{action:'ARCHIVE',version:1,notes:'Fictional product has been removed from the current catalogue.',confirm:true});await assert.rejects(()=>searchKnowledge(x.ed,queryInput('CONTENT',b.id)),rejects(409));
 }finally{await cleanup(x);}
});

test('semantic indexing uses actual vectors, reserves bounded chunk units once with one daily operation, and caches exact query embeddings',async()=>{
 const x=await assuranceFixture();config();try{
  const task=await db.obligation.findFirstOrThrow({where:{organizationId:x.a.id}}),bytes=fixturePdf([Array.from({length:35},(_,i)=>`Fictional assurance document ${i}: records are retained and independently reviewed by the operations manager.`)]),file=await createEvidence(x.ed,task.id,'fictional-multichunk.pdf',bytes,{storage:x.store,scan:async()=>({status:'CLEAN',engine:'fictional'})});await reviewEvidence(x.ad,file.id,{decision:'APPROVED',version:1,notes:'Independently reviewed all fictional records in this document.'},x.store);await scope(x,file.id);
  let calls=0;const embed=async(values:string[])=>{calls++;return embedding(values);},request=indexInput(file.id,'SEMANTIC');const pair=await Promise.all([indexKnowledgeEvidence(x.ed,request,{storage:x.store,embed}),indexKnowledgeEvidence(x.ed,request,{storage:x.store,embed})]);assert.equal(pair[0]!.id,pair[1]!.id);assert.equal(calls,1);
  const run=await db.knowledgeIndexRun.findUniqueOrThrow({where:{id:pair[0]!.id}});assert.ok(run.chunkCount>1);assert.equal(run.dimensions,2);const reservation=await db.paidReservation.findFirstOrThrow({where:{organizationId:x.a.id,service:'AI'}});assert.equal(reservation.units,run.chunkCount);assert.equal((await db.aiDailyUsage.aggregate({where:{organizationId:x.a.id},_sum:{count:true}}))._sum.count,1);
  await indexKnowledgeEvidence(x.ed,request,{storage:x.store,embed});await indexKnowledgeEvidence(x.ed,indexInput(file.id,'SEMANTIC'),{storage:x.store,embed});assert.equal(calls,1);assert.equal(await db.paidReservation.count({where:{organizationId:x.a.id,service:'AI'}}),1);
  const query={...queryInput('SEMANTIC'),query:'authorization audit'},result=await searchKnowledge(x.ed,query,{embed});assert.equal(result!.current,true);assert.ok(result!.hits.length>0);assert.equal(result!.hits[0].scoreKind,'COSINE_SIMILARITY');assert.equal(calls,2);
  await searchKnowledge(x.ed,query,{embed});await searchKnowledge(x.ed,{...query,requestKey:randomUUID()},{embed});assert.equal(calls,2,'an unchanged query/model reuses the saved query embedding');assert.equal((await db.aiDailyUsage.aggregate({where:{organizationId:x.a.id},_sum:{count:true}}))._sum.count,2);assert.equal((run.usage as {inputValues:number}).inputValues,run.chunkCount);
  const content=await searchKnowledge(x.ed,{...queryInput(),query:'authorization audit'});assert.equal(content!.hits.length,0,'content search is not falsely described as semantic matching');
  process.env.REGPILOT_KNOWLEDGE_SEMANTIC_ENABLED='false';assert.equal(knowledgeSemanticReady(),false);await assert.rejects(()=>searchKnowledge(x.ed,{...query,requestKey:randomUUID()}),rejects(503));assert.ok((await searchKnowledge(x.ed,queryInput()))!.hits.length>0);
 }finally{await cleanup(x);}
});

test('failed, interrupted and in-flight-invalidated index attempts do not duplicate paid calls or publish citations',async()=>{
 const x=await assuranceFixture();config();try{
  const file=await x.file();await scope(x,file.id);let calls=0;const request=indexInput(file.id,'SEMANTIC'),failing=async()=>{calls++;throw Error('Fictional provider interruption');};
  await assert.rejects(()=>indexKnowledgeEvidence(x.ed,request,{storage:x.store,embed:failing}),rejects(502));const failed=(await knowledgeWorkspace(x.ed)).indexes[0];assert.equal(failed.status,'FAILED');await indexKnowledgeEvidence(x.ed,request,{storage:x.store,embed:failing});assert.equal(calls,1);await assert.rejects(()=>indexKnowledgeEvidence(x.ed,indexInput(file.id,'SEMANTIC'),{storage:x.store,embed:failing}),rejects(409));
  const retry={...indexInput(file.id,'SEMANTIC'),retryOfId:failed.id};await assert.rejects(()=>indexKnowledgeEvidence(x.ed,retry,{storage:x.store,embed:async values=>{calls++;await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});return embedding(values);}}),rejects(409));assert.equal(await db.knowledgeChunk.count({where:{organizationId:x.a.id}}),0);assert.equal(calls,2);
  const latest=(await knowledgeWorkspace(x.ed)).indexes[0];await db.knowledgeIndexRun.update({where:{id:latest.id},data:{status:'PROCESSING',failureCode:null,createdAt:new Date(Date.now()-180000)}});const expired=(await knowledgeWorkspace(x.ed)).indexes.find(row=>row.id===latest.id)!;assert.equal(expired.status,'FAILED');assert.equal(expired.failureCode,'INTERRUPTED');
  const good=await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store});assert.equal(good!.status,'READY');await db.membership.update({where:{organizationId_userId:{organizationId:x.a.id,userId:x.admin.id}},data:{role:'OWNER'}});assert.equal((await knowledgeWorkspace(x.ed)).indexes.find(row=>row.id===good!.id)!.current,false,'even a still-eligible reviewer role change invalidates the captured permission snapshot');
 }finally{await cleanup(x);}
});

test('withdrawal, expiry, tampering, explicit index removal and source deletion withhold old search quotations',async()=>{
 const x=await assuranceFixture();config();try{
  const file=await x.file();await scope(x,file.id);const indexed=await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store}),search=await searchKnowledge(x.ed,queryInput());
  await db.evidence.update({where:{id:file.id},data:{reviewStatus:'REJECTED'}});assert.equal((await knowledgeSearch(x.ed,{runId:search!.id}))!.current,false);await db.evidence.update({where:{id:file.id},data:{reviewStatus:'APPROVED'}});
  const chunk=await db.knowledgeChunk.findFirstOrThrow({where:{indexRunId:indexed!.id}});await db.knowledgeChunk.update({where:{id:chunk.id},data:{text:'A manipulated passage pretending to be the original evidence.'}});assert.equal((await knowledgeWorkspace(x.ed)).indexes[0].current,false);assert.deepEqual((await knowledgeSearch(x.ed,{runId:search!.id}))!.hits,[]);await db.knowledgeChunk.update({where:{id:chunk.id},data:{text:chunk.text}});
  await db.knowledgeIndexRun.update({where:{id:indexed!.id},data:{expiresAt:new Date(Date.now()-1)}});assert.match((await knowledgeWorkspace(x.ed)).indexes[0].staleReason,/expired/);
  const fresh=await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store});const current=await searchKnowledge(x.ed,queryInput());await retireKnowledgeIndex(x.ed,fresh!.id);assert.equal(await db.knowledgeChunk.count({where:{indexRunId:fresh!.id}}),0);assert.deepEqual((await knowledgeSearch(x.ed,{runId:current!.id}))!.hits,[]);
  const again=await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store}),beforeDelete=await searchKnowledge(x.ed,queryInput());await db.evidence.delete({where:{id:file.id}});assert.equal(await db.knowledgeIndexRun.count({where:{id:again!.id}}),0);assert.deepEqual((await knowledgeSearch(x.ed,{runId:beforeDelete!.id}))!.hits,[]);
  assert.doesNotMatch(JSON.stringify(await knowledgeWorkspace(x.out)),/fictional-1.pdf/);
 }finally{await cleanup(x);}
});

test('historical attempts do not block active indexes or new work, and exact saved operations remain recoverable beyond the display limit',async()=>{
 const x=await assuranceFixture();config();try{
  const file=await x.file();await scope(x,file.id);const original=indexInput(file.id),indexed=await indexKnowledgeEvidence(x.ed,original,{storage:x.store}),search=await searchKnowledge(x.ed,queryInput()),template=await db.knowledgeIndexRun.findUniqueOrThrow({where:{id:indexed!.id}}),searchTemplate=await db.knowledgeSearchRun.findUniqueOrThrow({where:{id:search!.id}});
  await db.knowledgeIndexRun.update({where:{id:template.id},data:{createdAt:new Date(Date.now()-20*86400000)}});
  await db.knowledgeIndexRun.createMany({data:Array.from({length:205},(_,i)=>({...template,id:randomUUID(),requestKey:randomUUID(),requestHash:hashValue({fixture:i}),inputHash:hashValue({historical:i}),status:'FAILED',failureCode:'FICTIONAL_HISTORY',chunkCount:0,chunksHash:null,createdAt:new Date(Date.now()-2*86400000-i*1000),updatedAt:new Date(Date.now()-2*86400000-i*1000),context:template.context as any,usage:undefined}))});
  await db.knowledgeSearchRun.createMany({data:Array.from({length:505},(_,i)=>({...searchTemplate,id:randomUUID(),requestKey:randomUUID(),requestHash:hashValue({search:i}),inputHash:hashValue({historicalSearch:i}),status:'FAILED',failureCode:'FICTIONAL_HISTORY',createdAt:new Date(Date.now()-2*86400000-i*1000),updatedAt:new Date(Date.now()-2*86400000-i*1000),context:searchTemplate.context as any,result:undefined,vector:undefined,usage:undefined}))});
  const workspace=await knowledgeWorkspace(x.ed);assert.ok(workspace.indexes.length<=201);assert.equal(workspace.indexes.find(run=>run.id===template.id)!.current,true,'active index is loaded even when older than the display window');assert.equal((await knowledgeIndex(x.ed,{requestKey:original.requestKey}))!.current,true);assert.equal((await knowledgeSearch(x.ed,{runId:search!.id}))!.current,true);
  assert.equal((await searchKnowledge(x.ed,queryInput()))!.hits.length,1,'historical searches do not exhaust an all-time allowance');
  const second=await x.file();await scope(x,second.id);assert.equal((await indexKnowledgeEvidence(x.ed,indexInput(second.id),{storage:x.store}))!.status,'READY','historical index attempts do not prevent new approved documents');
 }finally{await cleanup(x);}
});

test('the supported 40-document, 1600-chunk vector corpus is read and searched within the real PostgreSQL transaction boundary',async t=>{
 const x=await assuranceFixture();config();try{
  const task=await db.obligation.findFirstOrThrow({where:{organizationId:x.a.id}}),bytes=fixturePdf(Array.from({length:40},(_,i)=>[`Fictional policy page ${i+1}: company records require an independent review.`])),source=await createEvidence(x.ed,task.id,'fictional-boundary-corpus.pdf',bytes,{storage:x.store,scan:async()=>({status:'CLEAN',engine:'fictional'})});await reviewEvidence(x.ad,source.id,{decision:'APPROVED',version:1,notes:'Independently reviewed the complete fictional forty-page document.'},x.store);await scope(x,source.id);
  const vector=Array.from({length:1536},(_,i)=>Math.sin(i+1)/100),embed=async(values:string[])=>({...embedding(values),vectors:values.map(()=>vector)}),indexed=await indexKnowledgeEvidence(x.ed,indexInput(source.id,'SEMANTIC'),{storage:x.store,embed}),template=await db.knowledgeIndexRun.findUniqueOrThrow({where:{id:indexed!.id}}),file=await db.evidence.findUniqueOrThrow({where:{id:source.id}}),chunks=await db.knowledgeChunk.findMany({where:{indexRunId:template.id},orderBy:{ordinal:'asc'}});
  assert.equal(chunks.length,40);
  const beforeClones=(await knowledgeWorkspace(x.ed)).indexes.find(run=>run.id===template.id)!;
  const expectedVector=vectorForKnowledgeStorage(vector),persistedVector=chunks[0].vector as number[],roundTripDifferences=persistedVector.filter((value,i)=>value!==expectedVector[i]).length;
  assert.equal(beforeClones.current,true,`Baseline semantic index must round-trip current: ${beforeClones.staleReason}; vector representation differences: ${roundTripDifferences}`);
  assert.equal(roundTripDifferences,0,'fixed-point embedding directions round trip exactly');
  // Controlled fixture clones retain the actual approved bytes and exact page text; no provider-quality claim is made.
  for(let i=1;i<40;i++){
   const evidenceId=randomUUID(),indexId=randomUUID(),context=structuredClone(template.context) as any;context.file.id=evidenceId;
   await db.evidence.create({data:{...file,id:evidenceId}});await db.evidenceApplicability.create({data:{organizationId:x.a.id,evidenceId,mode:'GLOBAL',updatedById:x.ad.userId}});
   await db.knowledgeIndexRun.create({data:{...template,id:indexId,evidenceId,requestKey:randomUUID(),requestHash:hashValue({boundary:i}),inputHash:hashValue(context),context,usage:template.usage as any}});
   await db.knowledgeChunk.createMany({data:chunks.map(chunk=>({...chunk,id:randomUUID(),indexRunId:indexId,vector:chunk.vector as any}))});
  }
  const start=performance.now(),result=await searchKnowledge(x.ed,{...queryInput('SEMANTIC'),query:'independently examine retained information'},{embed}),elapsed=performance.now()-start;
  assert.equal(result!.current,true);assert.equal(result!.hits.length,10);assert.equal(await db.knowledgeChunk.count({where:{organizationId:x.a.id}}),1600);
  t.diagnostic(`Controlled PostgreSQL retrieval at 40 documents × 40 chunks × 1536 dimensions: ${elapsed.toFixed(1)} ms across capture, freshness commit and safe response. Each transaction retains the production 12-second timeout; this is not a hosted load or live semantic-quality evaluation.`);
 }finally{await cleanup(x);}
});

test('workspace research finds business records, separates published procedures and respects tenant and document scope',async()=>{
 const {researchWorkspaceQuestion}=await import('../lib/server/company-knowledge-service');
 const {reviewedFiles}=await import('../lib/server/reviewed-files');
 const x=await assuranceFixture();config();
 const official=async()=>({status:'no_match' as const,catalogueSize:0,nations:[],checked:[],unavailable:0,citations:[],answer:{points:[],model:null}});
 try{
  const request={question:'Fictional assurance supplier',asset:''};
  let reads=0;
  await assert.rejects(()=>researchWorkspaceQuestion(x.ed,request,async()=>{reads++;return official();}),rejects(403));
  assert.equal(reads,0);
  const supplier=await db.vendor.create({data:{organizationId:x.a.id,ownerId:x.admin.id,name:'Fictional assurance supplier',service:'UK payroll processing service',criticality:'HIGH',dataAccess:'BUSINESS',nextReviewAt:new Date()}});
  const file=await x.file();await scope(x,file.id);
  await indexKnowledgeEvidence(x.ed,indexInput(file.id),{storage:x.store});
  const first=await researchWorkspaceQuestion(x.ad,request,official);
  assert.equal(first.evidence[0]?.evidenceId,file.id);
  assert.ok(first.records.some(row=>row.kind==='Supplier'&&row.id===supplier.id));
  const other=await researchWorkspaceQuestion(x.out,request,official);
  assert.deepEqual(other.evidence,[]);assert.ok(!other.records.some(row=>row.id===supplier.id));
  const product=await createProduct(x.ad,{code:'SCOPE',name:'Supplier portal',description:'Fictional service scope',requestKey:randomUUID(),confirm:true});
  assert.deepEqual((await researchWorkspaceQuestion(x.ad,{...request,productId:product.id},official)).records,[]);
  const [snapshot]=await db.$transaction(tx=>reviewedFiles(tx,x.a.id,[file.id]));
  const policy=await db.policy.create({data:{organizationId:x.a.id,title:'Supplier assurance procedure',currentRevision:1}});
  const revision=await db.policyRevision.create({data:{organizationId:x.a.id,policyId:policy.id,number:1,summary:'Evidence review',file:snapshot,fileHash:hashValue(snapshot),createdById:x.editor.id,reviewerId:x.admin.id,status:'PUBLISHED',publishedAt:new Date()}});
  const published=await researchWorkspaceQuestion(x.ad,request,official);
  assert.equal(published.procedures[0]?.policy?.number,1);assert.deepEqual(published.evidence,[]);
  await db.policyRevision.update({where:{id:revision.id},data:{status:'SUPERSEDED'}});
  const obsolete=await researchWorkspaceQuestion(x.ad,request,official);
  assert.deepEqual(obsolete.procedures,[]);assert.deepEqual(obsolete.evidence,[]);
 }finally{await cleanup(x);}
});
