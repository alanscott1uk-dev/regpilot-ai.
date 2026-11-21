'use client';
import {useEffect,useState} from 'react';
import {useWorkspaceContext} from '../../lib/client/workspace-context';
import type {helpMaintenance} from '../../lib/server/help-support';
import ui from '../sop-builder/sop.module.css';
type View=Awaited<ReturnType<typeof helpMaintenance>>;
export default function SupportPanel({article}:{article:string}){
 const w=useWorkspaceContext(),[data,setData]=useState<View|null>(null),[msg,tell]=useState(''),[task,setTask]=useState(''),[busy,lock]=useState(false);
 const url='/api/workspace/help?'+new URLSearchParams({organizationId:w.organizationId});
 useEffect(()=>{const ok=w.capture();let live=true;setData(null);tell('');setTask('');if(!w.signedIn||!w.organizationId)return;
  void (async()=>{if(article)await w.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'OPEN',guide:article})});const v=await w.request(url);if(live&&ok())setData(v);})().catch(e=>{if(live&&ok())tell(e.message);});return()=>{live=false;};
 },[url,article,w.revision,w.signedIn,w.organizationId,w.capture,w.request]);
 async function save(d:Record<string,unknown>){const ok=w.capture();lock(true);tell('');try{const v=await w.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const next=await w.request(url);if(ok()){if(v.taskId)setTask(v.taskId);setData(next);tell(v.taskId?'Routed to the guide owner.':'Guide owner and review date saved.');}}catch(e){if(ok())tell(e instanceof Error?e.message:'Could not save.');}finally{if(ok())lock(false);}}
 if(!w.signedIn||!data)return msg?<p role="status">{msg}</p>:null;
 const row=data.guides.find(g=>g.id===article);
 return <section className={ui.card}>{row?<><h2>Help with this guide</h2><p>{row.owner?'Guide owner '+row.owner.email:'No named guide owner'}{row.reviewDate?' · Review due '+row.reviewDate:''}</p>
 {row.owner&&<form onSubmit={e=>{e.preventDefault();void save({action:'ESCALATE',guide:article,issue:new FormData(e.currentTarget).get('issue'),requestKey:crypto.randomUUID()});}}><label>Where are you stuck?<select name="issue"><option value="FAILED_CONNECTION">A connection failed</option><option value="MISSING_SOURCE">I cannot find the source</option><option value="ACCESS">I cannot access the workspace</option><option value="OTHER">Another step</option></select></label><button disabled={busy||!!task}>Send a task to the guide owner</button></form>}
 {task&&<a href={'/team/work?'+new URLSearchParams({organizationId:w.organizationId,taskId:task})}>Open support task</a>}
 {data.canManage&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({action:'ASSIGN',guide:article,ownerId:f.get('owner'),reviewDate:f.get('due')});}}><label>Responsible team member<select name="owner" required defaultValue={row.owner?.id||''}><option value="">Choose owner</option>{data.members.map(m=><option key={m.id} value={m.id}>{m.email}</option>)}</select></label><label>Next content review<input required type="date" name="due" defaultValue={row.reviewDate||''}/></label><button disabled={busy}>Save guide ownership</button></form>}</>:data.canManage?<><h2>Guide use in the last 30 days</h2>{data.guides.filter(g=>g.readerDays>0).slice(0,5).map(g=><p key={g.id}><a href={'#'+g.id}>{g.title}</a> · {g.readerDays} reader-days · {g.owner?.email||'owner needed'}</p>)}</>:null}{msg&&<p role="status">{msg}</p>}</section>;
}
