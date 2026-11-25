import {questionnaireFields} from './fields.js';
const ui=id=>document.getElementById(id);
let ticket=null,pairedNonce=null,direct=false;
async function send(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.message||'The paired tab is unavailable.');return result;}
function preview(v){ticket=v;ui('preview').textContent='RegPilot '+v.regpilotOrigin+' · Buyer '+v.origin+' · Reviewed fields: '+v.labels.join(' · ');ui('apply').disabled=false;}
async function refresh(){
 const id=await tab(),info=await send({action:'INFO',tab:id});
 if(info.importPending){ui('start').disabled=true;ui('paired').textContent='Complete the import in the RegPilot tab.';return;}
 if(!info.paired)return;
 ui('start').disabled=true;
 pairedNonce=info.nonce;ui('send').disabled=info.captured;ui('paired').textContent='Paired questionnaire: '+info.title;
 if(info.ticket){direct=true;preview(info.ticket);}
}
ui('send').onclick=async()=>{try{ui('send').disabled=true;const id=await tab(),capture=await run(id,[null,null]);await send({action:'CAPTURE',nonce:pairedNonce,tab:id,capture});status('Field labels sent for review.');}catch(e){status(e.message);ui('send').disabled=false;}};
ui('start').onclick=async()=>{try{
 ui('start').disabled=true;const id=await tab(),capture=await run(id,[null,null]);
 await send({action:'START_IMPORT',nonce:crypto.randomUUID(),tab:id,capture});
 status('Review the captured questions in the RegPilot tab.');
}catch(e){status(e.message);ui('start').disabled=false;}};
void refresh().catch(e=>status(e.message));
async function run(tabId,args){
 const [entry]=await chrome.scripting.executeScript({target:{tabId},func:questionnaireFields,args});
 if(!entry?.result)throw Error('The portal changed or refused the operation. Capture its current fields again.');
 return entry.result;
}
async function tab(){const [current]=await chrome.tabs.query({active:true,currentWindow:true});if(!current?.id)throw Error('Open the buyer portal first.');return current.id;}
function status(s){ui('status').textContent=s;}
ui('capture').onclick=async()=>{try{const fields=await run(await tab(),[null,null]);const blob=new Blob([JSON.stringify(fields)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='portal-fields.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);status('Field labels captured.');}catch(e){status(e.message);}};
ui('ticket').onchange=async()=>{ticket=null;direct=false;ui('apply').disabled=true;ui('preview').textContent='';try{
 const f=ui('ticket').files[0];if(!f||f.size>110000)throw Error('Choose the reviewer’s JSON hand-off.');
 const v=JSON.parse(await f.text()),base=new URL(v.regpilotOrigin);
 if(v.format!=='regpilot-portal-ticket-v1'||base.protocol!=='https:'||base.origin!==v.regpilotOrigin||!Array.isArray(v.labels)||!v.labels.length||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)<=Date.now())throw Error('The hand-off is invalid or expired.');
 preview(v);
 }catch(e){status(e.message);}};
ui('apply').onclick=async()=>{if(!ticket)return;const t=ticket,perms={origins:[t.regpilotOrigin+'/*']};ui('apply').disabled=true;
 let authorised=false,appliedTab=null;try{
  authorised=await chrome.permissions.request(perms);if(!authorised)throw Error('Permission is required to check the hand-off with your RegPilot workspace.');
  const tabId=await tab(),capture=await run(tabId,[null,null]);if(capture.origin!==t.origin||capture.pageHash!==t.pageHash||Date.parse(t.expiresAt)<=Date.now())throw Error('Open the same reviewed questionnaire before filling.');
  const r=await fetch(t.regpilotOrigin+'/api/portal/redeem',{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({handoffId:t.handoffId,secret:t.secret,capture})});
  if(!r.ok)throw Error('RegPilot could not verify the current disclosure. Request a fresh hand-off.');
  const values=await r.json();if(values.origin!==t.origin||values.pageHash!==capture.pageHash||Date.parse(values.expiresAt)<=Date.now())throw Error('The authorised page or time window changed.');
  const result=await run(tabId,[capture,values.fields]);appliedTab=tabId;status(result.filled+' fields filled. Review the answers in the buyer portal and use its own submit button when ready.');
 }catch(e){status(e.message);}finally{if(authorised)await chrome.permissions.remove(perms);if(direct&&appliedTab!==null)await send({action:'CLEAR',tab:appliedTab,handoffId:t.handoffId});ticket=null;ui('preview').textContent='';}};
