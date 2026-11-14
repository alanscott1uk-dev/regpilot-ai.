import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collectGithub} from '../lib/connectors/github';
import {collectGitlab} from '../lib/connectors/gitlab';
import {collectMicrosoft365} from '../lib/connectors/microsoft365';
import {collectGoogleWorkspace} from '../lib/connectors/google-workspace';
import {collectCloudflare} from '../lib/connectors/cloudflare';
import {collectCompaniesHouse} from '../lib/connectors/companies-house';
import {collectVercel,collectSupabase} from '../lib/connectors/infrastructure';
import {requestOAuthToken} from '../lib/connectors/oauth-request';
const token='synthetic-credential-never-sent-to-network';
const adapters:Array<{name:string;oauth?:boolean;run:(fetcher:typeof fetch)=>Promise<unknown>}>= [
 {name:'GitHub',run:f=>collectGithub({repository:'synthetic/project',branch:'main'},'github_pat_'+'a'.repeat(30),f)},
 {name:'GitLab',run:f=>collectGitlab({projectPath:'synthetic/project',branch:'main'},token,f)},
 {name:'Microsoft 365',oauth:true,run:f=>collectMicrosoft365({tenantId:randomUUID(),clientId:randomUUID()},token,f)},
 {name:'Google Workspace',oauth:true,run:f=>collectGoogleWorkspace({customerId:'C12345678',clientId:'123456789012.apps.googleusercontent.com'},JSON.stringify({clientSecret:token,refreshToken:token}),f)},
 {name:'Cloudflare',run:f=>collectCloudflare({zoneId:'a'.repeat(32),accountId:'b'.repeat(32)},token,f)},
 {name:'Companies House',run:f=>collectCompaniesHouse({companyNumber:'12345678'},token,f)},
 {name:'Vercel',run:f=>collectVercel({projectId:'prj_CaseSensitive123',teamId:'team_CaseSensitive123'},token,f)},
 {name:'Supabase',run:f=>collectSupabase({projectRef:'abcdefghijklmnopqrst',providerOrganizationId:'orgabcdefghijklmnopq'},token,f)}
];
for(const adapter of adapters){
 test(adapter.name+': provider cooldowns survive the complete adapter entry point',async()=>{
  for(const status of [429,503]){
   let calls=0;
   await assert.rejects(()=>adapter.run(async(_url,options)=>{calls++;assert.equal(options?.redirect,'error');return new Response(null,{status,headers:{'retry-after':'120'}});}),
    (e:any)=>e.code==='RATE_LIMITED'&&e.retryAfterSeconds===120);
   assert.equal(calls,1,'do not retry before the provider deadline');
  }
 });
 test(adapter.name+': authentication rejection and redirected responses never become evidence',async()=>{
  let calls=0;
  await assert.rejects(()=>adapter.run(async()=>{calls++;return new Response(null,{status:401});}),(e:any)=>e.code==='CREDENTIAL_REJECTED');assert.equal(calls,1);
  const moved=Response.json({access_token:token,token_type:'Bearer'});Object.defineProperty(moved,'url',{value:'https://attacker.invalid'});
  await assert.rejects(()=>adapter.run(async()=>moved),(e:any)=>e.code==='TARGET_MISMATCH');
 });
 test(adapter.name+': server errors are classified without leaking credentials or retrying token POSTs',async()=>{
  let calls=0;
  await assert.rejects(()=>adapter.run(async()=>{calls++;return new Response('secret-response-must-not-escape',{status:500});}),
   (e:any)=>e.code==='PROVIDER_UNAVAILABLE'&&!/secret-response|synthetic-credential/.test(e.message));
  assert.equal(calls,adapter.oauth?1:3);
 });
}
test('OAuth exchange destinations are fixed and network failure never replays a token POST',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw new Error('credential-secret');};
 await assert.rejects(()=>requestOAuthToken('https://attacker.invalid/token',{},fetcher,AbortSignal.timeout(1000)),(e:any)=>e.code==='INVALID_AUTH_TARGET');assert.equal(calls,0);
 await assert.rejects(()=>requestOAuthToken('https://oauth2.googleapis.com/token',{},fetcher,AbortSignal.timeout(1000)),(e:any)=>e.code==='PROVIDER_UNAVAILABLE'&&!e.message.includes('credential-secret'));assert.equal(calls,1);
});
