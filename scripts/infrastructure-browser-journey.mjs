import assert from 'node:assert/strict';
/** Fictional boundary test: provider organization identity must never replace workspace identity. */
export async function infrastructureJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport,locale:'en-GB'}),page=await context.newPage(),errors=[],payloads=[];
 page.on('pageerror',e=>errors.push(e.message));
 const org='123e4567-e89b-42d3-a456-426614174000',user='123e4567-e89b-42d3-a456-426614174001',control='123e4567-e89b-42d3-a456-426614174002',now=new Date().toISOString();
 const session={access_token:'fixture.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture',refresh_token:'fictional-browser-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'fictional@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:now}};
 await context.addInitScript(value=>localStorage.setItem('sb-auth-fixture-auth-token',JSON.stringify(value)),session);
 const data={tasks:[],summary:{policyReading:0,vendorReviewsDue:0,open:0,overdue:0,evidencePending:0,monitoringAttention:0},assessments:[],imports:[],proposal:null,controls:[{id:control,title:'Fictional infrastructure control',enabled:true,nextReviewAt:now,owner:{id:user,email:session.user.email},links:[],_count:{links:0,tasks:0}}],members:[{role:'OWNER',user:{id:user,email:session.user.email}}],evidence:[],connectors:[],sourceImpact:{tasks:[]},features:{programme:false,ai:false,connectors:true,microsoft365:false,googleWorkspace:false,gitlab:false,cloudflare:false,companiesHouse:false,vercel:true,supabase:true,automation:false},generatedAt:now};
 let role='OWNER';
 await context.route('https://auth-fixture.example.invalid/**',route=>route.fulfill({json:{user:session.user}}));
 await context.route('**/api/ai/context',route=>route.fulfill({json:{email:session.user.email,userId:user,organisations:[{id:org,name:'Fictional infrastructure',role}]}}));
 await context.route('**/api/workspace/operations*',route=>route.fulfill({json:data}));
 await context.route('**/api/workspace/connectors',route=>{payloads.push(route.request().postDataJSON());return route.fulfill({json:{id:control,version:1}})});
 try{
  await page.goto(base+'/team/operations?view=connections',{waitUntil:'domcontentloaded'});
  await page.getByLabel('System',{exact:true}).selectOption('SUPABASE');
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
  await page.getByLabel('System',{exact:true}).selectOption('VERCEL');
  await page.getByLabel('Vercel project ID').fill('prj_CaseSensitive123');await page.getByLabel('Vercel team ID').fill('team_CaseSensitive123');
  await page.getByLabel('Read-only Vercel project token',{exact:true}).fill('fictional-dedicated-read-only-token');
  await page.getByRole('checkbox',{name:/I authorise read-only collection/}).check();
  await page.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Connection saved.'}).waitFor();
  assert.equal(payloads.length,2);assert.equal(payloads[1].projectId,'prj_CaseSensitive123');assert.equal(payloads[1].teamId,'team_CaseSensitive123');
  const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.ok(overflow<=3,'infrastructure form overflow '+overflow);
  role='VIEWER';await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Collect evidence. Spot changes. Assign action.').waitFor();assert.equal(await page.getByLabel('System',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);return {scenario:'infrastructure-'+name,passed:true,overflowPx:overflow,steps:12,testType:'fictional connector UI fixture; no customer credential assertion'};
 }finally{await context.close();}
}
