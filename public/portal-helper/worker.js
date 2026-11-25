import {exchange} from './bridge.js';
let pending=Promise.resolve();
function serial(job){const result=pending.then(job);pending=result.catch(()=>{});return result;}
async function focus(id){try{const tab=await chrome.tabs.update(id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}catch{/* The operator can return to the tab manually. */}}
function listen(external){return (message,sender,reply)=>{
 serial(()=>exchange({message,sender,external,store:chrome.storage.session,home:chrome.runtime.getManifest().homepage_url,popup:chrome.runtime.getURL('popup.html'),focus,now:Date.now()})).then(reply,error=>reply({ok:false,message:error.message}));return true;
};}
chrome.runtime.onMessageExternal.addListener(listen(true));
chrome.runtime.onMessage.addListener(listen(false));
chrome.tabs.onRemoved.addListener(id=>{void serial(async()=>{const {pair}=await chrome.storage.session.get('pair');if(pair&&(id===pair.tab||id===pair.buyerTab))await chrome.storage.session.remove('pair');});});
