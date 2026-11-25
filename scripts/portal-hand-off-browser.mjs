import {installedPortalPairing} from './portal-pairing-browser.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercises the same function serialised by chrome.scripting on an authorised fictional portal.
export async function portalBrowserJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport}),page=await context.newPage();
 try{
  await context.route('https://buyer.example.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Buyer questionnaire</title><form><label>How is access reviewed?<textarea></textarea></label><label>Which unsupported statement applies?<textarea></textarea></label><label>Is the control reviewed?<select><option value="">Choose an option</option><option value="y">Yes</option><option value="n">No</option></select></label><span id="scope">Which site?</span><select aria-labelledby="scope"><option value="site">Existing site</option></select><fieldset><legend>Is a quality review required?</legend><label><input type="radio" name="release" value="y">Yes</label><label><input type="radio" name="release" value="n">No</label></fieldset><label>Password<input type="password"></label><button>Submit questionnaire</button></form><script>window.submits=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.submits++}</script></html>'}));
  await page.goto('https://buyer.example.invalid/questions?customer=one');
  const module=await readFile(new URL('../public/portal-helper/fields.js',import.meta.url),'utf8');
  await page.addScriptTag({content:module.replace('export async function questionnaireFields','globalThis.questionnaireFields=async function')});
  const capture=await page.evaluate(()=>globalThis.questionnaireFields(null,null));assert.deepEqual(capture.fields,['How is access reviewed?','Which unsupported statement applies?','Is the control reviewed?','Which site?','Is a quality review required?']);
  const choice={label:'Is the control reviewed?',answer:'Yes'};
  const fill=answers=>page.evaluate(([c,a])=>globalThis.questionnaireFields(c,a),[capture,answers]);
  const one=[{label:'How is access reviewed?',answer:'Approved fixture answer about access.'}];
  await assert.rejects(()=>page.evaluate(([c,a])=>globalThis.questionnaireFields(c,a),[{...capture,pageHash:'a'.repeat(64)},one]));
  await assert.rejects(()=>fill([...one,{...choice,answer:'Generally yes'}]));
  await assert.rejects(()=>fill([...one,{label:'Which site?',answer:'Existing site'}]));
  assert.equal(await page.getByLabel('How is access reviewed?').inputValue(),'');
  await page.getByLabel('Is the control reviewed?').evaluate(select=>select.add(new Option('Yes','duplicate')));
  await assert.rejects(()=>fill([...one,choice]));
  await page.getByLabel('Is the control reviewed?').evaluate(select=>select.lastElementChild.remove());
  const radio={label:'Is a quality review required?',answer:'Yes'},yes=page.getByRole('radio',{name:'Yes'}),no=page.getByRole('radio',{name:'No'});
  await assert.rejects(()=>fill([...one,radio,{...choice,answer:'Unclear'}]));
  assert.equal(await yes.isChecked(),false);
  await no.check();await assert.rejects(()=>fill([...one,radio]));
  assert.equal(await page.getByLabel('How is access reviewed?').inputValue(),'');
  await no.evaluate(el=>{el.checked=false;el.value='y';});await assert.rejects(()=>fill([radio]));
  await no.evaluate(el=>{el.value='n';});
  await assert.rejects(()=>fill([{...radio,answer:'Yes, usually'}]));
  assert.equal((await fill([...one,choice,radio])).filled,3);
  assert.equal(await yes.isChecked(),true);assert.equal(await no.isChecked(),false);
  assert.equal(await page.getByLabel('Is the control reviewed?').inputValue(),'y');
  await assert.rejects(()=>fill([choice]));
  assert.equal(await page.getByLabel('How is access reviewed?').inputValue(),one[0].answer);
  assert.equal(await page.getByLabel('Which unsupported statement applies?').inputValue(),'');assert.equal(await page.evaluate(()=>globalThis.submits),0);
  await assert.rejects(()=>page.evaluate(([c,a])=>globalThis.questionnaireFields(c,a),[capture,one]));
  const file=await context.request.get(base+'/api/tools/portal-helper');assert.equal(file.status(),200);const zip=await file.body();assert.equal(zip.readUInt32LE(0),0x04034b50);if(name==='desktop')await installedPortalPairing(zip);
  await page.goto(base+'/trust/directory');await page.getByRole('heading',{name:'Public trust directory'}).waitFor();
  await page.getByLabel('Company or publication title').fill('Unknown buyer');await page.getByRole('button',{name:'Search public summaries'}).click();await page.getByRole('status').filter({hasText:'No current public summary'}).waitFor();
  return {scenario:'portal-handoff-'+name,passed:true,fieldCount:capture.fields.length,filled:3,automaticallySubmitted:false};
 }finally{await context.close();}
}
