'use client';
import {useEffect,useRef,useState} from 'react';
import type {applicabilityStatementPage} from '../../../lib/server/applicability-statement';
import ui from '../operations/operations.module.css';

type Page=Awaited<ReturnType<typeof applicabilityStatementPage>>;
type Row=Page['rows'][number];
const labels:Record<string,string>={AWAITING_APPROVAL:'Awaiting approved revision',SOURCE_REVIEW:'Source or context needs review',SCOPE_REVIEW:'Applicability decision needed',EXCLUDED:'Excluded with rationale',OWNER_REVIEW:'Owner needs review',APPLIES_MAPPED:'Applies · reviewed mapping',APPLIES_UNMAPPED:'Applies · mapping needed'};
function csvCell(value:string){
  const safe=/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(value)?"'"+value:value;
  return '"'+safe.replaceAll('"','""')+'"';
}
function save(name:string,type:string,content:string){
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ApplicabilityStatement({organizationId,request}:{organizationId:string;request:(path:string,options?:RequestInit)=>Promise<Page>}){
  const [scope,setScope]=useState(''),[pages,setPages]=useState<Page[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[index,setIndex]=useState(0);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function refresh(){
    pending.current?.abort();
    const controller=new AbortController();pending.current=controller;setBusy(true);setMessage('');setPages([]);setIndex(0);
    try{
      const collected:Page[]=[];
      let offset:number|null=0,inventory='',count=0;
      while(offset!==null){
        const q=new URLSearchParams({organizationId,collection:scope.trim(),offset:String(offset)});
        if(inventory)q.set('inventory',inventory);
        const response:Page=await request('/api/workspace/library/statement?'+q,{signal:controller.signal});
        if(controller.signal.aborted)return;
        if(response.organizationId!==organizationId||response.offset!==offset||(inventory&&inventory!==response.inventory))throw Error('The statement changed. Refresh to load it again.');
        inventory=response.inventory;collected.push(response);count+=response.rows.length;offset=response.nextOffset;
        if(offset!==null&&offset!==count)throw Error('Statement page is incomplete. Refresh to retry.');
        if(offset===null&&count!==response.total)throw Error('The collection changed during preparation. Refresh to retry.');
        if(offset!==null)setMessage('Checked '+count+' of '+response.total+' requirements.');
      }
      setPages(collected);setMessage(count?'':'No requirements matched this collection.');
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Could not prepare the statement.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  const rows=pages.flatMap(p=>p.rows);
  function downloadCsv(){
    const table=[['Collection','Reference','Revision','Requirement','Applicability','Rationale','Owner ID','Reviewer ID','Decision date','Source','Original source ID','Control','Mapping state','Cited evidence','Connected evidence','Checked at']];
    for(const page of pages)for(const row of page.rows){
      const maps:Array<Row['mappings'][number]|undefined>=row.mappings.length?row.mappings:[undefined];
      for(const m of maps)table.push([row.collection,row.reference,String(row.revision),row.title,labels[row.state],row.rationale??row.reasons.join(' / '),row.ownerId??'',row.reviewerId??'',row.reviewedAt??'',row.source?.name??'',row.source?.id??'',m?.title??'',m?.reason??'',
        m?.citations.map(c=>c.id+' '+c.location+' '+(c.sha256??'')).join(' / ')??'',m?.signals.map(s=>s.provider+' '+s.status+' '+(s.runId??'')+' '+(s.observedAt??'')).join(' / ')??'',page.checkedAt]);
    }
    save('regpilot-applicability-statement.csv','text/csv;charset=utf-8','\uFEFF'+table.map(line=>line.map(csvCell).join(',')).join('\r\n'));
  }
  return <section className={ui.card} aria-label="Applicability statement">
    <h2>Applicability statement</h2><p>Review which requirements apply, why a requirement was excluded, and which controls and evidence support each decision.</p>
    <form className={ui.toolbar} onSubmit={e=>{e.preventDefault();void refresh();}}>
      <label>Collection <input placeholder="All collections" maxLength={100} value={scope} disabled={busy} onChange={e=>{setScope(e.target.value);setPages([]);setMessage('');}}/></label>
      <button disabled={busy}>{busy?'Checking requirements…':'Refresh statement'}</button>
    </form>
    {message&&<p role="status">{message}</p>}
    {rows.length>0&&<>
      <p>{rows.length} requirements. {rows.filter(r=>r.state==='APPLIES_MAPPED').length} with a current mapping. {rows.filter(r=>r.state==='EXCLUDED').length} excluded with a rationale.</p>
      <p className={ui.hint}>Each page records when its evidence was checked. Control mappings describe the relationship to a requirement. Review the underlying signals before deciding whether the control operated effectively.</p>
      <div className={ui.buttons}><button type="button" onClick={downloadCsv}>Download CSV</button><button type="button" onClick={()=>save('regpilot-applicability-evidence.json','application/json',JSON.stringify({format:'regpilot-applicability-evidence-v1',pages},null,2))}>Download evidence JSON</button></div>
      {pages[index]?.rows.map(row=><details key={row.id}><summary>{row.collection} · {row.reference} · {labels[row.state]}</summary>
        <p>{row.title} {row.revision?'· revision '+row.revision:''}</p>
        {row.rationale&&<p>{row.rationale}</p>}{row.reasons.map(s=><p key={s}>{s}</p>)}
        {row.revisionId&&<a href={'/team/library?'+new URLSearchParams({organizationId,revisionId:row.revisionId})}>Open requirement and decision history</a>}
        {row.mappings.map(m=><div key={m.decisionId}><strong>{m.title}</strong><p>{m.reason}. {m.citations.length} cited locations.</p>{m.rationale&&<p>{m.rationale}</p>}{m.signals.map(s=><p key={s.connectionId}>{s.provider} · {s.status} · {s.observedAt??'No observation'}</p>)}</div>)}
      </details>)}
      {pages.length>1&&<div className={ui.buttons}><button disabled={index===0} onClick={()=>setIndex(i=>i-1)}>Previous</button><span>Page {index+1} of {pages.length}</span><button disabled={index===pages.length-1} onClick={()=>setIndex(i=>i+1)}>Next</button></div>}
    </>}
  </section>;
}
