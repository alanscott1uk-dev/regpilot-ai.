'use client';
import {useState} from 'react';
import {crosswalkCsv,type Crosswalk} from '../../../lib/programme-crosswalk';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import css from './programmes.module.css';

export function CrosswalkPanel({workspace,annexId,socProgrammes}:{workspace:ReturnType<typeof useWorkspaceContext>;annexId:string;socProgrammes:{id:string;name:string}[]}){
 const [selected,choose]=useState('');
 const combinedId=socProgrammes.find(p=>p.id===selected)?.id??socProgrammes[0]?.id;
 const [data,setData]=useState<Crosswalk|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[showAll,all]=useState(false);
 async function load(){
  const valid=workspace.capture();setBusy(true);setError('');setData(null);
  try{const result=await workspace.request('/api/workspace/programmes/crosswalk?'+new URLSearchParams({organizationId:workspace.organizationId,annexId,combinedId}));if(valid())setData(result);}
  catch(e){if(valid())setError(e instanceof Error?e.message:'The comparison could not be opened.');}finally{if(valid())setBusy(false);}
 }
 function download(){if(!data)return;const url=URL.createObjectURL(new Blob([crosswalkCsv(data)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='soc2-iso27001-evidence.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className={css.panel} aria-label="Shared SOC 2 and ISO evidence"><h2>Shared SOC 2 and ISO evidence</h2>
 <p>Compare the two saved programmes. Each ISO control keeps its own applicability decision.</p>
 {socProgrammes.length>1&&<label>SOC 2 programme<select disabled={busy} value={combinedId} onChange={e=>{choose(e.target.value);setData(null);}}>{socProgrammes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 <button disabled={busy} onClick={()=>void load()}>{busy?'Loading evidence…':data?'Refresh comparison':'Compare controls and evidence'}</button>{error&&<p role="alert">{error}</p>}
 {data&&<><p>{data.shared} of {data.rows.length} Annex A controls have a task mapped to SOC 2. {data.reviewedFiles} distinct reviewed files are linked to those controls.</p>
 {data.limited&&<p>The comparison includes the first 1,000 reviewed files in each programme.</p>}
 <button onClick={download}>Download joint evidence CSV</button> <label><input type="checkbox" checked={showAll} onChange={e=>all(e.target.checked)}/>Show all Annex A controls</label>
 {data.rows.filter(row=>showAll||row.tasks.some(link=>link.criteria.length)).map(row=><details key={row.code}><summary>{row.code} · {row.area} · {row.decision}</summary>
 {row.reason&&<p>{row.reason}</p>}{!row.tasks.length&&<p>No linked task in either saved programme.</p>}{row.tasks.map(link=><p key={link.task.id}><a href={link.task.href}>{link.task.title}</a> · {link.task.ownerName} · {link.task.status} · {link.criteria.join(', ')||'Annex A'} · {link.files.length} reviewed files</p>)}</details>)}</>}</section>;
}
