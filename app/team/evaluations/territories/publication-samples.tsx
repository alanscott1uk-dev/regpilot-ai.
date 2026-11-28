'use client';
import {useEffect,useState} from 'react';
import {PUBLISHERS} from '../../../../lib/horizon/model';
import type {useWorkspaceContext} from '../../../../lib/client/workspace-context';
import type {publicationSamples} from '../../../../lib/server/publication-sample';

type Data=Awaited<ReturnType<typeof publicationSamples>>;
export default function Samples({w}:{w:ReturnType<typeof useWorkspaceContext>}){
 const [data,setData]=useState<Data|null>(null),[busy,lock]=useState(false),[error,tell]=useState('');
 const url='/api/workspace/publication-samples?'+new URLSearchParams({organizationId:w.organizationId});
 useEffect(()=>{const current=w.capture();void w.request(url).then(d=>{if(current())setData(d);}).catch(e=>{if(current())tell(e.message);});},[url,w.capture,w.request]);
 async function save(body:unknown){
  const current=w.capture();lock(true);tell('');
  try{await w.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const next=await w.request(url);if(current())setData(next);}
  catch(e){if(current())tell(e instanceof Error?e.message:'Unable to update the sample.');}finally{if(current())lock(false);}
 }
 return <section aria-label="Publication coverage samples"><h2>Did the feed pick up known publications?</h2>
 <p>Build a dated sample from the publisher’s own list. A second administrator checks the source links before comparing them with a specific feed snapshot.</p>
 {data?.canSeal&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);
  const entries=String(f.get('entries')).trim().split(/\r?\n/).map(line=>{const [on,url]=line.trim().split(/\s+/);return {on,url};});
  void save({action:'SEAL',id:crypto.randomUUID(),sample:{title:f.get('title'),publisher:f.get('publisher'),method:f.get('method'),entries}});
 }}><fieldset disabled={busy}><legend>Seal an external reference list</legend>
 <label>Sample name<input name="title" required minLength={5} maxLength={120}/></label>
 <label>Publisher<select name="publisher">{PUBLISHERS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>How were these records selected?<textarea name="method" required minLength={20} maxLength={500}/></label>
 <label>Publication date and official URL, one record per line<textarea required name="entries" rows={4} maxLength={20000} placeholder="YYYY-MM-DD https://…"/></label>
 <button>Seal sample</button></fieldset></form>}
 {error&&<p role="alert">{error}</p>}{data?.samples.map(s=><article key={s.id}><h3>{s.sample.title}</h3><p>{s.sample.method} · {s.sample.entries.length} source records</p>
 <details><summary>Check sampled publications</summary><ul>{s.sample.entries.map(e=><li key={e.url}>{e.on} · <a href={e.url} target="_blank" rel="noreferrer">{e.url}</a></li>)}</ul></details>
 {s.canScore&&<form onSubmit={e=>{e.preventDefault();void save({action:'SCORE',id:s.id,confirmed:true});}}><label><input type="checkbox" required/>I checked the dates, original publisher list and the selected source links.</label><button disabled={busy}>Score this sealed sample</button></form>}
 {s.result?<><p>Snapshot {s.result.generatedAt} · {s.result.found} found under the expected publisher · {s.result.wrongPublisher} found under another publisher · {s.result.missing} missing from {s.result.measurable} measurable records · {s.result.indeterminate} indeterminate.</p>
 <ul>{s.result.rows.filter(r=>r.outcome!=='FOUND').map(r=><li key={r.url}><a href={r.url}>{r.on} · {r.url}</a> · {r.outcome.replaceAll('_',' ').toLowerCase()} {r.reason}</li>)}</ul></>:<p>Awaiting an independent assessment.</p>}</article>)}</section>;
}
