import assert from 'node:assert/strict';
/** Fictional boundary test: provider organization identity must never replace workspace identity. */
export async function infrastructureJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],payloads=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001',control='123e4567-e89b-42d3-a456-426614174002',now=new Date().toISOString();
 const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:now}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 const data={tasks:[],summary:{policyReading:0,vendorReviewsDue:0,open:0,overdue:0,evidencePending:0,monitoringAttention:0},assessments:[],imports:[],proposal:null,controls:[{id:control,title:'Fictional infrastructure control',enabled:true,nextReviewAt:now,owner:{id:user,email:session.user.email},links:[],_count:{links:0,tasks:0}}],members:[{role:'OWNER',user:{id:user,email:session.user.email}}],evidence:[],connectors:[],sourceImpact:{tasks:[]},features:{programme:false,ai:false,connectors:true,microsoft365:false,googleWorkspace:false,gitlab:false,cloudflare:false,companiesHouse:false,vercel:true,supabase:true,okta:true,automation:false},generatedAt:now};
 let role='OWNER';const groupId='00g'+'B'.repeat(17),removedUserId='00u'+'A'.repeat(17);
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:session.user}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:org,name:'Fictional infrastructure',role}]}}));
 await context.route('**/api/workspace/operations*',route=>route.fulfill({json:data}));
 await context.route('**/api/workspace/connectors',route=>{payloads.push(route.request().postDataJSON());return route.fulfill({json:{id:control,version:1}})});
 await context.route('**/api/workspace/connectors/okta*',route=>{
  const req=route.request(),params=new URL(req.url()).searchParams;
  if(req.method()==='POST'){
   assert.deepEqual(req.postDataJSON(),{organizationId:org});
   return route.fulfill({json:{link:'https://connect.nango.dev/?session_token=fictional'}});
  }
  assert.equal(params.get('organizationId'),org);
  if(params.has('query')){
   assert.equal(params.get('connectionId'),'FictionalDirectory');assert.equal(params.get('query'),'Finance');
   return route.fulfill({json:{groups:[{id:groupId,name:'Finance reviewers'}]}});
  }
  return route.fulfill({json:{connections:['FictionalDirectory']}});
 });
 try{
  await page.goto(base+'/team/operations?view=connections',{waitUntil:'domcontentloaded'});
  await page.getByRole('combobox',{name:'System',exact:true}).selectOption('SUPABASE');
  await page.getByLabel('Responsible control').selectOption(control);
  await page.getByLabel('Supabase project reference').fill('abcdefghijklmnopqrst');
  await page.getByLabel('Supabase organization ID').fill('orgabcdefghijklmnopq');
  await page.getByLabel('Scoped Supabase management token',{exact:true}).fill('fictional-dedicated-read-only-token');
  assert.equal(await page.getByRole('button',{name:'Save connection',exact:true}).isEnabled(),false);
  await page.getByRole('checkbox',{name:/I authorise read-only collection/}).check();
  await page.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Connection saved.'}).waitFor();
  assert.equal(payloads.length,1);assert.equal(payloads[0].organizationId,org);assert.equal(payloads[0].providerOrganizationId,'orgabcdefghijklmnopq');assert.equal(payloads[0].provider,'SUPABASE');
  assert.equal(await page.getByLabel('Scoped Supabase management token',{exact:true}).inputValue(),'');
  await page.getByRole('combobox',{name:'System',exact:true}).selectOption('VERCEL');
  await page.getByLabel('Vercel project ID').fill('prj_CaseSensitive123');await page.getByLabel('Vercel team ID').fill('team_CaseSensitive123');
  await page.getByLabel('Read-only Vercel project token',{exact:true}).fill('fictional-dedicated-read-only-token');
  await page.getByRole('checkbox',{name:/I authorise read-only collection/}).check();
  await page.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Connection saved.'}).waitFor();
  assert.equal(payloads.length,2);assert.equal(payloads[1].projectId,'prj_CaseSensitive123');assert.equal(payloads[1].teamId,'team_CaseSensitive123');
  await page.getByRole('combobox',{name:'System',exact:true}).selectOption('OKTA');
  await page.getByRole('button',{name:'Connect Okta',exact:true}).click();
  await page.getByRole('link',{name:'Open Okta authorisation'}).waitFor();
  await page.getByRole('button',{name:'Load authorised directories'}).click();
  await page.getByLabel('Group name',{exact:true}).fill('Finance');
  await page.getByRole('button',{name:'Find Okta groups'}).click();
  await page.getByLabel('Matching groups').selectOption({label:'Finance reviewers'});
  assert.equal(await page.getByLabel('Okta group ID').inputValue(),groupId);
  await page.getByLabel('User ID to verify removal (optional)').fill(removedUserId);
  await page.getByRole('checkbox',{name:/I authorise read-only collection/}).check();
  const saved=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/workspace/connectors'&&req.method()==='POST');
  await page.getByRole('button',{name:'Save connection',exact:true}).click();
  const okta=(await saved).postDataJSON();
  assert.equal(okta.organizationId,org);assert.equal(okta.groupId,groupId);assert.equal(okta.removedUserId,removedUserId);
  assert.equal(okta.connectionId,'FictionalDirectory');assert.ok(!('token' in okta));
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'infrastructure form overflow '+overflow);
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Collect evidence. Spot changes. Assign action.').waitFor();assert.equal(await page.getByRole('combobox',{name:'System',exact:true}).count(),0);
  assert.deepEqual(errors,[]);return {scenario:'infrastructure-'+name,passed:true,overflowPx:overflow,steps:19,testType:'fictional connector UI fixture; no customer credential assertion'};
 }catch(e){throw new Error(e.message+'; browser errors: '+JSON.stringify(errors));}finally{await context.close();}
}
