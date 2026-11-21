// Runs in the active tab only after a user gesture. No credentials or existing answers are read into the capture.
export async function questionnaireFields(expected,answers){
 const url=new URL(location.href);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Open the authorised HTTPS questionnaire first.');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url.origin+url.pathname+url.search+url.hash));
 const pageHash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 const controls=[...document.querySelectorAll('textarea,input[type="text"],input:not([type])')].flatMap(el=>{
  const label=(el.getAttribute('aria-label')||[...el.labels||[]].map(l=>l.textContent).join(' ')).trim().replace(/\s+/g,' ');
  const sensitive=/password|passcode|one.time|verification code|sign.in|bank account|sort code|credit card|email address|login|username|token|api.key/i;
  if(!label||label.length<3||label.length>600||el.disabled||el.readOnly||el.closest('[hidden],[inert]')||!el.getClientRects().length||getComputedStyle(el).visibility!=='visible'||sensitive.test([label,el.name,el.id,el.autocomplete].join(' ')))return [];
  return [{label,el}];
 });
 if(!controls.length||controls.length>100)throw Error('The page has no supported fields or exceeds the 100-field limit.');
 const capture={format:'regpilot-portal-fields-v1',origin:url.origin,pageHash,fields:controls.map(c=>c.label)};
 if(!answers)return capture;
 if(!expected||expected.origin!==capture.origin||expected.pageHash!==pageHash||JSON.stringify(expected.fields)!==JSON.stringify(capture.fields))throw Error('The page or its questions changed. Capture it again.');
 const plan=answers.map(a=>{const matches=controls.filter(c=>c.label===a.label);if(matches.length!==1||matches[0].el.value.trim()||typeof a.answer!=='string'||!a.answer.trim()||matches[0].el.maxLength>=0&&a.answer.length>matches[0].el.maxLength)throw Error('A field changed, already has an answer, or cannot hold the approved answer.');return {el:matches[0].el,value:a.answer};});
 for(const {el,value} of plan){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
 return {filled:plan.length};
}
