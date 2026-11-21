import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceReuseHandoff,resolveEvidenceReuse} from '../lib/evidence/reuse-handoff.mjs';

const org='123e4567-e89b-42d3-a456-426614174000',task='123e4567-e89b-42d3-a456-426614174001',file='123e4567-e89b-42d3-a456-426614174002',other='123e4567-e89b-42d3-a456-426614174003';
const query=new URLSearchParams({organizationId:org,taskId:task,evidenceId:file}).toString();

test('evidence reuse keeps one exact company, task and canonical file without accepting redirects',()=>{
 assert.equal(evidenceReuseHandoff('?organizationId='+org),null);
 assert.deepEqual(evidenceReuseHandoff(query+'&next=https://evil.invalid'),{organizationId:org,taskId:task,evidenceId:file,error:''});
 for(const value of [query+'&evidenceId='+other,query+'&organizationId='+other,query+'&taskId='+other,query+'&assessmentId='+other,'evidenceId='+file,query.replace(file,'invalid'),query.replace('evidenceId='+file,'evidenceId=')])assert.ok(evidenceReuseHandoff(value).error);
});

test('a reuse handoff selects only its exact clean file from the loaded company and task',()=>{
 const handoff=evidenceReuseHandoff(query),files=[{id:other,filename:'A different file.pdf',scanStatus:'CLEAN'},{id:file,filename:'Original.pdf',scanStatus:'CLEAN'}];
 assert.deepEqual(resolveEvidenceReuse(handoff,org,task,files),{evidenceId:file,filename:'Original.pdf',error:''});
 for(const [company,target,available] of [[other,task,files],[org,other,files],[org,task,files.slice(0,1)],[org,task,[{...files[1],scanStatus:'QUARANTINED'}]]]){
  const result=resolveEvidenceReuse(handoff,company,target,available);
  assert.equal(result.evidenceId,'');assert.ok(result.error);
 }
 assert.deepEqual(resolveEvidenceReuse(null,org,task,files),{evidenceId:'',filename:'',error:''});
});
