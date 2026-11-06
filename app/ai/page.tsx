"use client";
import {useCallback,useEffect,useState} from "react";
import {browserAuth} from "../../lib/client/supabase-auth";
import {readDemoCertificateFile} from "../../lib/demo-certificate-files.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {REGULATORY_SOURCES} from "../../lib/regulatory-sources.mjs";
import {validateObligation} from "../../lib/obligations.mjs";
import shell from "../workbench/workbench.module.css";
import ui from "./ai.module.css";
type Mode="document"|"change"|"assistant";
type Org={id:string;name:string;role:string};
type Finding={type:string;priority:string;title:string;rationale:string;recommendation:string;sourceQuote:string;documentQuote:string;sourceQuoteMatched:boolean;documentQuoteMatched:boolean;citationStatus:string};
type Suggestion={title:string;reason:string;ownerSuggestion:string;sourceQuote:string};
type Result={summary:string;confidence:string;findings:Finding[];suggestedActions:Suggestion[];questions:string[];limitations:string[];scope:string;generatedAt:string;source:{id:string;title:string;url:string;updatedAt:string|null;revisionAt:string|null}|null;model:string;usage?:{inputTokens:number|null;outputTokens:number|null}};
const ACTIONS_KEY="regpilot-demo-obligations-v1";
function dueIn(days:number){const d=new Date();d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function toBase64(bytes:Uint8Array){let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
export default function AiStudio(){
 const [feature,setFeature]=useState<boolean|null>(null);
 const [authReady,setAuthReady]=useState(false);
 const [user,setUser]=useState<{email:string}|null>(null);
 const [organisations,setOrganisations]=useState<Org[]>([]);
 const [orgId,setOrgId]=useState("");
 const [company,setCompany]=useState("RegPilot pilot business");
 const [email,setEmail]=useState("");
 const [mode,setMode]=useState<Mode>("document");
 const [documentText,setDocumentText]=useState("");
 const [file,setFile]=useState<File|null>(null);
 const [selectedDocument,setSelectedDocument]=useState("");
 const [question,setQuestion]=useState("");
 const [businessContext,setBusinessContext]=useState("");
 const [sourceId,setSourceId]=useState("");
 const [owner,setOwner]=useState("");
 const [consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [result,setResult]=useState<Result|null>(null);
 const [accepted,setAccepted]=useState<number[]>([]);
 const [requestId,setRequestId]=useState("");
 const loadSession=useCallback(async()=>{
  try{
   const supabase=browserAuth();
   const {data,error}=await supabase.auth.getSession();
   if(error)throw error;
   const token=data.session?.access_token;
   if(!token){setUser(null);setOrganisations([]);setOrgId("");return}
   const response=await fetch("/api/ai/context",{headers:{authorization:"Bearer "+token},cache:"no-store"});
   const json=await response.json();
   if(!response.ok){setMessage(json.error||"Access unavailable");setUser(null);return}
   setUser({email:json.email});setOwner(o=>o||json.email||"");
   const list:Array<Org>=Array.isArray(json.organisations)?json.organisations:[];
   setOrganisations(list);setOrgId(prev=>list.some(o=>o.id===prev)?prev:list[0]?.id||"");
  }catch(e){setMessage(e instanceof Error?e.message:"Cannot access pilot account")}finally{setAuthReady(true)}
 },[]);
 useEffect(()=>{
  let active=true;
  void fetch("/api/ai/analyse",{cache:"no-store"}).then(r=>r.json()).then(j=>{if(active)setFeature(j.enabled===true)}).catch(()=>{if(active)setFeature(false)});
  const {data}=browserAuthSafe();
  if(data?.auth){const {data:listener}=data.auth.onAuthStateChange(()=>{void loadSession()});void loadSession();return()=>{active=false;listener.subscription.unsubscribe();}}
  setAuthReady(true);return()=>{active=false};
 },[loadSession]);
 function browserAuthSafe(){try{return {data:browserAuth()}}catch{return {data:null}}}
 async function sendMagicLink(e:React.FormEvent){
  e.preventDefault();setMessage("");setBusy(true);
  try{
   const {error}=await browserAuth().auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+"/ai"}});
   if(error)throw error;setMessage("Check your inbox for the secure sign-in link. Return to this device and browser.");
  }catch(e){setMessage(e instanceof Error?e.message:"Unable to send email")}finally{setBusy(false)}
 }
 async function signOut(){try{await browserAuth().auth.signOut();setUser(null);setOrganisations([]);setOrgId("");setResult(null)}catch{setMessage("Sign-out failed")}}
 async function bootstrap(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Sign in first");
   const r=await fetch("/api/ai/context",{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({company})});
   const json=await r.json();if(!r.ok)throw new Error(json.error||"Cannot create pilot workspace");
   await loadSession();setMessage("Private pilot workspace ready. Only fictional or non-sensitive data is permitted.");
  }catch(e){setMessage(e instanceof Error?e.message:"Unable to start pilot")}finally{setBusy(false)}
 }
 async function run(e:React.FormEvent){
  e.preventDefault();setMessage("");setBusy(true);setResult(null);setAccepted([]);
  try{
   if(!consent)throw new Error("Explicit consent to external AI processing is required");
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("You are not signed in");
   let pdfBase64="";
   if(file){if(file.type!=="application/pdf"||file.size>2_000_000||file.size<20)throw new Error("Choose a PDF smaller than 2 MB");pdfBase64=toBase64(new Uint8Array(await file.arrayBuffer()))}
   const response=await fetch("/api/ai/analyse",{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({organizationId:orgId,mode,documentText,question,businessContext,sourceId,pdfBase64,consent:true})});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error||"AI request could not complete");
   setResult(json.ai as Result);setRequestId(json.requestId||"");
  }catch(e){setMessage(e instanceof Error?e.message:"AI request failed")}finally{setBusy(false)}
 }
 function accept(s:Suggestion,index:number){
  if(accepted.includes(index))return;
  const responsible=owner.trim();
  if(!responsible){setMessage("Enter an action owner before accepting the draft");return;}
  const raw=localStorage.getItem(ACTIONS_KEY);
  let parsed:unknown;
  try{parsed=JSON.parse(raw||"[]")}catch{parsed=[]}
  const items=Array.isArray(parsed)?parsed.filter(validateObligation):[];
  if(items.length>=1000){setMessage("The local action register is full");return;}
  const action={id:crypto.randomUUID(),title:s.title.slice(0,160),regulator:result?.source?"Official source review":"AI draft suggestion",owner:responsible.slice(0,80),due:dueIn(7),status:"Open",notes:("AI-generated suggestion, approved for DEMO action by a human: "+s.reason).slice(0,500),
   sourceUrl:result?.source?.url||"",sourceCheckedAt:result?.source?dueIn(0):""};
  if(!validateObligation(action)){setMessage("Draft could not pass action validation");return;}
  try{
   localStorage.setItem(ACTIONS_KEY,JSON.stringify([action,...items]));
   setAccepted(prev=>[...prev,index]);setMessage("Draft action added to this browser's demo register, not to a secure company database.");
  }catch{setMessage("Unable to save demo task in browser storage");}
 }
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);
  const requestedSource=params.get("sourceId");
  if(requestedSource&&REGULATORY_SOURCES.some(s=>s.id===requestedSource))setSourceId(requestedSource);
  const requestedDoc=params.get("documentId");
  if(requestedDoc){
   try{
    const stored:unknown=JSON.parse(localStorage.getItem("regpilot-document-library-v1")||"[]");
    if(!Array.isArray(stored))return;
    const doc=stored.filter(validDocumentMetadata).find(x=>x.id===requestedDoc);
    if(!doc)return;
    setMode("document");setSelectedDocument(doc.title);
    void readDemoCertificateFile("document-"+doc.id).then((f:any)=>{
     if(f?.blob&&f.type==="application/pdf")setFile(new File([f.blob],f.name,{type:"application/pdf"}));
     else setMessage("Document metadata loaded. Only a stored demo PDF can be imported for analysis; paste text for other formats.");
    }).catch(()=>setMessage("Could not read the local demo file."));
   }catch{}
  }
 },[]);
 const working=busy||!authReady;
 const canRun=user&&orgId&&feature===true;
 return <div className={shell.app}>
  <aside className={shell.sidebar}>
   <a href="/workbench" className={shell.logo}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>INTELLIGENCE &amp; OPERATIONS</small></span></a>
   <div className={shell.sideCaption}>WORKSPACE</div>
   <nav className={shell.sideNav} aria-label="Navigation">
    <a href="/workbench">◉ &nbsp;Today's work</a>
    <a className={shell.active} aria-current="page" href="/ai">✦ &nbsp;AI review studio</a>
    <a href="/intelligence">◇ &nbsp;Regulatory intelligence</a>
    <a href="/traceability">◈ &nbsp;Traceability explorer</a>
    <a href="/documents">▣ &nbsp;Documents</a>
    <a href="/assurance">▤ &nbsp;Review centre</a>
   </nav>
   <div className={shell.sideFoot}><strong>Private pilot</strong><p>AI output is a draft. An authorised human must verify sources, decisions and all proposed actions.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Workspace / AI review studio</span><div className={shell.topActions}><span className={shell.demo}>SECURE PILOT · DEVELOPMENT</span><a href="/workbench" className={shell.profile}>Dashboard</a></div></div>
   <header className={ui.hero}><div><span className={ui.eyebrow}>REGPILOT INTELLIGENCE ENGINE</span><h1>Review smarter.<br/><em>Decide with confidence.</em></h1><p>AI-assisted policy reviews, regulatory impact drafts and plain-English questions, with source-grounded excerpts and human approval.</p></div><div className={ui.heroSide}><span>PROCESSING POLICY</span><strong>Human-led</strong><p>Findings are provisional, quotes are checked where possible, and nothing is automatically approved or filed.</p></div></header>
   <div className={shell.warning}><strong>Private AI pilot — no sensitive information.</strong> Supplied text and PDFs are transmitted to an external model provider, potentially outside the UK. Do not send genuine patient, staff, supplier, confidential or regulated records. No legal or regulatory conclusion is provided.</div>
   {message&&<div className={ui.alert} role="status">{message}<button type="button" onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}
   {feature===false&&<div className={ui.setup}><strong>AI integration is installed but not activated.</strong><p>Verified Supabase login, an invite allowlist, a migrated database and Gateway credentials are required. The server intentionally refuses AI requests until configured.</p></div>}
   <div className={ui.layout}>
    <section className={ui.controls}>
     <div className={ui.sectionHead}><span>01 / ACCESS</span><h2>Secure pilot session</h2></div>
     {user?<div className={ui.session}><div><strong>{user.email}</strong><small>Verified pilot email</small></div><button type="button" onClick={()=>void signOut()}>Sign out</button></div>:
      <form onSubmit={sendMagicLink} className={ui.smallForm}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.co.uk"/></label><button type="submit" disabled={working||feature!==true}>Email me a sign-in link</button></form>}
     {user&&organisations.length>0&&<label className={ui.fieldLabel}>Authorised business<select value={orgId} onChange={e=>setOrgId(e.target.value)}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}</select></label>}
     {user&&organisations.length===0&&<form className={ui.smallForm} onSubmit={bootstrap}><label>Pilot business name<input value={company} minLength={3} maxLength={100} onChange={e=>setCompany(e.target.value)}/></label><button disabled={working}>Set up pilot company</button></form>}
     <div className={ui.sectionHead}><span>02 / AI WORKFLOW</span><h2>What should RegPilot review?</h2></div>
     <div className={ui.modes}>{([{id:"document",name:"Review a policy"},{id:"change",name:"Assess regulatory impact"},{id:"assistant",name:"Ask RegPilot"}] as const).map(m=><button type="button" key={m.id} className={mode===m.id?ui.modeActive:ui.mode} onClick={()=>{setMode(m.id);setResult(null);}}>{m.name}</button>)}</div>
     <form onSubmit={run} className={ui.form}>
      <label>UK business context (fictional)<textarea rows={2} maxLength={2500} value={businessContext} onChange={e=>setBusinessContext(e.target.value)} placeholder="Example: Small wholesale business reviewing supplier procedures."/></label>
      <label>Official GOV.UK source<select value={sourceId} onChange={e=>setSourceId(e.target.value)} required={mode==="change"}><option value="">No official source selected</option>{REGULATORY_SOURCES.map(s=><option key={s.id} value={s.id}>{s.agency}: {s.title}</option>)}</select></label>
      {(mode==="document"||mode==="assistant")&&<label>{mode==="document"?"Policy/document text (fictional)":"Relevant policy or context (optional)"}<textarea rows={5} maxLength={16000} value={documentText} onChange={e=>setDocumentText(e.target.value)} placeholder="Paste non-sensitive example policy text…"/></label>}
      {mode==="document"&&selectedDocument&&<p className={ui.hint}>Selected document from demo library: <strong>{selectedDocument}</strong>. Review the content before sending it to an external model provider.</p>}
      {mode==="document"&&<label>Or upload a non-sensitive example PDF (max 2 MB)<input type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>}
      {mode!=="document"&&<label>Your question<input maxLength={1500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What could this change affect?"/></label>}
      {mode==="document"&&<label>Question (optional)<input maxLength={1500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Which sections might need review?"/></label>}
      <label className={ui.check}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I confirm this contains fictional or non-sensitive content and I consent to external AI processing.</span></label>
      <button type="submit" className={ui.run} disabled={!canRun||working||!consent}>{busy?"Running secure analysis…":"Run AI review →"}</button>
      <p className={ui.hint}>A daily user/organisation limit is enforced by the database. AI Gateway spend must also be capped in Vercel. Your document contents are not stored by this route.</p>
     </form>
    </section>
    <section className={ui.results}>
     <div className={ui.sectionHead}><span>03 / HUMAN REVIEW</span><h2>AI findings</h2></div>
     {!result?<div className={ui.empty}><span>✧</span><h3>Ready for evidence-led analysis</h3><p>Authenticate, choose a workflow and submit fictional material. The result will be marked as a draft and will never alter records automatically.</p></div>:<>
      <div className={ui.summary}><span>AI DRAFT · HUMAN REVIEW REQUIRED</span><h3>Summary</h3><p>{result.summary}</p><small>Model: {result.model} · Confidence: {result.confidence} · {new Date(result.generatedAt).toLocaleString("en-GB")}</small>
       {result.source&&<a href={result.source.url} target="_blank" rel="noopener noreferrer">Open original official source ↗</a>}</div>
      <div className={ui.findings}><div className={ui.resultHeading}><h3>Potential findings</h3><span>{result.findings.length}</span></div>
       {result.findings.length===0?<p>No specific finding was returned. This does not mean the material is compliant.</p>:result.findings.map((f,i)=><article key={i} className={ui.finding}><div className={ui.flag}>{f.type} · {f.priority} priority</div><h4>{f.title}</h4><p>{f.rationale}</p><div className={ui.recommendation}><strong>Suggested next step</strong><p>{f.recommendation}</p></div>
        {f.sourceQuote&&<blockquote><span>{f.sourceQuoteMatched?"Source excerpt text matched":"Source quotation NOT verified"}</span><p>“{f.sourceQuote}”</p></blockquote>}
        {f.documentQuote&&<blockquote><span>{f.documentQuoteMatched?"Pasted document text matched":"Document quotation NOT independently verified"}</span><p>“{f.documentQuote}”</p></blockquote>}
       </article>)}
      </div>
      <div className={ui.actions}><h3>Suggested corrective work</h3><p>Only a human can add a draft task to the browser-local demo register.</p>
       {result.suggestedActions.length>0&&<label className={ui.fieldLabel}>Responsible owner for accepted tasks<input maxLength={80} value={owner} onChange={e=>setOwner(e.target.value)}/></label>}
       {result.suggestedActions.map((s,i)=><div key={i} className={ui.suggestion}><div><strong>{s.title}</strong><p>{s.reason}</p></div><button type="button" disabled={accepted.includes(i)} onClick={()=>accept(s,i)}>{accepted.includes(i)?"Added to local demo ✓":"Accept draft action"}</button></div>)}
      </div>
      {(result.questions.length>0||result.limitations.length>0)&&<div className={ui.questions}><h3>Questions and limitations</h3>{result.questions.map((q,i)=><p key={"q"+i}>• {q}</p>)}{result.limitations.map((q,i)=><p key={"l"+i}>• {q}</p>)}</div>}
      <p className={ui.request}>Request ID: {requestId} · AI usage: {result.usage?.inputTokens??"?"} input / {result.usage?.outputTokens??"?"} output tokens</p>
     </>}
    </section>
   </div>
   <footer className={shell.footer}>RegPilot AI · Private development pilot · No automated compliance verdict, formal approval or production-grade file handling.</footer>
  </main>
 </div>;
}
