import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

async function readDownload(page,button){
 const received=page.waitForEvent('download');
 await button.click();
 return JSON.parse(await readFile(await (await received).path(),'utf8'));
}
function capture(side,serials){
 const at=new Date(Date.now()-(side==='shipping'?60000:30000)).toISOString();
 return Buffer.from(JSON.stringify({'@context':'https://ref.gs1.org/standards/epcis/epcis-context.jsonld',type:'EPCISDocument',schemaVersion:'2.0',creationDate:at,epcisBody:{eventList:[{
  type:'ObjectEvent',eventID:'urn:uuid:'+randomUUID(),eventTime:at,eventTimeZoneOffset:'+00:00',action:'OBSERVE',bizStep:side,
  readPoint:{id:'urn:epc:id:sgln:0614141.00001.'+(side==='shipping'?'1':'2')},bizTransactionList:[{type:'desadv',bizTransaction:'urn:example:dispatch:browser'}],
  epcList:serials.map(s=>'urn:epc:id:sgtin:0614141.112345.'+s)
 }]}}));
}

export async function benchmarkReportingJourney({review,db,app,org,control,machine,token,checkpoint,passed}){
 const page=await review.context().newPage(),query='?'+new URLSearchParams({organizationId:org.id});
 try{
  await checkpoint('read a serialised shipment at both ends and recover the discrepant receipt');
  await page.goto(app+'/team/developers'+query);
  await page.getByText('Reconcile serialised packs from EPCIS files',{exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('button',{name:'Compare pack identities'})});
  for(const side of ['shipping','receiving'])await form.getByLabel(side==='shipping'?'Shipping document':'Receiving document').setInputFiles({name:side+'.json',mimeType:'application/json',buffer:capture(side,side==='shipping'?['A','B']:['A','C'])});
  await form.getByLabel('Control',{exact:true}).selectOption(control.id);
  await form.getByLabel('Source system',{exact:true}).fill('Fictional trading partner');
  await form.getByLabel('Decision owner reference').fill('goods-in');
  await form.getByRole('button',{name:'Compare pack identities'}).click();
  await page.getByText(/2 dispatched, 2 received, 1 missing, 1 unexpected/).waitFor();
  const shipment=await readDownload(page,page.getByRole('button',{name:'Download observation for the partner connector'}));
  const response=await machine(token,'observations','POST',shipment.observation,shipment.requestKey);
  assert.equal(response.status(),201);
  const persisted=await db.customerApiObservation.findFirstOrThrow({where:{requestKey:shipment.requestKey,organizationId:org.id}});
  assert.equal(persisted.payload.partnerRecord.record.receiving.epcisBody.eventList[0].epcList.length,2);
  await page.goto(app+'/team/developers'+query+'&observationId='+persisted.id);
  await page.getByText(/Pack reconciliation · FAIL/).waitFor();
  passed('An administrator compared two equally sized EPCIS files, identified a substituted pack and recovered the saved discrepancy from the authenticated partner API.');

  await checkpoint('save site-specific activities, manually refresh and retrieve the saved profile');
  await page.goto(app+'/team/library'+query);
  const statement=page.getByRole('region',{name:'Applicability statement',exact:true});
  await statement.getByRole('button',{name:'Refresh statement'}).click();
  await statement.getByText(/^Manage site facts \(/).click();
  await statement.getByLabel('Site name',{exact:true}).fill('Fictional cold store');
  await statement.getByLabel('UK nation',{exact:true}).selectOption('Scotland');
  await statement.getByLabel('Handles temperature-controlled products',{exact:true}).selectOption('true');
  await statement.getByRole('button',{name:'Save site facts'}).click();
  await statement.getByText(/Site register updated/).waitFor();
  await statement.getByRole('button',{name:'Refresh statement'}).click();
  await statement.getByText(/^Manage site facts \(/).click();
  await statement.getByLabel('Site',{exact:true}).selectOption({label:'Fictional cold store'});
  assert.equal(await statement.getByLabel('Handles temperature-controlled products',{exact:true}).inputValue(),'true');
  assert.equal(await statement.getByLabel('Distributes medicines wholesale',{exact:true}).inputValue(),'');
  passed('An administrator manually refreshed the site register and recovered a declared cold-chain activity and an unknown wholesale activity separately.');

  await checkpoint('inspect and download the dated group board report');
  await page.goto(app+'/team/risks/group'+query);
  const company=await db.organization.findUniqueOrThrow({where:{id:org.id}});
  await page.getByRole('checkbox',{name:company.name,exact:true}).check();
  await page.getByLabel('Bill comparison month').fill('2026-01');
  await page.getByRole('button',{name:'Calculate group report'}).click();
  const board=await readDownload(page,page.getByRole('button',{name:'Download report with source receipts (JSON)'}));
  assert.equal(board.rows[0].organizationId,org.id);assert.equal(board.rows[0].billSample.month,'2026-01');
  assert.equal(board.rows[0].billSample.prior,'2025-12');assert.equal(board.rows[0].billSample.currentPence,null);
  assert.ok(board.calculatedAt);assert.ok(Array.isArray(board.rows[0].riskLines));assert.match(board.digest,/^[a-f0-9]{64}$/);
  passed('The audited group report exported the chosen organisation, both calendar periods, unknown observed expenditure and the report digest.');
  await checkpoint('open the source follow-up queue from Connections');
  await page.goto(app+'/team/operations'+query+'&view=connections');
  await page.getByRole('link',{name:'Review source follow-ups'}).click();
  await page.getByRole('button',{name:/Source follow-ups/,pressed:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('organizationId'),org.id);
  await page.getByRole('button',{name:'Next page'}).waitFor();
  passed('The Connections link opened the active workspace’s filtered source follow-up queue.');
 }finally{await page.close();}
}
