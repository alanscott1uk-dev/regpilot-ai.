import test from 'node:test';
import assert from 'node:assert/strict';
import {githubActivityChecks} from '../lib/connectors/github-activity';

const sha='a'.repeat(40),branch='release/one',repository='example/repo';
const pull={number:42,user:{id:7},base:{repo:{full_name:repository},ref:branch},head:{sha},merged_at:'2026-04-02T12:00:00Z'};
const approval={user:{id:8},state:'APPROVED',commit_id:sha,submitted_at:'2026-04-02T11:50:00Z'};
const alert={state:'open',security_vulnerability:{severity:'critical'},private_content:'fixture-private'};
async function sample(pulls:unknown=[pull],reviews:unknown=[approval],alerts:unknown=[alert],more=false){
 return githubActivityChecks(async path=>{
  const url=new URL(path,'https://example.invalid/');
  if(url.pathname==='/pulls'){
   assert.equal(url.searchParams.get('base'),branch);assert.equal(url.searchParams.get('state'),'closed');
   return pulls===null?null:{body:pulls,more:false};
  }
  if(url.pathname==='/pulls/42/reviews')return reviews===null?null:{body:reviews,more};
  assert.equal(url.pathname,'/dependabot/alerts');assert.equal(url.searchParams.get('severity'),'high,critical');assert.equal(url.searchParams.get('state'),'open');
  return alerts===null?null:{body:alerts,more:false};
 },repository,branch);
}
test('sampled GitHub evidence keeps only check results and verifies the selected base',async()=>{
 const checks=await sample();
 assert.deepEqual(checks.map(check=>check.status),['PASS','FAIL']);
 assert.doesNotMatch(JSON.stringify(checks),/fixture-private|aaaaaaa|2026-04-02/);
 for(const rows of [null,[],[{...pull,base:{repo:{full_name:'elsewhere/repo'},ref:branch}}],[{...pull,merged_at:null}]]){
  assert.equal((await sample(rows))[0].status,'UNKNOWN');
 }
});
test('sampled approval must come from another user on the final head before merge',async()=>{
 for(const review of [{...approval,user:pull.user},{...approval,commit_id:'c'.repeat(40)},{...approval,submitted_at:'2026-04-03T12:00:00Z'}])
  assert.equal((await sample([pull],[review]))[0].status,'FAIL');
 for(const reviews of [null,{},[{...approval,user:null}],[{...approval,state:'DISMISSED'}]])
  assert.equal((await sample([pull],reviews))[0].status,'UNKNOWN');
 assert.equal((await sample([pull],[]))[0].status,'FAIL');
 assert.equal((await sample([pull],[],[],true))[0].status,'UNKNOWN');
});
test('only a successful empty filtered list passes the Dependabot check',async()=>{
 assert.equal((await sample([],null,[]))[1].status,'PASS');
 for(const value of [null,{},[{}],[{...alert,state:'fixed'}],[{...alert,repository:{full_name:'elsewhere/repo'}}]])
  assert.equal((await sample([],null,value))[1].status,'UNKNOWN');
});
