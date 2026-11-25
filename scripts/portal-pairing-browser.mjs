import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Exercise the ZIP delivered by the application and Chrome's actual external-message boundary.
export async function installedPortalPairing(zip){
 const dir=await mkdtemp(join(tmpdir(),'regpilot-pair-')),extension=join(dir,'extension');
 let context;
 try{
  await writeFile(join(dir,'helper.zip'),zip);execFileSync('unzip',['-q',join(dir,'helper.zip'),'-d',extension]);
  const m=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
  const id=Array.from(createHash('sha256').update(Buffer.from(m.key,'base64')).digest('hex').slice(0,32),v=>String.fromCharCode(97+parseInt(v,16))).join('');
  context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'chromium',headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
   args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const home=m.homepage_url,buyerUrl='https://buyer.example.invalid/questions';
  await context.route(home,r=>r.fulfill({contentType:'text/html',body:'<title>Reviewer</title>'}));
  await context.route(buyerUrl,r=>r.fulfill({contentType:'text/html',body:'<label>How is access reviewed?<textarea></textarea></label>'}));
  const reviewer=await context.newPage(),buyer=await context.newPage();
  await reviewer.goto(home);await buyer.goto(buyerUrl);
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:10000});
  const buyerId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url||t.pendingUrl===url)?.id,buyerUrl).catch(()=>undefined);
  const popup=await context.newPage();await popup.goto('chrome-extension://'+id+'/popup.html');
  // activeTab permits a buyer read on a user gesture. Chrome hides ungranted tab URLs from the worker.
  await buyer.bringToFront();
  const currentBuyerId=buyerId??await popup.evaluate(async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
  const common={organizationId:randomUUID(),questionnaireId:randomUUID(),nonce:randomUUID()};
  const send=(action,more={})=>reviewer.evaluate(async({id,m})=>chrome.runtime.sendMessage(id,m),{id,m:{action,...common,...more}});
  assert.equal((await send('PAIR',{title:'Fictional vendor questionnaire'})).ok,true);
  const code=await readFile(join(extension,'fields.js'),'utf8');
  await buyer.addScriptTag({content:code.replace('export async function questionnaireFields','globalThis.questionnaireFields=async function')});
  const capture=await buyer.evaluate(()=>globalThis.questionnaireFields(null,null));
  const internal=m=>popup.evaluate(m=>chrome.runtime.sendMessage(m),m);
  assert.equal((await internal({action:'CAPTURE',nonce:common.nonce,tab:currentBuyerId,capture})).ok,true);
  assert.deepEqual((await send('READ')).capture,capture);
  const ticket={format:'regpilot-portal-ticket-v1',handoffId:randomUUID(),secret:'f'.repeat(43),origin:capture.origin,pageHash:capture.pageHash,labels:capture.fields,expiresAt:new Date(Date.now()+540000).toISOString()};
  assert.equal((await send('DELIVER',{ticket})).ok,true);
  assert.equal((await internal({action:'INFO',tab:currentBuyerId})).ticket.handoffId,ticket.handoffId);
  assert.equal((await internal({action:'INFO',tab:currentBuyerId+1000})).ticket,null);
  assert.equal((await send('READ',{nonce:randomUUID()})).ok,false);
  assert.equal(await buyer.getByRole('textbox').inputValue(),'');
  await internal({action:'CLEAR',tab:currentBuyerId,handoffId:ticket.handoffId});
  const nonce=randomUUID(),newPage=context.waitForEvent('page');
  assert.equal((await internal({action:'START_IMPORT',nonce,tab:currentBuyerId,capture})).ok,true);
  const importer=await newPage;await importer.waitForURL(home+'#portal-import='+nonce);
  assert.equal((await internal({action:'INFO',tab:currentBuyerId})).canReturn,true);
  assert.equal((await internal({action:'FOCUS_REVIEW',tab:currentBuyerId+1000})).ok,false);
  assert.equal((await internal({action:'FOCUS_REVIEW',tab:currentBuyerId})).ok,true);
  const incoming=(action,extra={})=>importer.evaluate(async({id,m})=>chrome.runtime.sendMessage(id,m),{id,m:{action,organizationId:common.organizationId,nonce,...extra}});
  assert.deepEqual((await incoming('READ_IMPORT')).capture,capture);
  assert.equal((await incoming('READ_IMPORT',{organizationId:randomUUID()})).ok,false);
  assert.equal((await send('READ_IMPORT',{nonce})).ok,false);
  const saved=randomUUID();
  assert.equal((await incoming('IMPORT_SAVED',{questionnaireId:saved,title:'Buyer-initiated review'})).ok,true);
  assert.deepEqual((await incoming('RESUME',{questionnaireId:saved})).capture,capture);
  assert.equal((await incoming('RESUME',{questionnaireId:randomUUID()})).capture,undefined);
  assert.equal((await incoming('DELIVER',{questionnaireId:saved,ticket})).ok,true);
  assert.equal((await internal({action:'INFO',tab:currentBuyerId})).ticket.handoffId,ticket.handoffId);
 }finally{await context?.close();await rm(dir,{recursive:true,force:true});}
}
