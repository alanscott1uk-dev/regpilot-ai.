const uuid=value=>typeof value==='string'&&/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const secureOrigin=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value;}catch{return false;}};
const validFields=v=>v?.format==='regpilot-portal-fields-v1'&&secureOrigin(v.origin)&&/^[a-f0-9]{64}$/.test(v.pageHash)&&Array.isArray(v.fields)&&v.fields.length>0&&v.fields.length<=100&&v.fields.every(f=>typeof f==='string'&&f.length>=3&&f.length<=600);
const problem=message=>{throw Error(message);};
export async function exchange({message:m,sender,external,store,home,popup,focus,openImport,now}){
 const url=new URL(sender.url),target=new URL(home);
 if(external){
  if(url.origin!==target.origin||url.pathname!==target.pathname||sender.frameId!==0||!Number.isInteger(sender.tab?.id))problem('Open the paired RegPilot questionnaire.');
  if(!uuid(m.organizationId))problem('Choose a workspace.');
  if(m.action!=='READ_IMPORT'&&!uuid(m.questionnaireId))problem('Choose one questionnaire.');
  if(m.action!=='RESUME'&&!uuid(m.nonce))problem('Open the current questionnaire transfer.');
 }else if(sender.url!==popup)problem('Use the installed helper popup.');
 let state=(await store.get('pair')).pair;
 if(state&&state.until<=now){await store.remove('pair');state=null;}
 if(!external&&m.action==='START_IMPORT'){
  if(state||!uuid(m.nonce)||!Number.isInteger(m.tab)||!validFields(m.capture)||m.capture.origin===target.origin)problem('Finish the existing transfer or open a buyer questionnaire with supported fields.');
  const {format,origin,pageHash,fields}=m.capture;
  const id=await openImport(home+'#portal-import='+m.nonce);
  if(!Number.isInteger(id))problem('The questionnaire tab could not be opened.');
  await store.set({pair:{kind:'IMPORT',tab:id,buyerTab:m.tab,nonce:m.nonce,capture:{format,origin,pageHash,fields},until:now+30*60000}});
  return {ok:true};
 }
 if(external&&m.action==='RESUME'){
  if(!state||state.kind!=='BUYER'||state.tab!==sender.tab.id||state.organizationId!==m.organizationId||state.questionnaireId!==m.questionnaireId)return {ok:true};
  return {ok:true,nonce:state.nonce,capture:state.capture};
 }
 if(state?.kind==='IMPORT'){
  if(!external&&m.action==='INFO')return {ok:true,importPending:true};
  if(!external||state.tab!==sender.tab.id||m.nonce!==state.nonce||(state.organizationId&&state.organizationId!==m.organizationId))problem('Use the workspace and tab selected for this import.');
  if(m.action==='READ_IMPORT'){
   await store.set({pair:{...state,organizationId:m.organizationId}});return {ok:true,capture:state.capture};
  }
  if(m.action==='IMPORT_SAVED'&&state.organizationId===m.organizationId){
   await store.set({pair:{...state,kind:'BUYER',questionnaireId:m.questionnaireId,title:String(m.title??'').slice(0,160),until:now+30*60000}});
   return {ok:true};
  }
  problem('Review the captured questions in the selected workspace first.');
 }
 if(external&&m.action==='IMPORT_SAVED'&&state?.kind==='BUYER'&&state.tab===sender.tab.id&&state.organizationId===m.organizationId&&state.questionnaireId===m.questionnaireId&&state.nonce===m.nonce)return {ok:true};
 if(external&&m.action==='PAIR'){
  await store.set({pair:{tab:sender.tab.id,organizationId:m.organizationId,questionnaireId:m.questionnaireId,nonce:m.nonce,title:String(m.title??'').slice(0,160),until:now+30*60000}});
  return {ok:true};
 }
 if(!state){if(!external&&m.action==='INFO')return {ok:true};problem('Pair a RegPilot questionnaire first.');}
 if(external&&(state.tab!==sender.tab.id||['organizationId','questionnaireId','nonce'].some(k=>m[k]!==state[k])))problem('This pairing belongs to a different questionnaire.');
 if(external&&m.action==='READ')return {ok:true,capture:state.capture??null};
 if(!external&&m.action==='INFO'){
  const ticket=state.buyerTab===m.tab&&Date.parse(state.ticket?.expiresAt)>now?state.ticket:null;
  return {ok:true,title:state.title,paired:true,nonce:state.nonce,captured:!!state.capture,ticket};
 }
 if(!external&&m.action==='CAPTURE'){
  if(m.nonce!==state.nonce||!Number.isInteger(m.tab)||m.tab===state.tab||!validFields(m.capture)||m.capture.origin===target.origin||state.capture)problem('Pair again before replacing the captured buyer page.');
  const {format,origin,pageHash,fields}=m.capture;
  await store.set({pair:{...state,buyerTab:m.tab,capture:{format,origin,pageHash,fields}}});
  await focus(state.tab);return {ok:true};
 }
 if(external&&m.action==='DELIVER'){
  const t=m.ticket,c=state.capture;
  if(!c||t?.format!=='regpilot-portal-ticket-v1'||!uuid(t.handoffId)||!/^[A-Za-z0-9_-]{43}$/.test(t.secret)||t.pageHash!==c.pageHash||t.origin!==c.origin||!Array.isArray(t.labels)||!t.labels.length||t.labels.length>c.fields.length||!t.labels.every(l=>c.fields.includes(l))||!Number.isFinite(Date.parse(t.expiresAt))||Date.parse(t.expiresAt)<=now||Date.parse(t.expiresAt)>now+601000)problem('The reviewed hand-off no longer matches the buyer page.');
  const {format,handoffId,secret,origin,pageHash,labels,expiresAt}=t;
  await store.set({pair:{...state,ticket:{format,handoffId,secret,origin,pageHash,labels,expiresAt,regpilotOrigin:target.origin}}});
  await focus(state.buyerTab);return {ok:true};
 }
 if(!external&&m.action==='CLEAR'&&m.tab===state.buyerTab&&m.handoffId===state.ticket?.handoffId){await store.remove('pair');return {ok:true};}
 problem('This action is unavailable for the current pairing.');
}
