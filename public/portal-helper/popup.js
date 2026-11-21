import {questionnaireFields} from './fields.js';
const ui=id=>document.getElementById(id);
let ticket=null;
async function run(tabId,args){
 const [entry]=await chrome.scripting.executeScript({target:{tabId},func:questionnaireFields,args});
 if(!entry?.result)throw Error('The portal changed or refused the operation. Capture its current fields again.');
 return entry.result;
}
async function tab(){const [current]=await chrome.tabs.query({active:true,currentWindow:true});if(!current?.id)throw Error('Open the buyer portal first.');return current.id;}
function status(s){ui('status').textContent=s;}
ui('capture').onclick=async()=>{try{const fields=await run(await tab(),[null,null]);const blob=new Blob([JSON.stringify(fields)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='portal-fields.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);status('Field labels captured.');}catch(e){status(e.message);}};
ui('ticket').onchange=async()=>{ticket=null;ui('apply').disabled=true;ui('preview').textContent='';try{
 const f=ui('ticket').files[0];if(!f||f.size>110000)throw Error('Choose the reviewer’s JSON hand-off.');
 const v=JSON.parse(await f.text()),base=new URL(v.regpilotOrigin);
 if(v.format!=='regpilot-portal-ticket-v1'||base.protocol!=='https:'||base.origin!==v.regpilotOrigin||!Array.isArray(v.labels)||!v.labels.length||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)<=Date.now())throw Error('The hand-off is invalid or expired.');
 ticket=v;ui('preview').textContent='Verify your RegPilot address '+base.origin+' and buyer '+v.origin+'. Reviewed fields: '+v.labels.join(' · ');ui('apply').disabled=false;
 }catch(e){status(e.message);}};
ui('apply').onclick=async()=>{if(!ticket)return;const t=ticket,perms={origins:[t.regpilotOrigin+'/*']};ui('apply').disabled=true;
 let authorised=false;try{
  authorised=await chrome.permissions.request(perms);if(!authorised)throw Error('Permission is required to check the hand-off with your RegPilot workspace.');
  const tabId=await tab(),capture=await run(tabId,[null,null]);if(capture.origin!==t.origin||capture.pageHash!==t.pageHash||Date.parse(t.expiresAt)<=Date.now())throw Error('Open the same reviewed questionnaire before filling.');
  const r=await fetch(t.regpilotOrigin+'/api/portal/redeem',{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({handoffId:t.handoffId,secret:t.secret,capture})});
  if(!r.ok)throw Error('RegPilot could not verify the current disclosure. Request a fresh hand-off.');
  const values=await r.json();if(values.origin!==t.origin||values.pageHash!==capture.pageHash||Date.parse(values.expiresAt)<=Date.now())throw Error('The authorised page or time window changed.');
  const result=await run(tabId,[capture,values.fields]);status(result.filled+' fields filled. Review the answers in the buyer portal and use its own submit button when ready.');
 }catch(e){status(e.message);}finally{if(authorised)await chrome.permissions.remove(perms);ticket=null;ui('preview').textContent='';}};
