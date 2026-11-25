// Chrome serialises this function into the active buyer tab after an operator gesture.
export async function questionnaireFields(expected,answers){
 const url=new URL(location.href);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Open the authorised HTTPS questionnaire first.');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url.href));
 const pageHash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 const normalise=value=>value.trim().replace(/\s+/g,' ');
 function labelText(node){
  if(!node)return '';
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),parts=[];
  while(walker.nextNode()){
   if(!walker.currentNode.parentElement?.closest('input,textarea,select,button,script,style,[aria-hidden="true"]'))parts.push(walker.currentNode.textContent);
  }
  return parts.join(' ');
 }
 const sensitive=/password|passcode|one.time|verification code|sign.in|bank account|sort code|credit card|email address|login|username|token|api.key/i;
 const available=el=>!el.matches(':disabled')&&!el.readOnly&&!el.closest('[hidden],[inert],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible';
 function accessibleName(el,fallback){
  const ids=(el.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean);
  const referenced=ids.map(id=>labelText(document.getElementById(id))).join(' ').trim();
  return normalise(referenced||el.getAttribute('aria-label')||fallback);
 }
 const optionName=el=>accessibleName(el,[...el.labels||[]].map(labelText).join(' '));
 const controls=[],seen=new Set();
 const radios=[...document.querySelectorAll('input[type="radio"]')];
 for(const el of document.querySelectorAll('textarea,input[type="text"],input:not([type]),select:not([multiple]),input[type="radio"]')){
  if(!available(el)||seen.has(el))continue;
  let label,choices;
  if(el.type==='radio'){
   if(!el.name)continue;
   choices=radios.filter(r=>r.name===el.name&&r.form===el.form);
   for(const choice of choices)seen.add(choice);
   const group=el.closest('fieldset,[role="radiogroup"]');
   if(!group||choices.length<2||choices.some(r=>r.closest('fieldset,[role="radiogroup"]')!==group))continue;
   const legend=[...group.children].find(child=>child.tagName==='LEGEND');
   label=accessibleName(group,labelText(legend));
   if(choices.some(r=>sensitive.test([r.name,r.id,r.autocomplete,optionName(r)].join(' '))))continue;
  }else{
   label=optionName(el);
  }
  if(label.length<3||label.length>600||sensitive.test([label,el.name,el.id,el.autocomplete].join(' ')))continue;
  controls.push({label,el,choices});
 }
 if(!controls.length||controls.length>100)throw Error('The page has no supported fields or exceeds the 100-field limit.');
 const capture={format:'regpilot-portal-fields-v1',origin:url.origin,pageHash,fields:controls.map(c=>c.label)};
 if(!answers)return capture;
 if(!expected||expected.origin!==capture.origin||expected.pageHash!==pageHash||JSON.stringify(expected.fields)!==JSON.stringify(capture.fields))throw Error('The page or its questions changed. Capture it again.');
 if(!Array.isArray(answers)||new Set(answers.map(a=>a.label)).size!==answers.length)throw Error('Each reviewed answer needs its own buyer field.');
 const plan=answers.map(answer=>{
  const matches=controls.filter(c=>c.label===answer.label);
  if(matches.length!==1||typeof answer.answer!=='string'||!answer.answer.trim())throw Error('A reviewed answer has no unique buyer field.');
  const {el,choices}=matches[0];
  if(choices){
   if(choices.some(r=>r.checked))throw Error('The buyer already selected an answer. Review that question in the portal.');
   const matching=choices.filter(r=>available(r)&&optionName(r)===normalise(answer.answer));
   if(matching.length!==1||!matching[0].hasAttribute('value')||!matching[0].value||choices.filter(r=>r.value===matching[0].value).length!==1)
    throw Error('The approved answer must match one available radio choice exactly. Review this question in the buyer portal.');
   return {el:matching[0],property:'checked',value:true};
  }
  if(el instanceof HTMLSelectElement){
   const current=el.selectedOptions[0];
   if(current&&(current.value!==''||!/^((please )?(select|choose)( (an? )?(answer|option|response|value|one))?)?[\s.…*:-]*$/i.test(normalise(current.label))))throw Error('The buyer already selected an answer. Review that field in the portal.');
   const options=[...el.options],matching=options.filter(option=>option.value&&!option.matches(':disabled')&&!option.closest('[hidden]')&&normalise(option.label)===normalise(answer.answer));
   if(matching.length!==1||options.filter(option=>option.value===matching[0].value).length!==1)throw Error('The approved answer must match one available choice exactly. Review this question in the buyer portal.');
   return {el,property:'selectedIndex',value:matching[0].index};
  }
  if(el.value.trim()||el.maxLength>=0&&answer.answer.length>el.maxLength)throw Error('A field already has an answer or cannot hold the approved answer.');
  return {el,property:'value',value:answer.answer};
 });
 for(const {el,property,value} of plan){
  const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,property).set.call(el,value);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
 }
 if(plan.some(({el,property,value})=>!el.isConnected||el[property]!==value))throw Error('The buyer page changed during filling. Review its answers before capturing the page again.');
 return {filled:plan.length};
}
