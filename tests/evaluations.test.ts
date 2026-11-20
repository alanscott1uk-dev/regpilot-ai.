import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {retrievalMetrics,evaluationCaseSpec,summariseRetrievalBenchmark} from '../lib/evaluations';
test('retrieval scoring deduplicates chunks, uses document ranks and distinguishes no-support outcomes',()=>{const a=randomUUID(),b=randomUUID(),c=randomUUID();assert.deepEqual(retrievalMetrics([a,b],[c,c,a,a],false),{retrievedDocumentIds:[c,a],relevantReturned:1,expectedDocuments:2,recallAt10:.5,precisionReturned:.5,reciprocalRank:.5,noSupportCorrect:null});assert.equal(retrievalMetrics([a],[],false).recallAt10,0);assert.equal(retrievalMetrics([],[],true).noSupportCorrect,true);assert.equal(retrievalMetrics([],[a],true).noSupportCorrect,false);assert.equal(retrievalMetrics([],[],true).recallAt10,null);assert.throws(()=>retrievalMetrics([],[],false));});
test('reference specification rejects fabricated ambiguous outcomes and duplicate sources',()=>{const a=randomUUID(),value={title:'Fictional reference',query:'What supports retention?',productId:null,expectedEvidenceIds:[a],expectNoSupport:false,guidance:'Inspect the original document and explain the precise limits of the answer.',category:'NORMAL'};assert.ok(evaluationCaseSpec.safeParse(value).success);for(const change of [{expectNoSupport:true},{expectedEvidenceIds:[]},{expectedEvidenceIds:[a,a]},{guidance:'yes'},{category:'TRUST_ME'}])assert.equal(evaluationCaseSpec.safeParse({...value,...change}).success,false);});

test('benchmark reports latest attempts, isolates models and excludes old reference versions', () => {
  const references = ['policy', 'retention', 'negative', 'pending', 'missing', 'old'].map(id => ({
    id, version: 2, state: id === 'old' ? 'RETIRED' : 'APPROVED',
  }));
  const run = (
    id: string, caseId: string, day: number,
    status: 'COMPLETED' | 'FAILED' | 'PROCESSING' = 'COMPLETED',
    model: string | null = null,
  ) => ({
    id, caseId, caseVersion: 2, createdAt: new Date(Date.UTC(2026, 10, day)),
    method: model ? 'SEMANTIC' as const : 'CONTENT' as const, model, status,
    result: status !== 'COMPLETED' ? null : {
      metrics: caseId === 'negative' ? retrievalMetrics([], [], true) : retrievalMetrics(['source'], ['source'], false),
    },
  });
  const groups = summariseRetrievalBenchmark(references, [
    run('older-success', 'policy', 1), run('latest-failure', 'policy', 2, 'FAILED'),
    {...run('old-version', 'missing', 3), caseVersion: 1},
    run('normal', 'retention', 3), run('no-support', 'negative', 3),
    run('processing', 'pending', 3, 'PROCESSING'), run('retired', 'old', 3),
    run('a', 'policy', 3, 'COMPLETED', 'model-a'), run('b', 'policy', 3, 'FAILED', 'model-b'),
  ]);
  const content = groups.find(group => group.method === 'CONTENT')!;
  assert.deepEqual(
    [content.approvedCases, content.completed, content.failed, content.pending, content.unmeasured],
    [5, 2, 1, 1, 1],
  );
  assert.deepEqual(content.recall, {value: 1, count: 1});
  assert.deepEqual(content.precision, {value: 1, count: 1});
  assert.deepEqual(content.noSupport, {correct: 1, count: 1});
  assert.ok(content.attempts.some(attempt => attempt.id === 'latest-failure'));
  assert.ok(!content.attempts.some(attempt => attempt.id === 'older-success'));
  assert.equal(groups.find(group => group.model === 'model-a')!.completed, 1);
  assert.deepEqual(groups.find(group => group.model === 'model-b')!.recall, {value: null, count: 0});
});

test('benchmark counts a missed expected document while leaving undefined precision unscored', () => {
  const [group] = summariseRetrievalBenchmark([{id: 'case', version: 2, state: 'APPROVED'}], [{
    id: 'run', caseId: 'case', caseVersion: 2, method: 'CONTENT', model: null,
    status: 'COMPLETED', createdAt: new Date(), result: {metrics: retrievalMetrics(['source'], [], false)},
  }]);
  assert.deepEqual(group.recall, {value: 0, count: 1});
  assert.deepEqual(group.precision, {value: null, count: 0});
  assert.deepEqual(group.noSupport, {correct: 0, count: 0});
});
