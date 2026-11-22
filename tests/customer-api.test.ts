import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CUSTOMER_API_LIMITS,createCustomerCredentialInput,customerObservationInput,reviewCustomerObservationInput,reportedObservationOutcome} from '../lib/customer-api';
import {newCustomerApiSecret,secretHash,customerApiPage,nextCustomerApiCursor,encodeCustomerApiCursor,type CustomerApiSession} from '../lib/server/customer-api-auth';
import {customerApiOpenApi} from '../lib/customer-api-openapi';
import {hashValue} from '../lib/regulatory/intelligence';

const observation=()=>({controlId:randomUUID(),externalId:'inventory/run-3',observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),summary:'The customer integration reported aggregate device encryption status.',checks:[{key:'disk-encryption',label:'Reported disk encryption',status:'PASS' as const,observed:'12 of 12 devices reported encryption',detail:'Customer-reported inventory only; inspect the source system independently.'}]});
test('customer credentials require explicit bounded scopes, control grants and review-specific ownership',()=>{
 const create={name:'Internal inventory',scopes:['controls:read'],controlIds:[randomUUID()],expiresAt:new Date(Date.now()+86400000).toISOString(),requestKey:randomUUID(),confirm:true};
 assert.equal(createCustomerCredentialInput.safeParse(create).success,true);
 for(const changed of [{...create,controlIds:[]},{...create,scopes:['controls:write']},{...create,scopes:['controls:read','controls:read']},{...create,controlIds:Array.from({length:51},()=>randomUUID())},{...create,organizationId:randomUUID()},{...create,confirm:false}])assert.equal(createCustomerCredentialInput.safeParse(changed).success,false);
 assert.equal(createCustomerCredentialInput.safeParse({...create,scopes:['regulatory:read'],controlIds:[]}).success,true);
 const review={decision:'FOLLOW_UP',version:1,notes:'Reviewed the machine report and assigned an independent investigation.',requestKey:randomUUID(),confirm:true};
 assert.equal(reviewCustomerObservationInput.safeParse(review).success,false);
 assert.equal(reviewCustomerObservationInput.safeParse({...review,ownerId:randomUUID(),dueDate:'2026-12-01'}).success,true);
 assert.equal(reviewCustomerObservationInput.safeParse({...review,decision:'ACKNOWLEDGE',ownerId:randomUUID()}).success,false);
});
test('observations are bounded typed reports, not arbitrary write payloads or compliance decisions',()=>{
 const input=customerObservationInput.parse(observation());assert.equal(reportedObservationOutcome(input),'REPORTED_PASS');
 assert.equal(reportedObservationOutcome({...input,checks:[...input.checks,{...input.checks[0],key:'unknown',status:'UNKNOWN'}]}),'REPORTED_UNKNOWN');
 assert.equal(reportedObservationOutcome({...input,checks:[...input.checks,{...input.checks[0],key:'failure',status:'FAIL'}]}),'REPORTED_FAILURE');
 for(const changed of [{...input,approved:true},{...input,organizationId:randomUUID()},{...input,checks:[input.checks[0],input.checks[0]]},{...input,checks:[{...input.checks[0],observed:0.98}]},{...input,checks:[{...input.checks[0],status:'COMPLIANT'}]},{...input,externalId:'../invalid?secret=1'},{...input,checks:Array.from({length:21},(_,i)=>({...input.checks[0],key:'x'+i}))}])assert.equal(customerObservationInput.safeParse(changed).success,false);
 assert.equal(CUSTOMER_API_LIMITS.bodyBytes,32768);
});
test('credential secrets use independent entropy and cursors bind resource, version, company and filters',()=>{
 const secret=newCustomerApiSecret(),other=newCustomerApiSecret(secret.id);assert.notEqual(secret.token,other.token);assert.match(secret.token,/^rpk_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}$/);assert.equal(secret.secretHash,secretHash(secret.token));assert.equal(secret.hint,secret.token.slice(-8));
 const session:CustomerApiSession={credentialId:secret.id,organizationId:randomUUID(),issuedById:randomUUID(),version:1,tokenHash:secret.secretHash,rate:{limit:60,remaining:59,reset:1}},url='https://example.invalid/api/v1/tasks?limit=1&controlId='+randomUUID(),page=customerApiPage(session,url,'tasks',['controlId']),cursor=nextCustomerApiCursor(session,page,'tasks',{id:randomUUID(),createdAt:new Date(Date.now()-1000)});
 assert.equal(customerApiPage(session,url+'&cursor='+cursor,'tasks',['controlId']).asOf,page.asOf);
 for(const [actor,address,resource] of [[session,url+'&cursor='+cursor.slice(0,-1)+'!', 'tasks'],[{...session,version:2},url+'&cursor='+cursor,'tasks'],[{...session,organizationId:randomUUID()},url+'&cursor='+cursor,'tasks'],[session,url.replace('controlId=','wrong=')+'&cursor='+cursor,'tasks'],[session,url+'&cursor='+cursor,'evidence'],[session,url+'&limit=2','tasks'],[session,'https://example.invalid?limit=101','tasks'],[session,'https://example.invalid?organizationId='+session.organizationId,'tasks']] as const)assert.throws(()=>customerApiPage(actor,address,resource,['controlId']));
 const old=encodeCustomerApiCursor(session,{v:1,credentialId:session.credentialId,organizationId:session.organizationId,version:1,resource:'tasks',filterHash:hashValue({}),asOf:new Date(Date.now()-61*60000).toISOString(),at:new Date(Date.now()-62*60000).toISOString(),id:randomUUID()});assert.throws(()=>customerApiPage(session,'https://example.invalid?cursor='+old,'tasks'));
});
test('OpenAPI publishes the exact limited observation contract without machine approval operations',()=>{
 assert.equal(customerApiOpenApi.openapi,'3.1.0');assert.equal(customerApiOpenApi.info.version,'2026-11-20');
 assert.deepEqual(Object.keys(customerApiOpenApi.paths).sort(),['/controls','/evidence','/observations','/openapi','/regulatory-sources','/tasks']);
 assert.equal(customerApiOpenApi.paths['/observations'].post.parameters[0].name,'Idempotency-Key');
 const schema=customerApiOpenApi.components.schemas.ObservationInput;assert.equal(schema.additionalProperties,false);assert.ok(schema.required?.includes('controlId'));assert.equal((schema.properties?.checks as {maxItems?:number}).maxItems,20);
 assert.equal(Object.keys(customerApiOpenApi.paths['/tasks']).join(','),'get');assert.equal(Object.keys(customerApiOpenApi.paths['/evidence']).join(','),'get');
});

test('resource findings retain gaps, confirmed recovery and a repeat failure as separate observations',async()=>{
 const {findingRows,resourceSeries}=await import('../lib/resource-findings');
 const prefix='dbsync/'+randomUUID()+'/'+'a'.repeat(32)+'/';
 assert.equal(resourceSeries(prefix+randomUUID()),prefix);
 assert.equal(resourceSeries('dbsync/'+randomUUID()+'/'+randomUUID()),null);
 const check=(day:number,status:'PASS'|'FAIL'|'UNKNOWN'|null,available=true)=>({id:'read-'+day,
   at:'2026-11-'+String(day).padStart(2,'0')+'T10:00:00Z',hash:'hash-'+day,available,
   checks: status?[{key:'item-'+'b'.repeat(64),label:'Resource 7',status}]:[]});
 const start=[check(1,'FAIL'),check(2,'UNKNOWN'),check(3,null)];
 assert.equal(findingRows(start)[0].status,'UNOBSERVED');
 assert.equal(findingRows(start)[0].unresolvedSince,start[0].at);
 assert.equal(findingRows([...start,check(4,'PASS',false)])[0].passedAfterFailure,false);
 const confirmed=[...start,check(5,'PASS')];
 assert.equal(findingRows(confirmed)[0].passedAfterFailure,true);
 assert.equal(findingRows(confirmed)[0].unresolvedSince,null);
 const reopened=findingRows([...confirmed,check(7,'FAIL')])[0];
 assert.equal(reopened.firstFailureAt,start[0].at);
 assert.equal(reopened.unresolvedSince,check(7,'FAIL').at);
});
