"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {Analysis} from "../../../lib/regulatory/intelligence";
import {browserAuth} from "../../../lib/client/supabase-auth";
import shell from "../../workbench/workbench.module.css";
import ui from "./intelligence.module.css";

type Org={id:string;name:string;role:string};
type Profile={activities:string[];jurisdictions:string[];version:number};
type Decision={candidateKey:string;decision:string;rationale:string;obligation:null|{id:string;title:string;status:string;evidence:{state:string;nextStep:string;total:number;independentlyReviewed:number}}};
type Run={id:string;createdById:string;createdAt:string;profileVersion:number;stale:boolean;integrityValid:boolean;result:Analysis|null;decisions:Decision[];snapshot:{id:string;sourceId:string;title:string;url:string;contentHash:string;reviewStatus:string;lastCheckedAt:string}};
type Workspace={profile:Profile|null;runs:Run[];sources:{id:string;sourceId:string;title:string;stale:boolean;lastCheckedAt:string;reviewStatus:string}[]};
const activities=[{id:"personal-data",label:"Customer or staff information"},{id:"employing-staff",label:"Employing people"},{id:"premises",label:"Business premises"},{id:"medicines",label:"Medicines"},{id:"controlled-drugs",label:"Controlled drugs"}];
const nations=["England","Scotland","Wales","Northern Ireland"];
const date=(value:string)=>new Date(value).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const label=(value:string)=>value.replaceAll("-"," ").replaceAll("_"," ").toLowerCase();

export default function IntelligenceWorkspace(){
  const [organisations,setOrganisations]=useState<Org[]>([]),[orgId,setOrgId]=useState(""),[userId,setUserId]=useState("");
  const [data,setData]=useState<Workspace|null>(null),[profile,setProfile]=useState<Profile>({activities:[],jurisdictions:[],version:0});
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("pending"),[selected,setSelected]=useState("");
  const [rationale,setRationale]=useState(""),[title,setTitle]=useState(""),[owner,setOwner]=useState(""),[due,setDue]=useState("");
  const activeOrg=useRef(orgId);
  useEffect(()=>{activeOrg.current=orgId;},[orgId]);
  const request=useCallback(async(path:string,options:RequestInit={})=>{
    const token=(await browserAuth().auth.getSession()).data.session?.access_token;
    if(!token)throw new Error("Sign in through the team workspace to continue.");
    const response=await fetch(path,{...options,headers:{...options.headers,authorization:"Bearer "+token},cache:"no-store"});
    const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to load intelligence");return body;
  },[]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    async function load(){
      try{
        const body=await request("/api/ai/context",{signal:controller.signal});
        if(active){setOrganisations(body.organisations||[]);setUserId(body.userId||"");setOrgId(previous=>(body.organisations||[]).some((o:Org)=>o.id===previous)?previous:body.organisations?.[0]?.id||"");}
      }catch(e){if(active){setData(null);setUserId("");setOrgId("");setOrganisations([]);setMessage(e instanceof Error?e.message:"Sign in to continue");}}
      finally{if(active)setLoading(false);}
    }
    let unsubscribe=()=>{};
    try{const {data:auth}=browserAuth().auth.onAuthStateChange((event)=>{if(event==="SIGNED_OUT"){activeOrg.current="";setData(null);setOrgId("");setUserId("");setOrganisations([]);}setTimeout(()=>{if(active)void load();},0);});unsubscribe=()=>auth.subscription.unsubscribe();void load();}
    catch{setMessage("Private workspace sign-in is not configured.");setLoading(false);}
    return()=>{active=false;controller.abort();unsubscribe();};
  },[request]);
  useEffect(()=>{
    setData(null);setSelected("");setProfile({activities:[],jurisdictions:[],version:0});setRationale("");setTitle("");setOwner("");setDue("");
    if(!orgId)return;
    let active=true;const controller=new AbortController();setLoading(true);
    request("/api/workspace/intelligence?organizationId="+encodeURIComponent(orgId),{signal:controller.signal}).then(body=>{
      if(active){setData(body);setProfile(body.profile||{activities:[],jurisdictions:[],version:0});}
    }).catch(e=>{if(active)setMessage(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[orgId,request]);
  const org=organisations.find(o=>o.id===orgId),admin=org&&["OWNER","ADMIN"].includes(org.role);
  const rows=useMemo(()=>(data?.runs||[]).flatMap(run=>(run.result?.candidates||[]).map(candidate=>({run,candidate,decision:run.decisions.find(d=>d.candidateKey===candidate.key),id:run.id+":"+candidate.key}))),[data]);
  const visible=rows.filter(row=>(filter==="all"||filter==="pending"&&!row.decision&&!row.run.stale||filter==="accepted"&&row.decision?.decision==="ACCEPTED")&&[row.candidate.quote,row.run.snapshot.title,...row.candidate.mappings.map(m=>m.title)].join(" ").toLowerCase().includes(query.toLowerCase()));
  const current=visible.find(row=>row.id===selected)||visible[0];
  const shared=useMemo(()=>{
    const groups=new Map<string,{title:string;count:number;domains:string[]}>();
    for(const row of rows.filter(r=>!r.run.stale))for(const mapping of row.candidate.mappings){const group=groups.get(mapping.id)||{title:mapping.title,count:0,domains:mapping.domains};group.count++;groups.set(mapping.id,group);}
    return [...groups.values()].sort((a,b)=>b.count-a.count).slice(0,6);
  },[rows]);
  async function mutate(path:string,method:string,body:Record<string,unknown>,success:string){
    if(busy)return;const submittedOrg=orgId;setBusy(true);setMessage("");
    try{
      await request(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,organizationId:orgId})});
      const fresh=await request("/api/workspace/intelligence?organizationId="+encodeURIComponent(orgId));
      if(activeOrg.current!==submittedOrg)return;
      setTitle("");setOwner("");setDue("");setData(fresh);setProfile(fresh.profile||{activities:[],jurisdictions:[],version:0});setMessage(success);setRationale("");
    }catch(e){if(activeOrg.current===submittedOrg)setMessage(e instanceof Error?e.message:"Unable to save your change");}finally{setBusy(false);}
  }
  function choose(id:string){if(busy)return;setSelected(id);setRationale("");setTitle("");setDue("");setOwner("");}
  function decide(decision:string){
    if(!current)return;
    void mutate("/api/workspace/intelligence/"+current.run.id,"POST",{candidateKey:current.candidate.key,decision,rationale,title,ownerName:owner,dueDate:due},decision==="ACCEPTED"?"Review saved and one linked task created in your team queue.":"Decision and rationale saved to the audit history.");
  }
  const reviewBlocked=current?.run.stale||!current?.run.integrityValid||current?.run.createdById===userId;
  return <div className={shell.app}>
    <aside className={shell.sidebar}>
      <a href="/workbench" className={shell.logo}><span className={shell.logoMark}>R</span><span>RegPilot <b>AI</b><small>YOUR COMPLIANCE WORKSPACE</small></span></a>
      <div className={shell.sideCaption}>PRIVATE WORKSPACE</div>
      <nav className={shell.sideNav}><a className={shell.active} href="/team/intelligence" aria-current="page">◈ &nbsp; Regulatory inbox</a><a href="/team/sources">↗ &nbsp; Official sources</a><a href="/team">▤ &nbsp; Team tasks</a><a href="/team/evidence">▣ &nbsp; Evidence vault</a><a href="/ai">✦ &nbsp; AI Studio</a></nav>
      <div className={shell.sideFoot}><strong>Every recommendation has a source.</strong><p>Review the passage, confirm its relevance, then choose the next action.</p></div>
    </aside>
    <main className={shell.main}>
      <div className={shell.topbar}><span className={shell.crumb}>Workspace / Regulatory inbox</span><span className={shell.demo}>PRIVATE PILOT</span></div>
      <header className={ui.hero}><div><span className={ui.eyebrow}>REGULATORY INTELLIGENCE</span><h1>Understand the change.<br/><em>Own the next step.</em></h1><p>Source-backed recommendations, a clear reason for each match, and a practical route from review to evidence.</p></div><div className={ui.orbit} aria-hidden="true">◈</div></header>
      <div className={ui.scope}>This inbox uses rule-based analysis of saved GOV.UK excerpts. Recommendations need human assessment. It does not run continuous monitoring or paid AI.</div>
      {message&&<div className={ui.notice} role="status">{message}</div>}
      {loading&&<p role="status">Loading your workspace…</p>}
      {!loading&&!orgId&&<section className={ui.empty}><h2>Start with your private workspace</h2><p>Sign in and choose your organisation to build a source-backed regulatory inbox.</p><a className={ui.linkButton} href="/team">Open team workspace ↗</a></section>}
      {orgId&&<>
        <div className={ui.toolbar}><label>Organisation<select disabled={busy} value={orgId} onChange={e=>setOrgId(e.target.value)}>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><a href="/team/sources">Check official sources ↗</a></div>
        {data&&<>
          <section className={ui.metrics} aria-label="Workspace summary"><div><span>Ready for review</span><strong>{rows.filter(r=>!r.decision&&!r.run.stale).length}</strong><small>Undecided recommendations</small></div><div><span>Sources to recheck</span><strong>{data.sources.filter(s=>s.stale).length}</strong><small>Checked over seven days ago</small></div><div><span>Accepted follow-ups</span><strong>{rows.filter(r=>r.decision?.decision==="ACCEPTED").length}</strong><small>Linked to real team tasks</small></div></section>
          <details className={ui.profile} open={!data.profile}><summary><span>01 / Your business context</span><strong>{data.profile?"Review your activities and locations":"Tell us what your business does"}</strong></summary><p>These choices help prioritise relevant topics. They do not determine which laws apply.</p><fieldset disabled={!admin||busy}><legend>Activities</legend><div className={ui.checks}>{activities.map(a=><label key={a.id}><input type="checkbox" checked={profile.activities.includes(a.id)} onChange={e=>setProfile(p=>({...p,activities:e.target.checked?[...p.activities,a.id]:p.activities.filter(x=>x!==a.id)}))}/>{a.label}</label>)}</div></fieldset><fieldset disabled={!admin||busy}><legend>Where you operate</legend><div className={ui.checks}>{nations.map(n=><label key={n}><input type="checkbox" checked={profile.jurisdictions.includes(n)} onChange={e=>setProfile(p=>({...p,jurisdictions:e.target.checked?[...p.jurisdictions,n]:p.jurisdictions.filter(x=>x!==n)}))}/>{n}</label>)}</div></fieldset>{admin&&<button disabled={busy} onClick={()=>void mutate("/api/workspace/intelligence/profile","PUT",profile,"Business profile saved. Earlier analyses now need refreshing.")}>Save business context</button>}</details>
          <section className={ui.sources}><div><span className={ui.eyebrow}>02 / SAVED SOURCES</span><h2>Turn a publication into review work</h2><p>Capture a source in Official sources first. Analysis reuses a saved excerpt, with no external AI request.</p></div>{data.sources.length?data.sources.map(s=><div className={ui.sourceRow} key={s.id}><div><strong>{s.title}</strong><small>Checked {date(s.lastCheckedAt)} · {s.stale?"Recheck recommended":label(s.reviewStatus)}</small></div><button disabled={busy||!data.profile||org?.role==="VIEWER"} onClick={()=>void mutate("/api/workspace/intelligence","POST",{snapshotId:s.id},"Source analysed. Review the recommendations below; repeated requests reuse the same analysis.")}>Analyse source ↗</button></div>):<div className={ui.empty}><p>No source snapshots yet.</p><a href="/team/sources">Capture your first official source ↗</a></div>}</section>
          <section className={ui.inbox}><div className={ui.inboxHead}><div><span className={ui.eyebrow}>03 / REVIEW AND DECIDE</span><h2>Your regulatory inbox</h2></div><label>Show<select value={filter} onChange={e=>{setFilter(e.target.value);choose("");}}><option value="pending">Awaiting review</option><option value="accepted">Accepted follow-ups</option><option value="all">All recommendations</option></select></label></div><label className={ui.search}>Find a passage or control<input type="search" placeholder="Search source text, records, training…" value={query} onChange={e=>{setQuery(e.target.value);choose("");}}/></label>
            <div className={ui.split}><div className={ui.queue}>{visible.map(row=><button key={row.id} className={current?.id===row.id?ui.selected:ui.queueItem} onClick={()=>choose(row.id)}><span>{row.run.stale?"Needs fresh analysis":row.decision?label(row.decision.decision):label(row.candidate.priority)}</span><strong>{row.candidate.quote.slice(0,150)}{row.candidate.quote.length>150?"…":""}</strong><small>{row.run.snapshot.title}</small></button>)}{!visible.length&&<div className={ui.empty}><h3>No recommendations in this view</h3><p>Analyse a source or change the filter. An empty inbox does not establish compliance.</p></div>}</div>
              <article className={ui.detail}>{current?<>
                <div className={ui.pills}><span>{label(current.candidate.language)}</span><span>{label(current.candidate.change)}</span><span>{label(current.candidate.applicability)}</span></div>
                <h3>The exact source passage</h3><blockquote>{current.candidate.quote}</blockquote><a href={current.run.snapshot.url} target="_blank" rel="noopener noreferrer">Read the complete official publication ↗</a><p className={ui.small}>Source checked {date(current.run.snapshot.lastCheckedAt)} · excerpt characters {current.candidate.start}–{current.candidate.end} · hash {current.run.snapshot.contentHash.slice(0,12)}</p>
                <h3>Why this appeared</h3>{current.candidate.reasons.map(reason=><p key={reason}>{reason}</p>)}
                <h3>Confirm before acting</h3><ul>{current.candidate.questions.map(question=><li key={question}>{question}</li>)}</ul>
                {current.candidate.dateMentions.length>0&&<p>Dates mentioned: {current.candidate.dateMentions.join(", ")}. Confirm their meaning; these are not assigned deadlines.</p>}
                <h3>Suggested controls and evidence</h3>{current.candidate.mappings.length?current.candidate.mappings.map(mapping=><div key={mapping.id} className={ui.mapping}><strong>{mapping.title}</strong><small>Matched words: {mapping.matchedTerms.join(", ")}</small><p>Possible reuse: {mapping.domains.join(" · ")}</p><ul>{mapping.evidenceNeeded.map(item=><li key={item}>{item}</li>)}</ul></div>):<p>No control theme matched. Ask your reviewer to select an appropriate control.</p>}
                {current.decision?<div className={ui.decision}><h3>{label(current.decision.decision)}</h3><p>{current.decision.rationale}</p>{current.decision.obligation&&<><strong>{current.decision.obligation.title}</strong><p>{current.decision.obligation.evidence.independentlyReviewed} independently reviewed files / {current.decision.obligation.evidence.total} attached</p><p>{current.decision.obligation.evidence.nextStep}</p><a href="/team">Open team tasks ↗</a></>}</div>:admin?<div className={ui.review}><h3>Your review decision</h3>{reviewBlocked?<p>{current.run.stale?"The source or business context changed. Generate a fresh analysis.":current.run.createdById===userId?"A different administrator must review an analysis you created.":"This analysis failed its integrity check."}</p>:<><label>Explain applicability, conditions and your decision<textarea rows={4} value={rationale} minLength={20} maxLength={800} onChange={e=>setRationale(e.target.value)}/></label><label>Follow-up task title<input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label><div className={ui.fields}><label>Owner<input maxLength={80} value={owner} onChange={e=>setOwner(e.target.value)}/></label><label>Task target date<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></div><p className={ui.small}>Choose a practical target date. It is not automatically a legal deadline. Acceptance creates one task and records the review.</p>{current.run.snapshot.reviewStatus!=="REVIEWED"&&<p>Complete independent source review in Official sources before accepting.</p>}<div className={ui.actions}><button disabled={busy||rationale.trim().length<20||!title.trim()||!owner.trim()||!due||current.run.snapshot.reviewStatus!=="REVIEWED"} onClick={()=>decide("ACCEPTED")}>Accept and create task</button><button className={ui.secondary} disabled={busy||rationale.trim().length<20} onClick={()=>decide("DISMISSED")}>Dismiss with rationale</button></div></>}</div>:<p className={ui.small}>An independent administrator can accept or dismiss this recommendation.</p>}
                <details className={ui.limitations}><summary>Analysis scope and limitations</summary><ul>{current.run.result?.warnings.map(w=><li key={w}>{w}</li>)}</ul><p>Engine {current.run.result?.engineVersion} · business profile v{current.run.profileVersion}</p></details>
              </>:<div className={ui.empty}><span className={ui.emptyGlyph}>◈</span><h3>A clear path from source to action</h3><p>Select a recommendation to inspect its evidence and decide what your business needs to do.</p></div>}</article>
            </div>
          </section>
          {shared.length>0&&<section className={ui.reuse}><span className={ui.eyebrow}>04 / REDUCE DUPLICATE WORK</span><h2>Shared control opportunities</h2><p>These themes recur across your current analyses. Review their scope before reusing evidence; matching words do not prove equivalent requirements.</p><div>{shared.map(group=><article key={group.title}><strong>{group.title}</strong><span>{group.count} suggested links</span><small>{group.domains.join(" · ")}</small></article>)}</div></section>}
        </>}
      </>}
      <footer className={shell.footer}>RegPilot AI · Sources → recommendations → human decisions → tasks → evidence</footer>
    </main>
  </div>;
}
