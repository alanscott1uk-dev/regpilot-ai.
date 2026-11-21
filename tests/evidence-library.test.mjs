import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvidenceLibraryQuery,EvidenceLibraryInputError} from '../lib/evidence-library.mjs';
test('evidence library rejects ambiguous identities, filters, oversized searches and invalid page cursors',()=>{
 for(const input of ['organizationId=a&organizationId=b','evidenceId=123','evidenceId=&evidenceId=','review=approved&review=all','format=html','uploader=outside','page=0','page=-1','page=2.5','targetPage=1000000','q='+encodeURIComponent('x'.repeat(121)),'targetQ='+encodeURIComponent('a\u0000b')]){
  assert.throws(()=>parseEvidenceLibraryQuery(new URLSearchParams(input)),EvidenceLibraryInputError,input);
 }
 const q=parseEvidenceLibraryQuery(new URLSearchParams('q=annual%2525_review.pdf&review=pending&format=docx&uploader=mine&page=3&targetQ=training&targetPage=2'));
 assert.equal(q.q,'annual%25_review.pdf');assert.equal(q.page,3);assert.equal(q.targetPage,2);assert.equal(q.review,'pending');
});
