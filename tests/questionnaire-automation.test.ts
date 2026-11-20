import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {automationInput,classifyQuestion,rankApprovedKnowledge,knowledgeHealth,type KnowledgeAnswer} from '../lib/questionnaire-automation';
import {questionnaireInput,questionsSchema} from '../lib/assurance-operations';

const question='How do you encrypt and restore customer backups?';
function answer(overrides:Partial<KnowledgeAnswer>={}):KnowledgeAnswer{return {id:randomUUID(),question,scope:'UK customer systems',answer:'Customer backups are encrypted before storage and restored during a quarterly verification exercise.',version:2,contentHash:'a'.repeat(64),validUntil:'2030-01-01T00:00:00.000Z',status:'APPROVED',current:true,reason:'',...overrides};}

test('approved knowledge retrieval keeps exact support separate from contextual or conflicting suggestions',()=>{
 const approved=answer();
 assert.equal(classifyQuestion({question},[approved]).classification,'SUPPORTED');
 assert.equal(classifyQuestion({question,instructions:'Include retention periods and exceptions.'},[approved]).classification,'AMBIGUOUS');
 const different=answer({answer:'The customer backups remain unencrypted; encryption is planned but has not been implemented.'});
 const conflict=classifyQuestion({question},[approved,different]);
 assert.equal(conflict.classification,'CONFLICTING');assert.equal(conflict.recommendedAnswerId,null);
 const duplicate=classifyQuestion({question},[approved,answer({answer:approved.answer})]);
 assert.equal(duplicate.classification,'AMBIGUOUS');
 const related=classifyQuestion({question:'Describe encryption and restoration of customer backups.'},[approved]);
 assert.equal(related.classification,'AMBIGUOUS');assert.equal(related.candidates[0].matchKind,'RELATED');
 assert.ok(related.candidates[0].relevance<1);assert.equal('confidence' in related.candidates[0],false);
});

test('expired, withdrawn and missing knowledge are explicit gaps and cannot be selected',()=>{
 const expired=answer({current:false,reason:'Answer has expired'}),withdrawn=answer({current:false,status:'WITHDRAWN',reason:'Answer is unapproved or withdrawn'});
 const expiredInsight=classifyQuestion({question},[expired]);assert.equal(expiredInsight.classification,'EXPIRED');assert.equal(expiredInsight.candidates[0].selectable,false);
 assert.equal(classifyQuestion({question},[withdrawn]).classification,'UNANSWERED');
 assert.equal(classifyQuestion({question:'Who checks machinery calibration and factory quality?'},[answer()]).classification,'UNANSWERED');
 const health=knowledgeHealth([answer(),expired,withdrawn,answer({status:'DRAFT',current:false}),answer({current:false,reason:'Evidence changed'})]);
 assert.deepEqual(health,{total:5,current:1,expired:1,stale:1,draft:1,withdrawn:1});
});

test('retrieval is deterministic and imported instructions contribute word relevance without becoming factual support',()=>{
 const a=answer({id:'00000000-0000-4000-8000-000000000001',question:'Describe business backup controls.',answer:'Backups are encrypted in storage and restored quarterly under supervised recovery tests.'});
 const b=answer({id:'00000000-0000-4000-8000-000000000002',question:a.question,answer:'Backups are encrypted in storage and retained for thirty days with approved retention exceptions.'});
 const ranked=rankApprovedKnowledge({question:'Describe backup controls.',instructions:'Detail quarterly recovery tests.'},[b,a]);
 assert.equal(ranked[0].id,a.id);assert.equal(ranked[0].selectable,true);
 assert.deepEqual(rankApprovedKnowledge({question:'Describe backup controls.',instructions:'Detail quarterly recovery tests.'},[a,b]),ranked);
});

test('conflict detection considers knowledge beyond the visible result limit and retains an existing selection',()=>{
 const answers=Array.from({length:7},(_,index)=>answer({id:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0')}));
 answers[6].answer='These fictional backups are not encrypted; the required implementation has not been completed.';
 const insight=classifyQuestion({question,answerId:answers[5].id},answers);
 assert.equal(insight.classification,'CONFLICTING');assert.equal(insight.candidates.length,5);
 assert.ok(insight.candidates.some(candidate=>candidate.id===answers[6].id),'The conflicting response must be visible for comparison');
 assert.ok(insight.candidates.some(candidate=>candidate.id===answers[5].id),'The saved selection must remain inspectable');
});

test('structured questionnaire input preserves bounded instructions and coordinates while supporting legacy CSV',()=>{
 const base={title:'Buyer questions',recipient:'Fictional buyer',scope:'UK customer systems',ownerId:randomUUID(),requestKey:randomUUID(),confirm:true};
 const row={reference:'Q-1',question,instructions:'Explain exceptions and specify review dates.',suppliedAnswer:'Unverified buyer-supplied answer.',source:{filename:'buyer.xlsx',sha256:'b'.repeat(64),format:'XLSX',sheet:'Security',row:7,questionCell:'C7',referenceCell:'A7',answerCell:'D7',contextCells:['B7']}};
 assert.equal(questionnaireInput.safeParse({...base,csv:'reference,question\nQ1,How do you review access?'}).success,true);
 assert.equal(questionnaireInput.safeParse({...base,rows:[row]}).success,true);
 for(const changed of [{...row,instructions:'x'.repeat(4001)},{...row,source:{...row.source,questionCell:'../../secret'}},{...row,source:{...row.source,sha256:'bad'}}])assert.equal(questionnaireInput.safeParse({...base,rows:[changed]}).success,false);
 const saved=questionsSchema.parse([{...row,id:randomUUID(),ownerId:base.ownerId,answerId:null,answerVersion:null,answerHash:null,status:'EMPTY',changedById:null}]);
 assert.equal(saved[0].source?.questionCell,'C7');assert.equal(saved[0].suppliedAnswer,row.suppliedAnswer);
});

test('batch application requires explicit consent, a bounded unique selection and an exact preview fingerprint',()=>{
 const selection={questionId:randomUUID(),answerId:randomUUID()},input={operation:'APPLY',version:1,previewToken:'f'.repeat(64),requestKey:randomUUID(),selections:[selection],confirm:true};
 assert.equal(automationInput.safeParse(input).success,true);
 for(const bad of [{...input,confirm:false},{...input,selections:[]},{...input,selections:[selection,selection]},{...input,previewToken:'stale'},{...input,selections:Array.from({length:101},()=>({questionId:randomUUID(),answerId:randomUUID()}))}])assert.equal(automationInput.safeParse(bad).success,false);
 assert.equal(automationInput.safeParse({operation:'PREVIEW',version:1}).success,true);
});
