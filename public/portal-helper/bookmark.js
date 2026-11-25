// Embedded in a static bookmark. The buyer page never receives a RegPilot credential.
export async function portalBookmark(readFields,regpilotOrigin){
 if(document.querySelector('dialog[data-regpilot-questionnaire]'))return;
 if(location.protocol!=='https:'||window!==window.top)throw Error('Open the buyer questionnaire in its own HTTPS tab.');
 const captured=await readFields();
 const box=document.createElement('dialog');box.setAttribute('data-regpilot-questionnaire','');box.setAttribute('aria-label','RegPilot buyer questionnaire');
 const heading=document.createElement('h2');heading.textContent='RegPilot questionnaire';
 const destination=document.createElement('p');destination.textContent=captured.origin+' · '+captured.fields.length+' visible questions';
 const copy=document.createElement('button');copy.textContent='Copy buyer questions';
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(captured.fields.join('\n'));status.textContent='Paste the questions into RegPilot for review.';}catch{status.textContent='Clipboard access is unavailable in this browser.';}};
 const fill=document.createElement('button');fill.textContent='Fill reviewed answers';
 const close=document.createElement('button');close.textContent='Close';close.onclick=()=>box.close();
 const status=document.createElement('p');status.setAttribute('role','status');
 let stop=()=>{};
 fill.onclick=()=>{
  stop();
  const nonce=crypto.randomUUID(),popup=window.open(regpilotOrigin+'/portal-exchange#'+nonce,'_blank','popup,width=610,height=620');
  if(!popup){status.textContent='Allow a RegPilot popup to connect this buyer form.';return;}
  fill.disabled=true;
  const until=Date.now()+600000;let ready=false;
  function hello(){
   if(popup.closed||Date.now()>=until){stop();status.textContent='The connection ended. Open the review again to retry.';return;}
   if(ready)return;
   popup.postMessage({type:'regpilot-buyer-capture',nonce,capture:captured},regpilotOrigin);
  }
  async function receive(event){
   if(event.origin!==regpilotOrigin||event.source!==popup||event.data?.nonce!==nonce)return;
   if(event.data.type==='regpilot-buyer-ready'){ready=true;return;}
   if(event.data.type!=='regpilot-buyer-answers'||Date.now()>=until)return;
   stop();
   try{
    const {fields,expiresAt}=event.data;
    if(!Array.isArray(fields)||!fields.length||fields.length>100||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now())throw Error('The reviewed answer set has expired.');
    box.remove();
    const result=await readFields(captured,fields);
    popup.postMessage({type:'regpilot-buyer-result',nonce,filled:result.filled},regpilotOrigin);
   }catch(e){
    popup.postMessage({type:'regpilot-buyer-result',nonce,error:e.message},regpilotOrigin);
    if(!box.isConnected){document.body.append(box);if(!box.open)box.showModal();}
    status.textContent=e.message;
   }
  }
  const timer=setInterval(hello,350),timeout=setTimeout(()=>{stop();status.textContent='The review window has ended.';},600000);
  stop=()=>{clearInterval(timer);clearTimeout(timeout);window.removeEventListener('message',receive);fill.disabled=false;};
  window.addEventListener('message',receive);hello();
 };
 box.addEventListener('close',()=>{stop();box.remove();});
 box.append(heading,destination,copy,fill,close,status);document.body.append(box);box.showModal();
}
