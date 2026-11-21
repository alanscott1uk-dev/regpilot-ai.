import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {trainingQuizSchema,trainingRequirementSchema,markTrainingQuiz,trainingQuestionsForLearner,trainingCsvCell} from '../lib/training';
const quiz=[{key:'q1',question:'Which procedure revision should be used?',choices:['The archived revision','The current assigned revision'],correctIndex:1},{key:'q2',question:'What establishes demonstrated competence?',choices:['A reading acknowledgement alone','An independent evidence-backed assessment'],correctIndex:1}];
test('knowledge checks are bounded, marked on the server and projected without answer keys',()=>{
 assert.equal(trainingQuizSchema.safeParse(quiz).success,true);assert.equal(trainingQuizSchema.safeParse([{...quiz[0],correctIndex:4}]).success,false);assert.equal(trainingQuizSchema.safeParse([quiz[0],quiz[0]]).success,false);
 assert.deepEqual(markTrainingQuiz(quiz,[{key:'q1',choice:1},{key:'q2',choice:1}],80),{score:100,passed:true});assert.deepEqual(markTrainingQuiz(quiz,[{key:'q1',choice:0},{key:'q2',choice:1}],80),{score:50,passed:false});assert.throws(()=>markTrainingQuiz(quiz,[{key:'q1',choice:1}],80),/every/);assert.throws(()=>markTrainingQuiz(quiz,[{key:'q1',choice:99},{key:'q2',choice:1}],80),/valid answer/);assert.deepEqual(markTrainingQuiz([],[],80),{score:null,passed:null});
 assert.doesNotMatch(JSON.stringify(trainingQuestionsForLearner(quiz)),/correctIndex/);assert.equal(trainingQuestionsForLearner(quiz)[0].choices.length,2);
});
test('role requirements bind criteria to an explicit procedure revision; matrix values cannot execute formulas',()=>{
 const input={requestKey:randomUUID(),version:1,policyId:randomUUID(),expectedRevision:2,objective:'Demonstrate the fictional control with a recorded practical observation.',criteria:[{key:'c1',description:'Perform and record the procedure against its specified operating conditions.'}],quiz,passPercent:80,dueDays:14,validDays:365,active:true,confirm:true};assert.equal(trainingRequirementSchema.safeParse(input).success,true);assert.equal(trainingRequirementSchema.safeParse({...input,expectedRevision:undefined}).success,false);assert.equal(trainingRequirementSchema.safeParse({...input,validDays:1000}).success,false);
 assert.equal(trainingCsvCell('=HYPERLINK("secret")'),'"\'=HYPERLINK(""secret"")"');assert.equal(trainingCsvCell('ordinary, text'),'"ordinary, text"');assert.equal(trainingCsvCell('+command'),'"\'+command"');
});
