import assert from 'node:assert/strict';

export async function myCsfEvidenceJourney(page,base,organizationId){
 const connection={id:'d23e4567-e89b-42d3-a456-426614174050',name:'Fictional MyCSF subscriber assessment',tier:'r2',version:3,syncedAt:new Date().toISOString()};
 const items=['First','Second'].map((name,i)=>({id:'mapping-'+i,version:4+i,buid:'FAKE-'+i,filename:name+'.pdf'}));
 const attempts=[],linked=new Set();
 const frameworkUrl=url=>url.pathname==='/api/workspace/framework-audits';
 const myCsfUrl=url=>url.pathname==='/api/workspace/mycsf';
 await page.route(frameworkUrl,route=>route.fulfill({json:{organizationId,canEdit:true,audits:[],owners:[],selected:{profile:{name:'HITRUST r2 evidence preparation',source:'preparation'},active:false}}}));
 await page.route(myCsfUrl,route=>{
  const request=route.request();
  if(request.method()==='GET'){
   const search=new URL(request.url()).searchParams;assert.equal(search.get('organizationId'),organizationId);
   const selected=search.has('connection')?{...connection,total:1,mapped:2,staleCount:0,page:1,pages:1,
    rows:[{buid:'FAKE-0',hash:'one',reference:'Fictional reference',text:'Fictional requirement.'}],mappings:[],reuse:[],
    evidence:[{id:'file',name:'First.pdf',task:'Privileged access sample'}],
    suggestions:[{buid:'FAKE-0',id:'file',filename:'First.pdf',task:'Privileged access sample',taskId:'fictional-task',test:'Access grants test',matched:['privileged','grants'],exact:false}],
    exportable:items.filter(item=>!linked.has(item.id))}:null;
   return route.fulfill({json:{organizationId,licensed:true,canEdit:true,connections:[connection],selected}});
  }
  const data=request.postDataJSON(),item=items.find(i=>i.id===data.mapping);
  assert.ok(item);assert.equal(data.organizationId,organizationId);assert.equal(data.connection,connection.id);assert.equal(data.version,3);assert.equal(data.mappingVersion,item.version);
  assert.equal(data.confirm,true);assert.equal(data.documentType,7);assert.equal(data.typeName,'Fictional evidence');assert.equal(data.op,'export');
  assert.ok(!linked.has(item.id));attempts.push(item.id);
  if(item===items[1]&&attempts.length===2)return route.fulfill({status:409,json:{error:'Fictional second handoff needs reconciliation.'}});
  linked.add(item.id);return route.fulfill({json:{document:800+linked.size}});
 });
 try{
  await page.goto(base+'/team/programmes/frameworks?'+new URLSearchParams({framework:'hitrust-r2',organizationId}));
  const panel=page.getByRole('region',{name:'MyCSF assessment'});await panel.getByLabel('Connected assessment').selectOption(connection.id);
  await panel.locator('summary').filter({hasText:'FAKE-0'}).click();
  await panel.getByRole('button',{name:'Use this file'}).click();assert.equal(await panel.getByRole('combobox',{name:/^Evidence file/}).inputValue(),'file');
  async function send(chosen){
   await panel.locator('summary').filter({hasText:'Export multiple approved mappings'}).click();
   const form=panel.getByRole('group',{name:'Select evidence to send to this assessment'});
   for(const item of chosen)await form.getByRole('checkbox',{name:item.buid+' · '+item.filename,exact:true}).check();
   await form.getByLabel('MyCSF document type ID').fill('7');await form.getByLabel('MyCSF document type name').fill('Fictional evidence');
   await form.getByLabel('I authorise sending the selected evidence').check();
   await form.getByRole('button',{name:/Export .* selected mapping/}).click();
  }
  await send(items);await panel.getByText('MyCSF confirmed 1 of 2 selected mappings. Fictional second handoff needs reconciliation.').waitFor();
  await panel.locator('summary').filter({hasText:'1 available'}).waitFor();
  await send([items[1]]);await panel.getByText('MyCSF confirmed the selected mapping.').waitFor();
  assert.deepEqual(attempts,['mapping-0','mapping-1','mapping-1']);assert.equal(linked.size,2);
 }finally{await page.unroute(frameworkUrl);await page.unroute(myCsfUrl);}
}
