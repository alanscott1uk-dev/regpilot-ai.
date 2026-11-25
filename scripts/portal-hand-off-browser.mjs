import {installedPortalPairing} from './portal-pairing-browser.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercises the same function serialised by chrome.scripting on an authorised fictional portal.
export async function portalBrowserJourney(browser,base,viewport,name){
 const context=await browser.newContext({viewport}),page=await context.newPage();
 try{
  await context.route('https://buyer.example.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Buyer questionnaire</title><form><label>How is access reviewed?<textarea></textarea></label><label>Which unsupported statement applies?<textarea></textarea></label><label>Password<input type="password"></label><button>Submit questionnaire</button></form><script>window.submits=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.submits++}</script></html>'}));
  await page.goto('https://buyer.example.invalid/questions?customer=one');
  const module=await readFile(new URL('../public/portal-helper/fields.js',import.meta.url),'utf8');
  await page.addScriptTag({content:module.replace('export async function questionnaireFields','globalThis.questionnaireFields=async function')});
  const capture=await page.evaluate(()=>globalThis.questionnaireFields(null,null));assert.equal(capture.fields.length,2);
  const one=[{label:'How is access reviewed?',answer:'Approved fixture answer about access.'}];
  await assert.rejects(()=>page.evaluate(([c,a])=>globalThis.questionnaireFields(c,a),[{...capture,pageHash:'a'.repeat(64)},one]));
  assert.equal((await page.evaluate(([c,a])=>globalThis.questionnaireFields(c,a),[capture,one])).filled,1);
  assert.equal(await page.getByLabel('How is access reviewed?').inputValue(),one[0].answer);
  assert.equal(await page.getByLabel('Which unsupported statement applies?').inputValue(),'');assert.equal(await page.evaluate(()=>globalThis.submits),0);
  await assert.rejects(()=>page.evaluate(([c,a])=>globalThis.questionnaireFields(c,a),[capture,one]));
  const file=await context.request.get(base+'/api/tools/portal-helper');assert.equal(file.status(),200);const zip=await file.body();assert.equal(zip.readUInt32LE(0),0x04034b50);if(name==='desktop')await installedPortalPairing(zip);
  await page.goto(base+'/trust/directory');await page.getByRole('heading',{name:'Public trust directory'}).waitFor();
  await page.getByLabel('Company or publication title').fill('Unknown buyer');await page.getByRole('button',{name:'Search public summaries'}).click();await page.getByRole('status').filter({hasText:'No current public summary'}).waitFor();
  return {scenario:'portal-handoff-'+name,passed:true,fieldCount:capture.fields.length,filled:1,automaticallySubmitted:false};
 }finally{await context.close();}
}
