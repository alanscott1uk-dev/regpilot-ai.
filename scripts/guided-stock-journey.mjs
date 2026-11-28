import {excelSelection} from './office-pilot-journey.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixturePdf} from '../tests/helpers/pdf-fixture.mjs';

export async function guidedStockJourney({upload,review,db,app,org,editor,submitEvidence,checkpoint,passed}){
 await checkpoint('walk a first-time operator through the stock count and independent review');
 const task=await db.obligation.create({data:{organizationId:org.id,title:'Fictional stock source documents',category:'Stock count',
  ownerName:editor.email,assigneeId:editor.id,dueDate:new Date()}});
 const row=await db.qualityCase.create({data:{organizationId:org.id,ownerId:editor.id,createdById:editor.id,createKey:randomUUID(),
  title:'Fictional warehouse count',kind:'DEVIATION',classification:'MAJOR',occurredAt:new Date('2025-06-01'),
  description:'Check the recorded shortage for the fictional batch.',impact:'One pack is unaccounted for at the selected location.',
  containment:'Hold the affected lot while the count is checked.'}});
 const vault=app+'/team/evidence?'+new URLSearchParams({organizationId:org.id,taskId:task.id});
 const url=app+'/team/quality?'+new URLSearchParams({organizationId:org.id,caseId:row.id});
 const files=[];
 for(const [name,body] of [['stock-register.pdf','Opening 10 packs. Register line L1 supplied two packs. Expected 8.'],
  ['stock-count.pdf','A physical count at 10:00 found seven packs at Site A in lot TEST-1.']]){
  await upload.goto(vault);
  const stored=await submitEvidence(upload,name,fixturePdf([['FICTIONAL STOCK EXERCISE',body]]),201);
  await review.goto(vault);
  const item=review.locator('article').filter({has:review.getByText(name,{exact:true})});
  await item.getByLabel('Independent review rationale').fill('Checked the source document for this fictional stock exercise.');
  await item.getByRole('button',{name:'Approve evidence'}).click();await item.getByText('APPROVED',{exact:true}).waitFor();
  files.push(stored.evidence.id);
 }
 await upload.goto(url);
 const guidance=upload.getByRole('region',{name:'Next step for this case'});
 await guidance.getByRole('button',{name:'Open investigation'}).click();
 assert.equal(await upload.locator('#quality-plan-form').evaluate(el=>el.open),true);
 const stock=upload.locator('#quality-stock');
 assert.equal(await stock.count(),1,'The selected case must contain one stock reconciliation panel');
 await upload.locator('details#quality-stock > summary').click();
 const selection=await excelSelection(upload,app);
 await stock.getByText('Import Excel stock rows',{exact:true}).click();
 const pick=stock.getByLabel('Excel stock transfer file');
 const invalid=JSON.parse(selection);invalid.rows[2][6]='WRONG-LOT';
 await pick.setInputFiles({name:'mixed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
 await stock.getByText('Select only one site, product, batch and unit.').waitFor();
 assert.equal(await stock.getByLabel('Opening balance',{exact:true}).inputValue(),'');
 await pick.setInputFiles({name:'stock-selection.json',mimeType:'application/json',buffer:selection});
 await stock.getByRole('button',{name:'Use these figures in place of the current draft'}).click();
 assert.equal(await stock.getByLabel('Site and stock location').inputValue(),'Site A');
 assert.equal(await stock.getByLabel('Batch or lot').inputValue(),'TEST-1');
 assert.equal(await stock.getByLabel('Opening balance',{exact:true}).inputValue(),'10');
 assert.equal(await stock.getByLabel('Direction').inputValue(),'OUT');
 assert.equal(await stock.getByLabel('Register line reference').inputValue(),'L1');
 await stock.getByRole('button',{name:'Continue to physical count'}).click();
 assert.equal(await stock.getByLabel('Quantity physically counted (packs)').inputValue(),'7');
 await stock.getByLabel('Register extract covering the whole period').selectOption(files[0]);
 await stock.getByLabel('Dated physical count record').selectOption(files[0]);
 await stock.getByLabel('Count notes').fill('The physical count is one pack short. The lot is held for review.');
 await stock.getByRole('button',{name:'Preview reconciliation'}).click();
 await stock.getByText('Choose separate movement and physical count records.',{exact:true}).waitFor();
 await stock.getByLabel('Dated physical count record').selectOption(files[1]);
 await stock.getByRole('button',{name:'Refresh reviewed files'}).click();
 await stock.getByText('Reviewed file list updated.').waitFor();
 await stock.getByRole('button',{name:'Preview reconciliation'}).click();
 await stock.getByRole('heading',{name:'Check and submit'}).waitFor();
 assert.equal(await stock.locator('dd').allTextContents().then(xs=>xs.join('|')),'8 packs|7 packs|-1 packs');
 assert.equal(await db.qualityOperation.count({where:{organizationId:org.id,caseId:row.id,action:'RECORD_STOCK'}}),0);
 await stock.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await stock.getByLabel('Dated physical count record').inputValue(),files[1]);
 await stock.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await stock.getByLabel('Register line reference').inputValue(),'L1');
 await stock.getByRole('button',{name:'Continue to physical count'}).click();await stock.getByRole('button',{name:'Preview reconciliation'}).click();
 await stock.getByRole('button',{name:'Send for independent review'}).click();
 await stock.getByRole('heading',{name:'Awaiting independent stock review'}).waitFor();
 assert.equal(await stock.getByRole('button',{name:'Record review',exact:true}).count(),0);
 await review.goto(url);
 await review.getByRole('region',{name:'Next step for this case'}).getByRole('button',{name:'Open stock reconciliation'}).click();
 const checker=review.locator('#quality-stock');
 await checker.getByRole('heading',{name:'Review the submitted count'}).waitFor();
 const original=new URL(await checker.getByRole('link',{name:'Open physical count record',exact:false}).getAttribute('href'),app);
 assert.equal(original.searchParams.get('evidenceId'),files[1]);assert.equal(original.searchParams.get('organizationId'),org.id);
 await checker.getByRole('combobox',{name:'Stock review decision',exact:true}).selectOption('VERIFIED');
 await checker.getByLabel('Review findings').fill('The physical count sheet confirms a shortage of one pack.');
 await checker.getByRole('button',{name:'Record review',exact:true}).click();
 await checker.getByRole('heading',{name:'Stock discrepancy still open'}).waitFor();
 const [download]=await Promise.all([review.waitForEvent('download'),checker.getByRole('button',{name:'Download stock inspection summary'}).click()]);
 const document=await readFile(await download.path(),'utf8');assert.ok(document.includes('difference -1 packs')&&document.includes('stock-count.pdf'));
 passed('The simulated Excel host transferred one selected register and rejected mixed lots. The guided stock count retained entries on Back, checked distinct documents, previewed a one-pack shortage before saving, routed it to a separate reviewer and exported the reviewed discrepancy.');
 return {caseId:row.id,expected:8,physical:7,difference:-1};
}
