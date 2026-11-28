'use strict';
const el=id=>document.getElementById(id);
let item, source, prepared, targetWindow, loading=false;
const say=text=>{el('status').textContent=text;};
const discard=()=>{prepared=null;targetWindow=null;el('transfer').hidden=true;};
function fromOffice(run){
 return new Promise((resolve,reject)=>run(result=>result.status===Office.AsyncResultStatus.Succeeded?
  resolve(result.value):reject(new Error('Outlook could not read this item. Reopen the message and try again.'))));
}
function active(){return item&&item.internetMessageId===Office.context.mailbox.item?.internetMessageId;}
el('read').onclick=async()=>{
 if(loading)return;
 loading=true;el('read').disabled=true;discard();el('preview').hidden=true;source=null;
 try{
  item=Office.context.mailbox.item;
  if(!item?.internetMessageId||!item.from?.emailAddress)throw Error('Choose a received message with a sender and message ID.');
  const body=await fromOffice(done=>item.body.getAsync(Office.CoercionType.Text,done));
  if(!active())throw Error('The selected message changed. Read it again.');
  source={messageId:item.internetMessageId,sender:item.from.emailAddress,subject:item.subject||'(No subject)',createdAt:item.dateTimeCreated.toISOString()};
  el('subject').textContent=source.subject;el('sender').textContent=source.sender;
  el('excerpt').value=body.slice(0,3000);
  el('limit').textContent=body.length>3000?'Showing the first 3,000 characters. Edit the excerpt before continuing.':'Edit or clear the excerpt before continuing.';
  const files=el('files');files.replaceChildren();
  for(const a of item.attachments||[]){
   const label=document.createElement('label'),check=document.createElement('input');
   check.type='checkbox';check.value=a.id;check.disabled=!item.getAttachmentContentAsync||a.isInline||a.attachmentType!=='file'||!(/\.(pdf|docx)$/i.test(a.name))||a.name.length>160||a.size>2*1024*1024;
   label.append(check,document.createTextNode(a.name+(check.disabled?' (unavailable for transfer)':'')));files.append(label);
  }
  if(!files.childElementCount)files.textContent='This message has no attachments.';
  el('preview').hidden=false;say('Choose up to three PDF or Word files, up to 2 MiB in total.');
 }catch(error){say(error.message);}finally{loading=false;el('read').disabled=false;}
};
el('preview').addEventListener('input',discard);
el('prepare').onclick=async()=>{
 if(loading||!source)return;
 loading=true;discard();el('prepare').disabled=true;el('preview').querySelector('fieldset').disabled=true;el('excerpt').disabled=true;
 try{
  if(!active())throw Error('The selected message changed. Read it again.');
  const ids=[...el('files').querySelectorAll('input:checked')].map(x=>x.value);
  const chosen=ids.map(id=>item.attachments.find(a=>a.id===id));
  if(chosen.length>3||chosen.some(a=>!a)||chosen.reduce((sum,a)=>sum+a.size,0)>2*1024*1024)throw Error('Select up to three files totalling 2 MiB.');
  const files=[];let size=0;
  for(const a of chosen){
   const content=await fromOffice(done=>item.getAttachmentContentAsync(a.id,done));
   if(content.format!==Office.MailboxEnums.AttachmentContentFormat.Base64)throw Error('Choose a PDF or DOCX file attached directly to the message.');
   const base64=content.content;size+=atob(base64).length;
   if(size>2*1024*1024)throw Error('The selected files exceed 2 MiB.');
   files.push({name:a.name,base64});
  }
  if(!active())throw Error('The selected message changed. Read it again.');
  prepared={format:'regpilot-outlook-v1',source:{...source,excerpt:el('excerpt').value},files};
  el('transfer').hidden=false;say('Selected content is ready. You will confirm the destination in RegPilot.');
 }catch(error){say(error.message);}finally{loading=false;el('prepare').disabled=false;el('preview').querySelector('fieldset').disabled=false;el('excerpt').disabled=false;}
};
el('open').onclick=()=>{
 if(!prepared)return;
 targetWindow=window.open(location.origin+'/team/quality#outlook-import','_blank');
 if(!targetWindow)say('Use Download transfer file, then choose it from Email correspondence in your case.');
};
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||!targetWindow||event.source!==targetWindow||!prepared||event.data?.type!=='regpilot-request-mail')return;
 targetWindow.postMessage({type:'regpilot-selected-mail',transfer:prepared},location.origin);
});
el('download').onclick=()=>{
 if(!prepared)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(prepared)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='selected-message.regpilot-mail.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
if(window.Office)Office.onReady(info=>{
 if(info.host!==Office.HostType.Outlook){say('Open the RegPilot add-in from a message in Outlook.');return;}
 el('read').disabled=false;say('Ready to read the message you select.');
});else say('Outlook could not load. Open the installed add-in from a message and try again.');
