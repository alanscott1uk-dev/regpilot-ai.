import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MockEmbeddingModelV3} from 'ai/test';
import {chunkKnowledgeDocument,rankKnowledgeChunks,checkedVector,cosineSimilarity,citationHash,KNOWLEDGE_LIMITS,vectorForKnowledgeStorage,checkedStoredKnowledgeVector,storedKnowledgeHits,restoredKnowledgeHits} from '../lib/company-knowledge';
import {embedKnowledge} from '../lib/server/knowledge-embedding-model';
import type {ExtractedDocument} from '../lib/documents/coverage';

const document=(text:string,unitKind:'page'|'block'='block'):ExtractedDocument=>({version:'fictional',format:unitKind==='block'?'DOCX':'PDF',unitKind,totalPages:1,pages:[{page:1,text}],characters:text.length,truncated:false,skippedPages:[],requiresVisualReview:true});
test('bounded knowledge chunks retain exact PDF page and DOCX block offsets, including surrogate pairs',()=>{
 const text='  '+('Fictional records are checked every month. 🗂️ ').repeat(60)+'  ';
 for(const kind of ['page','block'] as const){const source=document(text,kind),chunks=chunkKnowledgeDocument(source);assert.ok(chunks.length>1);for(const chunk of chunks){assert.equal(source.pages[0].text.slice(chunk.start,chunk.end),chunk.text);assert.equal(chunk.unitKind,kind);assert.ok(chunk.text.length<=KNOWLEDGE_LIMITS.chunkCharacters);assert.doesNotMatch(chunk.text,/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);}assert.equal(chunks.at(-1)!.end,text.trimEnd().length);}
 assert.throws(()=>chunkKnowledgeDocument({...document('A fictional readable statement.'),truncated:true}),/complete readable/);
 assert.throws(()=>chunkKnowledgeDocument(document('x'.repeat(42001))),/42,000/);
 assert.throws(()=>chunkKnowledgeDocument({...document(''),pages:[]}),/complete readable/);
});
test('semantic cosine retrieval can find a concept with no word overlap; lexical search is explicitly different',()=>{
 const source=chunkKnowledgeDocument(document('Permissions are assessed quarterly by an independent manager.'))[0],evidenceId=randomUUID(),indexId=randomUUID(),chunks=[{...source,evidenceId,indexId,filename:'fictional-policy.docx',vector:[1,0]}];
 assert.equal(rankKnowledgeChunks('authorization audit',chunks,'CONTENT').length,0);
 const hits=rankKnowledgeChunks('authorization audit',chunks,'SEMANTIC',[0.9,0.1]);assert.equal(hits.length,1);assert.equal(hits[0].scoreKind,'COSINE_SIMILARITY');assert.ok(hits[0].score>0.9);assert.equal(hits[0].quoteHash,citationHash(hits[0]));assert.equal('confidence' in hits[0],false);
 const lexical=rankKnowledgeChunks('permissions quarterly',chunks,'CONTENT');assert.equal(lexical[0].scoreKind,'CONTENT_MATCH');
 assert.throws(()=>checkedVector([0,0]),/finite direction/);assert.throws(()=>checkedVector([1,Number.NaN]));assert.throws(()=>checkedVector([1,0],3),/dimensions/);assert.throws(()=>cosineSimilarity([1],[1,2]),/dimensions/);
 const sourceVector=Array.from({length:1536},(_,i)=>Math.sin(i+1)/100),stored=vectorForKnowledgeStorage(sourceVector);assert.ok(stored.every(Number.isSafeInteger));assert.deepEqual(checkedStoredKnowledgeVector(stored),stored);assert.ok(cosineSimilarity(sourceVector,stored)>0.999999999999);assert.throws(()=>checkedStoredKnowledgeVector([0.1,0.2]),/invalid/);
 assert.deepEqual(restoredKnowledgeHits(storedKnowledgeHits(hits)).map(hit=>hit.quoteHash),hits.map(hit=>hit.quoteHash));assert.equal(typeof storedKnowledgeHits(hits)[0].score,'string');
});
test('AI SDK embedding adapter preserves order, bounds serial provider splitting, records usage and never retries',async()=>{
 let active=0,maximum=0;const model=new MockEmbeddingModelV3({maxEmbeddingsPerCall:1,supportsParallelCalls:true,doEmbed:async options=>{active++;maximum=Math.max(maximum,active);assert.ok(options.abortSignal);await Promise.resolve();active--;return {embeddings:options.values.map(value=>[value==='First fictional policy'?1:0,1]),usage:{tokens:7},warnings:[]};}});
 const result=await embedKnowledge(['First fictional policy','Second fictional policy'],model);assert.deepEqual(result.vectors,[[1,1],[0,1]]);assert.equal(maximum,1);assert.equal(model.doEmbedCalls.length,2);assert.deepEqual(result.usage,{tokens:14,inputValues:2,inputCharacters:45});
 const failure=new MockEmbeddingModelV3({doEmbed:async()=>{throw Error('Fictional provider unavailable');}});await assert.rejects(()=>embedKnowledge(['Fictional policy'],failure));assert.equal(failure.doEmbedCalls.length,1);
 await assert.rejects(()=>embedKnowledge(['Fictional policy'],new MockEmbeddingModelV3({doEmbed:async()=>({embeddings:[[0,0]],usage:{tokens:1},warnings:[]})})),/finite direction/);
 await assert.rejects(()=>embedKnowledge(['Fictional policy'],''),/explicit/);
 await assert.rejects(()=>embedKnowledge(['x'.repeat(1201)],model),/bounded/);
});
test('full supported JSON-vector corpus has deterministic top citations with measured bounded work',t=>{
 const vector=Array.from({length:KNOWLEDGE_LIMITS.dimensions},(_,i)=>i===0?1:0),file=randomUUID(),index=randomUUID(),base=chunkKnowledgeDocument(document('A fictional company policy for staff access review.'))[0];
 const chunks=Array.from({length:KNOWLEDGE_LIMITS.corpusChunks},(_,i)=>({...base,ordinal:i%40,unit:i+1,evidenceId:file,indexId:index,filename:'fictional-bounded-corpus.pdf',vector}));
 const start=performance.now(),hits=rankKnowledgeChunks('How are permissions reviewed?',chunks,'SEMANTIC',vector),elapsed=performance.now()-start;
 assert.equal(hits.length,10);assert.equal(hits[0].unit,1);assert.equal(hits[9].unit,10);assert.equal(hits[0].score,1);t.diagnostic(`Controlled in-memory cosine ranking: ${chunks.length} chunks × ${vector.length} dimensions in ${elapsed.toFixed(1)} ms. This is not a live-provider quality or production load evaluation.`);
});

test('workspace research matches site identifiers, preserves exact passages and excludes retired procedures',async()=>{
 const {supportingPassages,workspaceResearchInput}=await import('../lib/workspace-research');
 const make=(filename:string,text:string)=>({...chunkKnowledgeDocument(document(text))[0],evidenceId:randomUUID(),indexId:randomUUID(),filename});
 const current=make('proc.pdf','Standard operating procedure for temperature mapping.'),
  old=make('superseded.pdf','Temperature mapping in Cold Room 1.'),sample=make('Room 1.pdf','Temperature mapping report for Cold Room-1.'),
  other=make('other.pdf','Temperature mapping in Cold Room 10.'),unrelated=make('Room 1 sanitation.pdf','Sanitation and cleaning evidence.');
 const policies=new Map([[current.evidenceId,{title:'Temperature mapping SOP',number:2}],[old.evidenceId,null]]);
 const result=supportingPassages('Find the SOP and evidence for temperature mappping','Cold Room 1',[old,other,sample,current,unrelated],policies);
 assert.deepEqual(result.procedures.map(hit=>hit.evidenceId),[current.evidenceId]);
 assert.deepEqual(result.evidence.map(hit=>hit.evidenceId),[sample.evidenceId]);
 assert.equal(result.evidence[0].quote,sample.text);assert.equal(result.evidence[0].quoteHash,citationHash(result.evidence[0]));
 assert.equal(workspaceResearchInput.safeParse({question:'Supplier access',asset:'---'}).success,false);
 const privacy=make('privacy.docx','Supplier access to payroll records undergoes quarterly review.');
 assert.equal(supportingPassages('supplier access','',[sample,privacy],new Map()).evidence[0].evidenceId,privacy.evidenceId);
});

test('custom report links round trip only selected areas and export numeric denominators',async()=>{
 const {readReportView,applyReportView}=await import('../lib/coverage-report-view');
 const {exportCoverageCsv}=await import('../lib/operational-brief.mjs');
 const params=new URLSearchParams('organizationId=org&areas=bad,api,risks,risks&attention=1');
 const view=readReportView(params);assert.deepEqual(view,{areas:['risks','api'],attentionOnly:true});
 assert.equal(applyReportView(params,view).get('areas'),'risks,api');assert.equal(params.get('organizationId'),'org');
 assert.equal(readReportView(new URLSearchParams('areas=unknown')).areas.length,10);
 const csv=exportCoverageCsv([{title:'Risk reviews',description:'Overdue risk reviews',total:42,attention:3,href:'/team/risks'}],'2026-11-20');
 assert.match(csv,/"42","3","2026-11-20"/);assert.equal(csv.split('\r\n').length,2);
});
