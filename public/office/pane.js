'use strict';
const el=id=>document.getElementById(id);
const expected=new URLSearchParams(location.search).get('host');
let channel,packet,child;
const call=run=>new Promise((resolve,reject)=>run(r=>r.status===Office.AsyncResultStatus.Succeeded?resolve(r.value):reject(Error(r.error?.message||'Office could not read the selection.'))));
async function wordDraft(){
 const doc=Office.context.document;
 const file=await call(cb=>doc.getFileAsync(Office.FileType.Compressed,{sliceSize:65536},cb));
 try{
  if(file.size<1||file.size>5_000_000)throw Error('Choose a DOCX draft up to 5 MB.');
  const parts=[];
  for(let i=0;i<file.sliceCount;i++){
   const slice=await call(cb=>file.getSliceAsync(i,cb));
   if(slice.index!==i)throw Error('The Word file changed while being read. Try again.');
   parts.push(new Uint8Array(slice.data));
  }
  const blob=new Blob(parts,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  if(blob.size!==file.size)throw Error('The Word file was incomplete. Try again.');
  let name='procedure-draft.docx';
  try{const last=decodeURIComponent(new URL(doc.url).pathname.split('/').pop()||'');if(/\.docx$/i.test(last)&&last.length<=150)name=last;}catch{}
  return {file:new File([blob],name,{type:blob.type})};
 }finally{await call(cb=>file.closeAsync(cb));}
}
async function stockRows(){
 const data=await call(cb=>Office.context.document.getSelectedDataAsync(Office.CoercionType.Matrix,{valueFormat:Office.ValueFormat.Unformatted},cb));
 if(!Array.isArray(data)||data.length<3||data.length>43||data.some(r=>!Array.isArray(r)||r.length!==8||r.some(v=>!['number','string'].includes(typeof v)||String(v).length>160)))
  throw Error('Select all eight columns, from the header through the physical COUNT. Use up to 40 movements.');
 return {format:'regpilot-excel-stock-v1',rows:data};
}
el('read').onclick=async()=>{
 packet=null;child=null;el('ready').hidden=true;el('read').disabled=true;
 try{
  const word=channel==='word';packet=await (word?wordDraft():stockRows());
  el('summary').textContent=word?packet.file.name+' · '+packet.file.size+' bytes':(packet.rows.length-1)+' selected stock rows';
  el('guide').textContent=word?'Open “Review a Word SOP” in the SOP builder. Receive this document, choose its evidence task and submit for independent review.':'Select the quality case, open Controlled-stock reconciliation, then Import Excel stock rows. Review the figures and select the two reviewed records before submitting.';
  el('ready').hidden=false;el('status').textContent='Ready. Confirm the destination in your signed-in workspace.';
 }catch(e){el('status').textContent=e.message;}finally{el('read').disabled=false;}
};
el('open').onclick=()=>{if(packet)child=window.open(location.origin+(channel==='word'?'/sop-builder#office-word':'/team/quality#office-excel'),'_blank');};
window.addEventListener('message',e=>{
 if(packet&&child&&e.origin===location.origin&&e.source===child&&e.data?.type==='regpilot-request-'+channel)
  child.postMessage({type:'regpilot-transfer-'+channel,payload:packet},location.origin);
});
el('download').onclick=()=>{
 if(!packet)return;const word=channel==='word';
 const blob=word?packet.file:new Blob([JSON.stringify(packet)],{type:'application/json'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=word?packet.file.name:'stock-selection.regpilot.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
if(window.Office)Office.onReady(info=>{
 const word=info.host===Office.HostType.Word;
 if(!word&&info.host!==Office.HostType.Excel||expected!==(word?'word':'excel'))return;
 channel=expected;el('read').disabled=false;el('template').hidden=word;
 el('title').textContent=word?'Review a Word SOP':'Import stock from Excel';
 el('instruction').textContent=word?'Capture the open procedure exactly as it is in Word, including tables and formatting.':'Select the header, opening balance, movements and physical count for one site, product and batch. Use ISO UTC timestamps as text, as shown in the example.';
});else el('status').textContent='Office could not load. Open the installed add-in and try again.';
