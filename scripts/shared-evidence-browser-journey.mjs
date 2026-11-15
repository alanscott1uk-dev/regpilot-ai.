import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
export async function sharedEvidenceJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],writes=[],reads=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',other='123e4567-e89b-42d3-a456-426614174099',user='123e4567-e89b-42d3-a456-426614174001',primary='123e4567-e89b-42d3-a456-426614174002',secondary='123e4567-e89b-42d3-a456-426614174003',connector='123e4567-e89b-42d3-a456-426614174004',link='123e4567-e89b-42d3-a456-426614174005',now=new Date().toISOString();
 const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:now}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 const controls=[{id:primary,title:'Connection ownership',owner:{email:'connection-owner@example.invalid'}},{id:secondary,title:'Access control',owner:{email:'access-owner@example.invalid'}}].map(c=>({...c,version:1,enabled:true,nextReviewAt:now,links:[],_count:{links:0,tasks:0}}));
 const observation={engine:'fictional-1',sourceUrl:'https://github.com/fictional/shared',capturedAt:now,checks:[{id:'setting',label:'Review setting',status:'PASS',observed:'Recorded approval present',nextStep:'Inspect scope'}],limitations:['Fictional configuration evidence.']};
 const saved={id:connector,version:1,provider:'GITHUB',controlId:primary,repository:'fictional/shared',branch:'main',intervalHours:24,enabled:true,checking:false,failureCode:null,stale:false,changes:[],controlLinks:[],lastSuccessAt:now,runs:[{id:'run',outcome:'OBSERVED',capturedAt:now,current:true,result:observation}]};
 const data={tasks:[],summary:{policyReading:0,vendorReviewsDue:0,open:0,overdue:0,evidencePending:0,monitoringAttention:0},assessments:[],imports:[],proposal:null,controls,members:[],evidence:[],connectors:[saved],sourceImpact:{tasks:[]},features:{programme:false,ai:false,connectors:true,microsoft365:false,googleWorkspace:false,gitlab:false,cloudflare:false,companiesHouse:false,vercel:false,supabase:false,automation:true},generatedAt:now};
 let role='OWNER';
 await context.route('https://auth-fixture.example.invalid/**',r=>r.fulfill({json:{user:session.user}}));
 await context.route('**/api/ai/context',r=>r.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:other,name:'Other workspace',role},{id:org,name:'Requested shared workspace',role}]}}));
 await context.route('**/api/workspace/operations*',r=>{reads.push(new URL(r.request().url()).searchParams.get('organizationId'));return r.fulfill({json:data});});
 await context.route(/\/api\/workspace\/connectors\//,r=>{assert.ok(r.request().url().endsWith('/'+connector+'/controls'),'reuse must not call verification or rotate credentials');const b=r.request().postDataJSON();writes.push(b);saved.controlLinks=b.action==='LINK'?[{id:link,controlId:secondary,rationale:b.rationale,control:controls[1]}]:[];return r.fulfill({json:{id:link}});});
 try{
  await page.goto(base+'/team/operations?view=connections&organizationId='+org,{waitUntil:'domcontentloaded'});
  await page.getByText('Evidence used by 1 control',{exact:true}).click();
  assert.equal(await page.getByLabel('Organisation',{exact:true}).inputValue(),org);assert.ok(reads.every(id=>id===org));
  const form=page.getByRole('form',{name:'Reuse connected evidence'});
  assert.equal(await form.getByRole('button',{name:'Reuse evidence for this control'}).isEnabled(),false);
  await form.getByLabel('Additional control',{exact:true}).selectOption(secondary);
  await form.getByLabel('Why this evidence supports the control').fill('This fictional system provides settings relevant to access control. The owner will review applicability independently.');
  await form.getByRole('checkbox',{name:/I checked the relevance/}).check();await form.getByRole('button',{name:'Reuse evidence for this control'}).click();
  await page.getByText('Evidence used by 2 controls',{exact:true}).click();assert.equal(writes.length,1);assert.equal(writes[0].organizationId,org);assert.equal(writes[0].controlId,secondary);assert.equal(writes[0].controlVersion,1);assert.equal(writes[0].token,undefined);
  await page.getByText('access-owner@example.invalid · Active control',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Remove evidence link',exact:true}).click();await page.getByRole('button',{name:'Keep link',exact:true}).click();assert.equal(writes.length,1);
  await page.getByRole('button',{name:'Remove evidence link',exact:true}).click();await page.getByRole('button',{name:'Confirm removal',exact:true}).click();
  await page.getByText('Evidence used by 1 control',{exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(writes[1].action,'UNLINK');assert.equal(writes[1].linkId,link);
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'shared evidence overflow '+overflow);
  await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/shared-evidence-'+name+'.png',fullPage:true});
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Evidence used by 1 control',{exact:true}).click();assert.equal(await page.getByRole('form',{name:'Reuse connected evidence'}).count(),0);
  assert.deepEqual(errors,[]);return {scenario:'shared-evidence-'+name,passed:true,steps:12,overflowPx:overflow,testType:'fictional UI fixture; database tenancy and automation independently tested'};
 }catch(e){await mkdir('artifacts/usability',{recursive:true});await page.screenshot({path:'artifacts/usability/shared-evidence-'+name+'-failure.png',fullPage:true}).catch(()=>{});throw new Error(e.message+'; client errors: '+JSON.stringify(errors)+'; visible page: '+(await page.locator('body').innerText()).slice(-5000));}finally{await context.close();}
}
