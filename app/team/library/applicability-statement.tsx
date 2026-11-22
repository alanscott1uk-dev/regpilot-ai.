'use client';
import SiteProfiles from './site-profiles';
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
  const [on,setDate]=useState(()=>new Date().toISOString().slice(0,10));
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
        const q=new URLSearchParams({organizationId,on,collection:scope.trim(),offset:String(offset)});
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
    const table=[['Collection','Reference','Revision','Requirement','Applicability','Rationale','Owner ID','Reviewer ID','Decision date','Source','Original source ID','Control','Mapping state','Cited evidence','Connected evidence','Scenario date','England','Scotland','Wales','Northern Ireland',...(pages[0]?.siteRegister.sites??[]).map(s=>s.name+' ('+s.nation+')'),'Checked at']];
    for(const page of pages)for(const row of page.rows){
      const maps:Array<Row['mappings'][number]|undefined>=row.mappings.length?row.mappings:[undefined];
      for(const m of maps)table.push([row.collection,row.reference,String(row.revision),row.title,labels[row.state],row.rationale??row.reasons.join(' / '),row.ownerId??'',row.reviewerId??'',row.reviewedAt??'',row.source?.name??'',row.source?.id??'',m?.title??'',m?.reason??'',
        m?.citations.map(c=>c.id+' '+c.location+' '+(c.sha256??'')).join(' / ')??'',m?.signals.map(s=>s.provider+' '+s.status+' '+(s.runId??'')+' '+(s.observedAt??'')).join(' / ')??'',page.assessmentDate,...['England','Scotland','Wales','Northern Ireland'].map(n=>row.territories.find(t=>t.nation===n)?.assessment.state??'UNKNOWN'),...page.siteRegister.sites.map(site=>row.sites.find(s=>s.siteId===site.id)?.assessment.state??'UNKNOWN'),page.checkedAt]);
    }
    save('regpilot-applicability-statement.csv','text/csv;charset=utf-8','\uFEFF'+table.map(line=>line.map(csvCell).join(',')).join('\r\n'));
  }
  return <section className={ui.card} aria-label="Applicability statement">
    <h2>Applicability statement</h2><p>Review which requirements apply, why a requirement was excluded, and which controls and evidence support each decision.</p>
    <form className={ui.toolbar} onSubmit={e=>{e.preventDefault();void refresh();}}>
      <label>Collection <input placeholder="All collections" maxLength={100} value={scope} disabled={busy} onChange={e=>{setScope(e.target.value);setPages([]);setMessage('');}}/></label>
      <label>Territorial assessment date <input type="date" required value={on} disabled={busy} onChange={e=>{setDate(e.target.value);setPages([]);setMessage('');}}/></label>
      <button disabled={busy}>{busy?'Checking requirements…':'Refresh statement'}</button>
    </form>
    {message&&<p role="status">{message}</p>}
    {pages[0]?.canManageSites&&<SiteProfiles key={pages[0].siteRegister.version} version={pages[0].siteRegister.version} sites={pages[0].siteRegister.sites} disabled={busy} save={async body=>{
      await request('/api/workspace/library/statement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId,...body})});
      setPages([]);setIndex(0);setMessage('Site register updated. Refresh the statement to compare the current site facts.');
    }}/>}
    {rows.length>0&&<>
      <p>{rows.length} requirements. {rows.filter(r=>r.state==='APPLIES_MAPPED').length} with a current mapping. {rows.filter(r=>r.state==='EXCLUDED').length} excluded with a rationale.</p>
      {pages[0].siteRegister.sites.length>0&&<details><summary>Site differences and missing decisions</summary>
        <div style={{overflowX:'auto'}}><table><caption>Rules on {on} with different site results or an unknown assessment</caption><thead><tr><th scope="col">Requirement</th>{pages[0].siteRegister.sites.map(s=><th scope="col" key={s.id}>{s.name}</th>)}</tr></thead>
        <tbody>{rows.filter(r=>!r.sites.length||r.sites.some(s=>s.assessment.state==='UNKNOWN')||new Set(r.sites.map(s=>s.assessment.state)).size>1).map(r=><tr key={r.id}><th scope="row">{r.collection} · {r.reference}</th>{pages[0].siteRegister.sites.map(s=><td key={s.id}>{(r.sites.find(a=>a.siteId===s.id)?.assessment.state??'UNKNOWN').replace('_',' ').toLowerCase()}</td>)}</tr>)}</tbody></table></div></details>}
      <p className={ui.hint}>The four nation scenarios use the selected date, current approved source revision and the same saved business facts. The recorded human decision applies to the actual business. Each page records when its evidence was checked. Control mappings describe the relationship to a requirement. Review the underlying signals before deciding whether the control operated effectively.</p>
      <div className={ui.buttons}><button type="button" onClick={downloadCsv}>Download CSV</button><button type="button" onClick={()=>save('regpilot-applicability-evidence.json','application/json',JSON.stringify({format:'regpilot-applicability-evidence-v1',pages},null,2))}>Download evidence JSON</button></div>
      {pages[index]?.rows.map(row=><details key={row.id}><summary>{row.collection} · {row.reference} · {labels[row.state]}</summary>
        <p>{row.title} {row.revision?'· revision '+row.revision:''}</p>
        {row.rationale&&<p>{row.rationale}</p>}{row.reasons.map(s=><p key={s}>{s}</p>)}
        {row.sites.length>0&&<details><summary>Compare {row.sites.length} operating sites</summary><ul>{row.sites.map(s=><li key={s.siteId}><strong>{s.name}</strong> · {s.nation} · {s.assessment.state.replace('_',' ').toLowerCase()} · {s.assessment.explanation}{s.assessment.missing.length>0?' Missing facts: '+s.assessment.missing.join(', '):''}</li>)}</ul></details>}
        {row.territories.length>0&&<details><summary>Compare UK nations on {pages[index].assessmentDate}</summary><ul>{row.territories.map(t=><li key={t.nation}><strong>{t.nation}</strong> · {t.assessment.state.replace('_',' ').toLowerCase()} · {t.assessment.explanation}{t.assessment.missing.length>0?' Missing facts: '+t.assessment.missing.join(', '):''}</li>)}</ul></details>}
        {row.revisionId&&<a href={'/team/library?'+new URLSearchParams({organizationId,revisionId:row.revisionId})}>Open requirement and decision history</a>}
        {row.mappings.map(m=><div key={m.decisionId}><strong>{m.title}</strong><p>{m.reason}. {m.citations.length} cited locations.</p>{m.rationale&&<p>{m.rationale}</p>}{m.signals.map(s=><p key={s.connectionId}>{s.provider} · {s.status} · {s.observedAt??'No observation'}</p>)}</div>)}
      </details>)}
      {pages.length>1&&<div className={ui.buttons}><button disabled={index===0} onClick={()=>setIndex(i=>i-1)}>Previous</button><span>Page {index+1} of {pages.length}</span><button disabled={index===pages.length-1} onClick={()=>setIndex(i=>i+1)}>Next</button></div>}
    </>}
  </section>;
}
