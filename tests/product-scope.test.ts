import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {answerMatchesProduct,createProductInput,evidenceScopeInput,questionProductContextSchema} from '../lib/product-scope';
import {questionnaireInput,questionsSchema} from '../lib/assurance-operations';
import {classifyQuestion,type KnowledgeAnswer} from '../lib/questionnaire-automation';
import {captureQuestionProductContextFromState,filterProductEvidenceFromState,assertAnswerProductContextFromState,type ProductScopeState} from '../lib/server/product-service';

function fixture(){const a={id:randomUUID(),code:'ALPHA',name:'Alpha platform',version:1},b={id:randomUUID(),code:'BETA',name:'Beta platform',version:1},global=randomUUID(),onlyA=randomUUID(),onlyB=randomUUID(),unscoped=randomUUID();const state:ProductScopeState={products:new Map([a,b].map(p=>[p.id,{...p,status:'ACTIVE'}])),applicability:new Map([[global,{mode:'GLOBAL',version:1,productIds:[]}],[onlyA,{mode:'PRODUCT',version:1,productIds:[a.id]}],[onlyB,{mode:'PRODUCT',version:1,productIds:[b.id]}]])};return {a,b,global,onlyA,onlyB,unscoped,state};}
test('explicit evidence applicability separates products and global knowledge without treating legacy files as global',()=>{
 const x=fixture(),ids=[x.onlyA,x.onlyB,x.global,x.unscoped];
 assert.deepEqual(filterProductEvidenceFromState(x.state,ids,null).eligibleEvidenceIds,[x.global]);
 assert.deepEqual(filterProductEvidenceFromState(x.state,ids,x.a.id).eligibleEvidenceIds.sort(),[x.global,x.onlyA].sort());
 assert.deepEqual(filterProductEvidenceFromState(x.state,ids,x.b.id).eligibleEvidenceIds.sort(),[x.global,x.onlyB].sort());
 x.state.products.set(x.a.id,{...x.a,status:'ARCHIVED'});
 assert.throws(()=>filterProductEvidenceFromState(x.state,ids,x.a.id),/unavailable or archived/);
 assert.throws(()=>filterProductEvidenceFromState(x.state,ids,randomUUID()),/unavailable or archived/);
});
test('per-question context changes for its selected product and evidence, while legacy context and unrelated products stay stable',()=>{
 const x=fixture(),row={productContext:{format:'product-questionnaire-v1',products:[x.a,x.b]}},question={productId:x.a.id,productName:x.a.name};
 const before=captureQuestionProductContextFromState(x.state,row,question,[x.onlyA,x.global]);assert.ok(questionProductContextSchema.safeParse(before).success);
 x.state.products.set(x.b.id,{...x.b,name:'Updated Beta',version:2,status:'ACTIVE'});
 assert.deepEqual(captureQuestionProductContextFromState(x.state,row,question,[x.global,x.onlyA]),before);
 assert.equal(captureQuestionProductContextFromState(x.state,{}, {},[x.unscoped]),null);
 assert.throws(()=>captureQuestionProductContextFromState(x.state,row,question,[x.onlyB]),/explicitly apply/);
 x.state.applicability.set(x.onlyA,{mode:'PRODUCT',version:2,productIds:[x.b.id]});
 assert.throws(()=>captureQuestionProductContextFromState(x.state,row,question,[x.onlyA]),/explicitly apply/);
 x.state.products.set(x.a.id,{...x.a,version:2,status:'ACTIVE'});
 assert.throws(()=>captureQuestionProductContextFromState(x.state,row,question,[]),/Refresh questionnaire/);
});
test('retrieval ranks only the matching product or deliberate global answers and rejects stale product answer snapshots',()=>{
 const x=fixture(),question='How are customer backups encrypted?';
 const base:KnowledgeAnswer={id:randomUUID(),question,scope:'UK systems',answer:'Customer backup encryption is configured and independently reviewed each quarter.',version:2,contentHash:'a'.repeat(64),validUntil:'2030-01-01',status:'APPROVED',current:true,reason:''};
 const legacy={...base},a={...base,id:randomUUID(),productId:x.a.id,productContext:{format:'product-answer-v1',mode:'PRODUCT',product:x.a}},b={...base,id:randomUUID(),productId:x.b.id,answer:'Beta uses a different backup configuration and retention period.',productContext:{format:'product-answer-v1',mode:'PRODUCT',product:x.b}},global={...base,id:randomUUID(),productContext:{format:'product-answer-v1',mode:'GLOBAL'}};
 assert.equal(answerMatchesProduct({productId:x.a.id},legacy),false);assert.equal(answerMatchesProduct({productId:x.a.id},b),false);assert.equal(answerMatchesProduct({productId:x.a.id},global),true);
 assert.equal(classifyQuestion({question,productId:x.a.id},[legacy,a,b]).classification,'SUPPORTED');assert.deepEqual(classifyQuestion({question,productId:x.a.id},[legacy,a,b]).candidates.map(v=>v.id),[a.id]);
 assert.deepEqual(classifyQuestion({question},[legacy,a,b]).candidates.map(v=>v.id),[legacy.id]);
 assertAnswerProductContextFromState(x.state,a,[x.onlyA]);assert.throws(()=>assertAnswerProductContextFromState(x.state,global,[x.onlyA]),/global answer requires evidence/);
 x.state.products.set(x.a.id,{...x.a,version:2,status:'ACTIVE'});assert.throws(()=>assertAnswerProductContextFromState(x.state,a,[x.onlyA]),/Product details/);
});
test('product inputs bound catalogue selection, require explicit applicability and preserve optional legacy question fields',()=>{
 const x=fixture(),requestKey=randomUUID();assert.equal(createProductInput.parse({code:'alpha-2',name:'Alpha 2',requestKey,confirm:true}).code,'ALPHA-2');
 const scope={evidenceId:x.global,reviewVersion:1,mode:'GLOBAL',productIds:[],notes:'Applies across all reviewed company products.',requestKey,confirm:true};assert.ok(evidenceScopeInput.safeParse(scope).success);
 for(const change of [{mode:'PRODUCT'},{productIds:[x.a.id]},{confirm:false},{mode:'GLOBAL',productIds:[x.a.id,x.a.id]}])assert.equal(evidenceScopeInput.safeParse({...scope,...change}).success,false);
 const q={id:randomUUID(),reference:'Q1',question:'How are customer backups encrypted?',ownerId:randomUUID(),answerId:null,answerVersion:null,answerHash:null,status:'EMPTY',changedById:null};assert.equal('productId' in questionsSchema.parse([q])[0],false);
 assert.equal(questionsSchema.parse([{...q,productId:x.a.id,productName:x.a.name}])[0].productId,x.a.id);
 const input={title:'Product review',recipient:'Fictional customer',scope:'UK systems',ownerId:q.ownerId,rows:[q],productIds:[x.a.id,x.b.id],confirm:true};assert.equal(questionnaireInput.safeParse(input).success,true);assert.equal(questionnaireInput.safeParse({...input,productIds:[x.a.id,x.a.id]}).success,false);assert.equal(questionnaireInput.safeParse({...input,productIds:Array.from({length:11},()=>randomUUID())}).success,false);
});
