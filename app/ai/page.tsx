"use client";
import {useCallback,useEffect,useState} from "react";
import {browserAuth} from "../../lib/client/supabase-auth";
import {readDemoCertificateFile} from "../../lib/demo-certificate-files.mjs";
import {validDocumentMetadata} from "../../lib/document-categories.mjs";
import {REGULATORY_SOURCES} from "../../lib/regulatory-sources.mjs";

import shell from "../workbench/workbench.module.css";
import ui from "./ai.module.css";
type Mode="document"|"change"|"assistant";
type Org={id:string;name:string;role:string};
type SavedReview={id:string;organizationId:string;requestId:string;createdById:string;createdAt:string;mode:string;modelId:string;sourceUrl:string|null;status:"PENDING_REVIEW"|"REVIEWED"|"NEEDS_CHANGES"|"REDACTED";version:number;summary:string;reviewerId:string|null;reviewerNotes:string;reviewedAt:string|null;ai?:Result;sha256?:string};
type Finding={type:string;priority:string;title:string;rationale:string;recommendation:string;sourceQuote:string;documentQuote:string;sourceQuoteMatched:boolean;documentQuoteMatched:boolean;citationStatus:string;grounding?:string;reviewChecks?:string[];documentAnchor?:{page?:number;label?:string;coordinateSystem?:string;ambiguous:boolean;start:number;end:number}|null};
type Suggestion={title:string;reason:string;ownerSuggestion:string;sourceQuote:string;sourceQuoteMatched?:boolean};
type Amendment={section:string;proposedText:string;rationale:string;supportingSourceQuote:string;supportingSourceQuoteMatched?:boolean};
type Result={groundingSummary?:{documentCoverage?:{totalPages:number;extractedPages:number;truncated:boolean;blockingIssues?:string[]};pdfCoverage?:{totalPages:number;extractedPages:number;truncated:boolean;unreadablePages:number[]};findings:number;dualTextMatches:number;unverified:number;pdfRequiresManualCheck:boolean;meaningVerified:boolean};summary:string;confidence:string;findings:Finding[];suggestedActions:Suggestion[];suggestedAmendments:Amendment[];questions:string[];limitations:string[];scope:string;generatedAt:string;source:{id:string;title:string;url:string;updatedAt:string|null;revisionAt:string|null}|null;model:string;usage?:{inputTokens:number|null;outputTokens:number|null}};

function dueIn(days:number){const d=new Date();d.setDate(d.getDate()+days);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function toBase64(bytes:Uint8Array){let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
export default function AiStudio(){
 const [feature,setFeature]=useState<boolean|null>(null);
 const [workspaceFeature,setWorkspaceFeature]=useState<boolean|null>(null);
 const [authReady,setAuthReady]=useState(false);
 const [user,setUser]=useState<{email:string;id:string}|null>(null);
 const [organisations,setOrganisations]=useState<Org[]>([]);
 const [orgId,setOrgId]=useState("");
 const [company,setCompany]=useState("RegPilot pilot business");
 const [email,setEmail]=useState("");
 const [mode,setMode]=useState<Mode>("document");
 const [documentText,setDocumentText]=useState("");
 const [file,setFile]=useState<File|null>(null);
 const [selectedDocument,setSelectedDocument]=useState("");
 const [evidenceId,setEvidenceId]=useState("");
 const [question,setQuestion]=useState("");
 const [businessContext,setBusinessContext]=useState("");
 const [sourceId,setSourceId]=useState("");
 const [owner,setOwner]=useState("");
 const [consent,setConsent]=useState(false);
 const [retainDraft,setRetainDraft]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [result,setResult]=useState<Result|null>(null);
 const [accepted,setAccepted]=useState<number[]>([]);
 const [requestId,setRequestId]=useState("");
 const [savedReviewId,setSavedReviewId]=useState("");
 const [savedReviews,setSavedReviews]=useState<SavedReview[]>([]);
 const [activeReview,setActiveReview]=useState<SavedReview|null>(null);
 const [reviewNotes,setReviewNotes]=useState("");
 const [reviewDecision,setReviewDecision]=useState<"REVIEWED"|"NEEDS_CHANGES">("REVIEWED");
 const [reviewBusy,setReviewBusy]=useState(false);
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
   setUser({email:json.email,id:json.userId||""});setOwner(o=>o||json.email||"");
   const list:Array<Org>=Array.isArray(json.organisations)?json.organisations:[];
   setOrganisations(list);setOrgId(prev=>list.some(o=>o.id===prev)?prev:list[0]?.id||"");
  }catch(e){setMessage(e instanceof Error?e.message:"Cannot access pilot account")}finally{setAuthReady(true)}
 },[]);
 useEffect(()=>{
  let active=true;
  void fetch("/api/ai/analyse",{cache:"no-store"}).then(r=>r.json()).then(j=>{if(active){setFeature(j.enabled===true);setWorkspaceFeature(j.workspaceEnabled===true)}}).catch(()=>{if(active){setFeature(false);setWorkspaceFeature(false)}});
  const {data}=browserAuthSafe();
  if(data?.auth){const {data:listener}=data.auth.onAuthStateChange(()=>{setTimeout(()=>void loadSession(),0)});void loadSession();return()=>{active=false;listener.subscription.unsubscribe();}}
  setAuthReady(true);return()=>{active=false};
 },[loadSession]);
 function browserAuthSafe(){try{return {data:browserAuth()}}catch{return {data:null}}}
 const fetchReviews=useCallback(async(targetOrg:string)=>{
  if(!targetOrg)return;
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/ai/reviews?organizationId="+encodeURIComponent(targetOrg),{
    headers:{authorization:"Bearer "+token},cache:"no-store"});
   const data=await res.json();
   if(!res.ok)throw new Error(data.error||"Review list unavailable");
   setSavedReviews(Array.isArray(data.reviews)?data.reviews:[]);
  }catch(error){setMessage(error instanceof Error?error.message:"Review history unavailable");}
 },[]);
 useEffect(()=>{
  setActiveReview(null);setSavedReviews([]);
  if(user?.id&&orgId&&workspaceFeature)void fetchReviews(orgId);
 },[user?.id,orgId,workspaceFeature,fetchReviews]);
 async function openReview(id:string){
  if(!orgId)return;setReviewBusy(true);
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/ai/reviews/"+encodeURIComponent(id)+"?organizationId="+encodeURIComponent(orgId),{
    headers:{authorization:"Bearer "+token},cache:"no-store"});
   const body=await res.json();
   if(!res.ok)throw new Error(body.error||"Could not open saved draft");
   setActiveReview(body.review);setReviewNotes("");
  }catch(error){setMessage(error instanceof Error?error.message:"Could not open review")}
  finally{setReviewBusy(false)}
 }

 async function redactSavedReview(){
  if(!activeReview||!orgId)return;
  if(!window.confirm("Remove this saved AI draft's generated content from active storage? This cannot be undone. Audit metadata and backups may still exist."))return;
  setReviewBusy(true);
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/ai/reviews/"+encodeURIComponent(activeReview.id),{
    method:"DELETE",
    headers:{"Content-Type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify({organizationId:orgId,version:activeReview.version})
   });
   const body=await res.json();
   if(!res.ok)throw new Error(body.error||"Could not redact saved output");
   await openReview(activeReview.id);
   await fetchReviews(orgId);
   setMessage("Generated content redacted from the active review record. Audit metadata and external processor retention are separate.");
  }catch(error){setMessage(error instanceof Error?error.message:"Review redaction failed")}
  finally{setReviewBusy(false)}
 }
 async function recordDecision(e:React.FormEvent){
  e.preventDefault();
  if(!activeReview||!orgId)return;
  setReviewBusy(true);
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Sign in first");
   const res=await fetch("/api/ai/reviews/"+encodeURIComponent(activeReview.id),{
    method:"PATCH",headers:{authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({organizationId:orgId,decision:reviewDecision,version:activeReview.version,notes:reviewNotes})
   });
   const body=await res.json();
   if(!res.ok)throw new Error(body.error||"Review decision not saved");
   setActiveReview(body.review);setReviewNotes("");
   await fetchReviews(orgId);
   setMessage("A human review decision was recorded for this AI draft. No legal or regulatory approval was granted.");
  }catch(error){setMessage(error instanceof Error?error.message:"Could not save decision")}
  finally{setReviewBusy(false)}
 }
 async function sendMagicLink(e:React.FormEvent){
  e.preventDefault();setMessage("");setBusy(true);
  try{
   const {error}=await browserAuth().auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+"/ai",shouldCreateUser:false}});
   if(error)throw error;setMessage("Check your inbox for the secure sign-in link. Return to this device and browser.");
  }catch(e){setMessage(e instanceof Error?e.message:"Unable to send email")}finally{setBusy(false)}
 }
 async function signOut(){try{await browserAuth().auth.signOut();setUser(null);setOrganisations([]);setOrgId("");setResult(null);setSavedReviews([]);setActiveReview(null)}catch{setMessage("Sign-out failed")}}
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
  e.preventDefault();setMessage("");setBusy(true);setResult(null);setAccepted([]);setSavedReviewId("");
  try{
   if(!consent)throw new Error("Explicit consent to external AI processing is required");
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("You are not signed in");
   let pdfBase64="",docxBase64="";
   if(file&&!evidenceId){if(!/\.(pdf|docx)$/i.test(file.name)||file.size>2_000_000||file.size<30)throw new Error("Choose a PDF or Word document smaller than 2 MB");const encoded=toBase64(new Uint8Array(await file.arrayBuffer()));if(file.name.toLowerCase().endsWith(".docx"))docxBase64=encoded;else pdfBase64=encoded;}
   const response=await fetch("/api/ai/analyse",{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({organizationId:orgId,mode,documentText,question,businessContext,sourceId,pdfBase64,docxBase64,evidenceId,consent:true,retainDraft})});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error||"AI request could not complete");
   setResult(json.ai as Result);setRequestId(json.requestId||"");
   setSavedReviewId(typeof json.reviewId==="string"?json.reviewId:"");
   if(json.storageWarning)setMessage(json.storageWarning);
   if(json.reviewId)void fetchReviews(orgId);
  }catch(e){setMessage(e instanceof Error?e.message:"AI request failed")}finally{setBusy(false)}
 }
 function exportDraft(){
  if(!result)return;
  const payload={format:"regpilot-ai-draft-review",version:1,generatedAt:result.generatedAt,requestId,model:result.model,source:result.source,summary:result.summary,findings:result.findings,suggestedActions:result.suggestedActions,suggestedAmendments:result.suggestedAmendments,questions:result.questions,limitations:result.limitations,scope:result.scope,groundingSummary:result.groundingSummary};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="regpilot-ai-review-draft.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function accept(s:Suggestion,index:number){
  if(accepted.includes(index))return;
  const responsible=owner.trim();
  if(!responsible){setMessage("Enter an owner before accepting a task");return;}
  if(!orgId){setMessage("Choose an authorised organisation first");return;}
  try{
   const token=(await browserAuth().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Sign in first");
   const response=await fetch("/api/workspace/obligations",{
    method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify({
     organizationId:orgId,title:s.title.slice(0,160),category:result?.source?"Official source impact review":"AI-assisted work",
     ownerName:responsible.slice(0,80),dueDate:dueIn(7),
     notes:("AI-generated draft suggestion accepted by an authorised user. Human review is still required: "+s.reason).slice(0,500),
     sourceUrl:result?.source?.url||""
    })
   });
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||"Could not create team task");
   setAccepted(prev=>[...prev,index]);
   setMessage("Draft task saved to the authorised team queue. No regulatory approval is implied.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not create team task. No local fallback was used.");}
 }

 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);
  const requestedEvidence=params.get("evidenceId");
  if(requestedEvidence&&/^[a-f0-9-]{36}$/i.test(requestedEvidence)){setMode("document");setEvidenceId(requestedEvidence);setSelectedDocument("Private evidence from the organisation vault");}
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
    <a href="/traceability">◈ &nbsp;Traceability explorer</a><a href="/team">▣ &nbsp;Secure team tasks</a><a href="/team/evidence">◈ &nbsp;Evidence vault</a>
    <a href="/documents">▣ &nbsp;Documents</a>
    <a href="/assurance">▤ &nbsp;Review centre</a>
   </nav>
   <div className={shell.sideFoot}><strong>Private pilot</strong><p>AI output is a draft. An authorised human must verify sources, decisions and all proposed actions.</p></div>
  </aside>
  <main className={shell.main}>
   <div className={shell.topbar}><span className={shell.crumb}>Workspace / AI review studio</span><div className={shell.topActions}><span className={shell.demo}>SECURE PILOT · DEVELOPMENT</span><a href="/workbench" className={shell.profile}>Dashboard</a></div></div>
   <header className={ui.hero}><div><span className={ui.eyebrow}>REGPILOT INTELLIGENCE ENGINE</span><h1>Review smarter.<br/><em>Decide with confidence.</em></h1><p>AI-assisted policy reviews, regulatory impact drafts and plain-English questions, with source-grounded excerpts and human approval.</p></div><div className={ui.heroSide}><span>PROCESSING POLICY</span><strong>Human-led</strong><p>Findings are provisional, quotes are checked where possible, and nothing is automatically approved or filed.</p></div></header>
   <div className={shell.warning}><strong>Private AI pilot — no sensitive information.</strong> Supplied text and document content are transmitted to an external model provider, potentially outside the UK. Do not send genuine patient, staff, supplier, confidential or regulated records. No legal or regulatory conclusion is provided.</div>
   {message&&<div className={ui.alert} role="status">{message}<button type="button" onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}
   {feature===false&&<div className={ui.setup}><strong>AI integration is installed but not activated.</strong><p>Verified Supabase login, an invite allowlist, a migrated database and Gateway credentials are required. The server intentionally refuses AI requests until configured.</p></div>}
   <div className={ui.layout}>
    <section className={ui.controls}>
     <div className={ui.sectionHead}><span>01 / ACCESS</span><h2>Secure pilot session</h2></div>
     {user?<div className={ui.session}><div><strong>{user.email}</strong><small>Verified pilot email</small></div><button type="button" onClick={()=>void signOut()}>Sign out</button></div>:
      <form onSubmit={sendMagicLink} className={ui.smallForm}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.co.uk"/></label><button type="submit" disabled={working||workspaceFeature!==true}>Email me a sign-in link</button></form>}
     {user&&organisations.length>0&&<label className={ui.fieldLabel}>Authorised business<select value={orgId} onChange={e=>setOrgId(e.target.value)}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}</select></label>}
     {user&&organisations.length===0&&<form className={ui.smallForm} onSubmit={bootstrap}><label>Pilot business name<input value={company} minLength={3} maxLength={100} onChange={e=>setCompany(e.target.value)}/></label><button disabled={working}>Set up pilot company</button></form>}
     <div className={ui.sectionHead}><span>02 / AI WORKFLOW</span><h2>What should RegPilot review?</h2></div>
     <div className={ui.modes}>{([{id:"document",name:"Review a policy"},{id:"change",name:"Assess regulatory impact"},{id:"assistant",name:"Ask RegPilot"}] as const).map(m=><button type="button" key={m.id} className={mode===m.id?ui.modeActive:ui.mode} onClick={()=>{setMode(m.id);setResult(null);}}>{m.name}</button>)}</div>
     <form onSubmit={run} className={ui.form}>
      <label>UK business context (fictional)<textarea rows={2} maxLength={2500} value={businessContext} onChange={e=>setBusinessContext(e.target.value)} placeholder="Example: Small wholesale business reviewing supplier procedures."/></label>
      <label>Official GOV.UK source<select value={sourceId} onChange={e=>setSourceId(e.target.value)} required={mode==="change"}><option value="">No official source selected</option>{REGULATORY_SOURCES.map(s=><option key={s.id} value={s.id}>{s.agency}: {s.title}</option>)}</select></label>
      {(mode==="document"||mode==="assistant")&&<label>{mode==="document"?"Policy/document text (fictional)":"Relevant policy or context (optional)"}<textarea rows={5} maxLength={16000} value={documentText} onChange={e=>setDocumentText(e.target.value)} placeholder="Paste non-sensitive example policy text…"/></label>}
      {mode==="document"&&evidenceId&&<p className={ui.hint}>Private organisation evidence selected (up to 2 MB). RegPilot retrieves and verifies the stored bytes server-side after checking your membership; no public file URL is issued. <button type="button" onClick={()=>setEvidenceId("")}>Clear selection</button></p>}
      {mode==="document"&&selectedDocument&&<p className={ui.hint}>Selected document from demo library: <strong>{selectedDocument}</strong>. Review the content before sending it to an external model provider.</p>}
      {mode==="document"&&<label>Or upload a non-sensitive example PDF or Word document (max 2 MB)<input type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={e=>{setEvidenceId("");setFile(e.target.files?.[0]||null);}}/></label>}
      {mode!=="document"&&<label>Your question<input maxLength={1500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What could this change affect?"/></label>}
      {mode==="document"&&<label>Question (optional)<input maxLength={1500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Which sections might need review?"/></label>}
      <label className={ui.check}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I confirm this contains fictional or non-sensitive content and I consent to external AI processing.</span></label>
      <label className={ui.check}><input type="checkbox" checked={retainDraft} onChange={e=>setRetainDraft(e.target.checked)}/><span>Optionally retain this generated AI draft in our organisation's private review inbox. Output may contain short document excerpts; original document/text is not saved by the review service.</span></label>
      <button type="submit" className={ui.run} disabled={!canRun||working||!consent}>{busy?"Running secure analysis…":"Run AI review →"}</button>
      <p className={ui.hint}>A daily user/organisation limit is enforced by the database. AI Gateway spend must also be capped in Vercel. Your document contents are not stored by this route.</p>
     </form>
    </section>
    <section className={ui.results}>
     <div className={ui.sectionHead}><span>03 / HUMAN REVIEW</span><h2>AI findings</h2></div>
     {!result?<div className={ui.empty}><span>✧</span><h3>Ready for evidence-led analysis</h3><p>Authenticate, choose a workflow and submit fictional material. The result will be marked as a draft and will never alter records automatically.</p></div>:<>
      <div className={ui.summary}><span>AI DRAFT · HUMAN REVIEW REQUIRED</span><h3>Summary</h3><p>{result.summary}</p><small>Model: {result.model} · Confidence: {result.confidence} · {new Date(result.generatedAt).toLocaleString("en-GB")}</small><p className={ui.savedNote}>{savedReviewId?"Draft retained in organisation review inbox · "+savedReviewId:"Not retained in the server review inbox."}</p><button type="button" className={ui.export} onClick={exportDraft}>Download draft review (JSON)</button>
       {result.source&&<a href={result.source.url} target="_blank" rel="noopener noreferrer">Open original official source ↗</a>}</div>
      {result.groundingSummary&&<div className={ui.summary}><h3>Evidence behind this review</h3><p>{result.groundingSummary.dualTextMatches} findings quote both the supplied source and document. {result.groundingSummary.unverified} findings have no matching quotation in either.</p><small>Text matches locate evidence; they do not verify the model’s interpretation.{result.groundingSummary.pdfRequiresManualCheck?" Check the original PDF’s layout, images and signatures.":""}</small>{result.groundingSummary.documentCoverage&&<><p>Word extraction: {result.groundingSummary.documentCoverage.extractedPages} / {result.groundingSummary.documentCoverage.totalPages} blocks{result.groundingSummary.documentCoverage.truncated?" · extraction limited":""}. References identify paragraphs or table rows, not Word pages. Inspect the original layout and signatures.</p>{result.groundingSummary.documentCoverage.blockingIssues?.map(issue=><p key={issue}>{issue}</p>)}</>}{result.groundingSummary.pdfCoverage&&<p>Server extraction: {result.groundingSummary.pdfCoverage.extractedPages} / {result.groundingSummary.pdfCoverage.totalPages} pages{result.groundingSummary.pdfCoverage.truncated?" · extraction limited":""}{result.groundingSummary.pdfCoverage.unreadablePages.length?" · unreadable pages: "+result.groundingSummary.pdfCoverage.unreadablePages.join(", "):""}.</p>}</div>}
      <div className={ui.findings}><div className={ui.resultHeading}><h3>Potential findings</h3><span>{result.findings.length}</span></div>
       {result.findings.length===0?<p>No specific finding was returned. This does not mean the material is compliant.</p>:result.findings.map((f,i)=><article key={i} className={ui.finding}><div className={ui.flag}>{f.type} · {f.priority} priority</div><h4>{f.title}</h4><p>{f.rationale}</p><div className={ui.recommendation}><strong>Suggested next step</strong><p>{f.recommendation}</p></div>
        {f.sourceQuote&&<blockquote><span>{f.sourceQuoteMatched?"Source excerpt text matched":"Source quotation NOT verified"}</span><p>“{f.sourceQuote}”</p></blockquote>}
        {f.reviewChecks&&<details><summary>What the reviewer needs to verify</summary><ul>{f.reviewChecks.map(check=><li key={check}>{check}</li>)}</ul></details>}
        {f.documentQuote&&<blockquote><span>{f.documentQuoteMatched?f.documentAnchor?.page?f.documentAnchor.coordinateSystem==="normalised-word-block"?"Word text matched · "+(f.documentAnchor.label||"block "+f.documentAnchor.page):"PDF text matched · page "+f.documentAnchor.page:"Document text matched":"Document quotation NOT uniquely verified"}</span><p>“{f.documentQuote}”</p>{f.documentAnchor?.ambiguous&&<small>This passage occurs more than once; check its context.</small>}</blockquote>}
       </article>)}
      </div>
      {result.suggestedAmendments?.length>0&&<div className={ui.amendments}><h3>Suggested policy wording — draft only</h3><p>No amendment is applied automatically. A qualified reviewer must check its wording and legal applicability.</p>
       {result.suggestedAmendments.map((a,i)=><article key={i}><span>{a.section}</span><p>{a.proposedText}</p><small>{a.rationale}</small>
        {a.supportingSourceQuote&&<small>{a.supportingSourceQuoteMatched?"Text matched in the retrieved official excerpt":"Unverified source quotation"}: “{a.supportingSourceQuote}”</small>}
        <button type="button" onClick={()=>{void navigator.clipboard.writeText(a.proposedText).then(()=>setMessage("Draft wording copied for independent review.")).catch(()=>setMessage("Unable to copy draft wording."));}}>Copy proposed wording</button>
       </article>)}
      </div>}
      <div className={ui.actions}><h3>Suggested corrective work</h3><p>Only an authorised user can add a suggested task to the organisation database. Nothing is added automatically.</p>
       {result.suggestedActions.length>0&&<label className={ui.fieldLabel}>Responsible owner for accepted tasks<input maxLength={80} value={owner} onChange={e=>setOwner(e.target.value)}/></label>}
       {result.suggestedActions.map((s,i)=><div key={i} className={ui.suggestion}><div><strong>{s.title}</strong><p>{s.reason}</p>{s.sourceQuote&&<small>{s.sourceQuoteMatched?"Source quotation matched retrieved text":"Source quotation not verified"}: “{s.sourceQuote}”</small>}</div><button type="button" disabled={accepted.includes(i)} onClick={()=>void accept(s,i)}>{accepted.includes(i)?"Added to team queue ✓":"Add to team queue"}</button></div>)}
      </div>
      {(result.questions.length>0||result.limitations.length>0)&&<div className={ui.questions}><h3>Questions and limitations</h3>{result.questions.map((q,i)=><p key={"q"+i}>• {q}</p>)}{result.limitations.map((q,i)=><p key={"l"+i}>• {q}</p>)}</div>}
      <p className={ui.request}>Request ID: {requestId} · AI usage: {result.usage?.inputTokens??"?"} input / {result.usage?.outputTokens??"?"} output tokens</p>
     </>}
    </section>
   </div>
   {user&&orgId&&<section className={ui.inbox}>
    <div className={ui.inboxTitle}><div><span>04 / SEPARATE HUMAN REVIEW</span><h2>Private team review inbox</h2><p>AI drafts can be checked by a different authorised administrator. This is not legal approval or a verified audit report.</p></div><button type="button" onClick={()=>void fetchReviews(orgId)} disabled={reviewBusy}>Refresh inbox</button></div>
    <div className={ui.inboxLayout}>
     <div className={ui.inboxList}>{savedReviews.length===0?<p>No saved draft reviews. Choose optional retention when running an AI analysis to create one.</p>:savedReviews.map(x=><button key={x.id} type="button" className={ui.inboxRow} onClick={()=>void openReview(x.id)}>
      <span>{x.status.replaceAll("_"," ")} · {x.mode}</span><strong>{x.summary.slice(0,140)||"AI draft review"}</strong><small>{new Date(x.createdAt).toLocaleDateString("en-GB")} · Version {x.version}</small></button>)}</div>
     <div className={ui.inboxDetail}>{!activeReview?<div className={ui.inboxEmpty}>Select a saved draft to view its recorded findings and review status.</div>:<>
      <span className={ui.inboxStatus}>{activeReview.status.replaceAll("_"," ")}</span>{activeReview.status!=="REDACTED"&&<button type="button" className={ui.redact} disabled={reviewBusy} onClick={()=>void redactSavedReview()}>Remove saved AI content</button>}<h3>{activeReview.summary}</h3>
      <small>Request {activeReview.requestId} · Model {activeReview.modelId} · Result SHA-256: {activeReview.sha256?.slice(0,16)||"—"}…</small>
      <div className={ui.inboxDraft}>{(activeReview.ai?.findings||[]).map((x,i)=><div key={i}><strong>{x.title}</strong><p>{x.rationale}</p><small>{x.sourceQuoteMatched?"Source quotation matches the retrieved text.":"Official source quotation not verified."}</small></div>)}</div>
      {activeReview.status==="PENDING_REVIEW"&&<form onSubmit={recordDecision} className={ui.inboxForm}>
       <label>Human decision<select value={reviewDecision} onChange={e=>setReviewDecision(e.target.value as "REVIEWED"|"NEEDS_CHANGES")}><option value="REVIEWED">Reviewed — findings assessed</option><option value="NEEDS_CHANGES">Needs changes or further evidence</option></select></label>
       <label>Review rationale (at least 20 characters)<textarea required minLength={20} maxLength={800} rows={3} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} placeholder="Explain what was checked, what remains uncertain and why." /></label>
       <button disabled={reviewBusy||activeReview.createdById===user.id||!["OWNER","ADMIN"].includes(organisations.find(o=>o.id===orgId)?.role||"")} type="submit">Record independent review</button>
       {activeReview.createdById===user.id&&<p>You created this AI draft. A different authorised owner or administrator must review it.</p>}
      </form>}
      {activeReview.status==="REDACTED"?<p className={ui.reviewedNote}>Saved AI output was redacted from this active record. Audit metadata may remain.</p>:activeReview.status!=="PENDING_REVIEW"&&<p className={ui.reviewedNote}>Review completed by another authorised user. Recorded rationale: {activeReview.reviewerNotes}</p>}
     </>}</div>
    </div>
   </section>}
   <footer className={shell.footer}>RegPilot AI · Private development pilot · No automated compliance verdict, formal approval or production-grade file handling.</footer>
  </main>
 </div>;
}
