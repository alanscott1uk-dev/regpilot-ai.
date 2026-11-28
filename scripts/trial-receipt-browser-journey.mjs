import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function trialReceiptJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'});
 try{
  const page=await context.newPage(),org=randomUUID(),user=randomUUID(),revision='a'.repeat(40);
  const expiry=Math.floor(Date.now()/1000)+3600;
  const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:expiry})).toString('base64url')+'.fixture',
   refresh_token:'fictional-browser-only',expires_at:expiry,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
  await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
  await context.route('https://auth-fixture.example.invalid/**',r=>r.fulfill({json:{user:session.user}}));
  await context.route('**/api/ai/context',r=>r.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:org,name:'Example workspace',role:'OWNER'}]}}));
  const receipt={id:randomUUID(),checkedAt:'2026-11-26T15:43:16.112Z',revision,action:'list-repositories',count:1,digest:'b'.repeat(64),providerHealth:false,
   checks:[{id:'repository_secret_scanning_enabled',label:'Secret scanning',status:'UNKNOWN'}]};
  let trial;
  await context.route('**/api/workspace/trials?*',async r=>{
   if(r.request().method()==='POST'){
    const body=r.request().postDataJSON();
    assert.equal(body.receiptWindow,'previous_day');assert.equal(body.environment,'PROTECTED_PILOT');
    trial={...body,id:body.requestKey,receipt,checkpoints:[],caseReceipts:[],readings:[],readingDetails:[],startedAt:new Date().toISOString(),elapsedSeconds:null,canFinish:true};
    return r.fulfill({json:{id:trial.id}});
   }
   return r.fulfill({json:{organizationId:org,trials:trial?[trial]:[],evidence:[],hasActiveControl:true,canManage:true,deployedRelease:revision}});
  });
  await page.goto(base+'/team/trials?'+new URLSearchParams({organizationId:org,participant:'operator'}));
  await page.getByLabel('Integration to set up').selectOption('github/list-repositories');
  await page.goto(base+'/team/trials?'+new URLSearchParams({organizationId:org,participant:'github'}));
  await page.getByLabel('Release commit').waitFor();
  await page.waitForFunction(sha=>document.querySelector('input[name=release]')?.value===sha,revision);
  await page.getByRole('button',{name:'Start timer'}).click();
  await page.getByRole('heading',{name:'Attached GitHub inventory read'}).waitFor();
  await page.getByText(/The inventory read succeeded/).waitFor();
  await page.getByText(/Check code security in GitHub/).waitFor();
  const handoff=await page.getByRole('link',{name:'Assessor link to this trial and receipt'}).getAttribute('href');
  assert.equal(new URL(handoff,base).searchParams.get('trialId'),trial.id);
  await page.goto(new URL(handoff,base).href);
  await page.getByText('Receipt identity').click();
  await page.getByText(receipt.id,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Start timer'}).count(),0);
  return {scenario:'trial-receipt-'+name,passed:true};
 }finally{await context.close();}
}
