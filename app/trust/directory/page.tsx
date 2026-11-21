'use client';
import {useEffect,useRef,useState} from 'react';
import EmailSignIn from '../../components/email-sign-in';
import {auditRequest} from '../../team/audits/audit-session';
import shell from '../../workbench/workbench.module.css';
import ui from '../../sop-builder/sop.module.css';

type Claim={id:string;title:string;summary:string;revision:number;expiresAt:string};
export default function Directory(){
 const [query,setQuery]=useState(''),[claims,setClaims]=useState<Claim[]>([]),[message,tell]=useState(''),[busy,lock]=useState(false),[signIn,setSignIn]=useState('');const generation=useRef(0);
 async function find(params:URLSearchParams){
  const n=++generation.current;lock(true);tell('');setClaims([]);setSignIn('');
  try{const r=await fetch('/api/trust/directory?'+params,{cache:'no-store'});if(!r.ok)throw Error('The trust directory is unavailable.');const v=await r.json();if(n===generation.current){setClaims(v.summaries);if(!v.summaries.length)tell('No current public summary matches this search.');}}
  catch(e){if(n===generation.current)tell(e instanceof Error?e.message:'Search unavailable.');}finally{if(n===generation.current)lock(false);}
 }
 useEffect(()=>{const id=new URLSearchParams(location.search).get('id');if(id)void find(new URLSearchParams({id}));return()=>{generation.current++;};},[]);
 async function request(claim:Claim){
  lock(true);tell('');setSignIn('');
  try{const v=await auditRequest('/api/trust/directory/'+claim.id,{revision:claim.revision});tell(v.status==='REQUESTED'?'Your request is with the room owner.':v.status==='PENDING'||v.status==='ACCEPTED'?'Your named invitation is available under Shared with me.':'Request status: '+v.status);}
  catch(e){const msg=e instanceof Error?e.message:'Request unavailable.';tell(msg);if(/sign in|sign-in|session|configured/i.test(msg))setSignIn(claim.id);}finally{lock(false);}
 }
 return <main className={shell.main}><div className={ui.body}><header className={ui.intro}><div><h1>Public trust directory</h1><p>Find a company’s published assurance summary and request its supporting evidence.</p><a href="/trust">Shared with me</a></div></header>
 <form className={ui.card} onSubmit={e=>{e.preventDefault();void find(new URLSearchParams({q:query}));}}><label>Company or publication title<input required minLength={3} maxLength={100} value={query} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy}>Search public summaries</button></form>
 {claims.map(c=><article key={c.id} className={ui.card}><h2>{c.title}</h2><p>{c.summary}</p><p>Revision {c.revision} · Expires {new Date(c.expiresAt).toLocaleDateString('en-GB')}</p><button disabled={busy} onClick={()=>void request(c)}>Request access to the evidence</button></article>)}
 {message&&<p role="status">{message}</p>}{signIn&&<EmailSignIn destination={'/trust/directory?id='+signIn}/>}</div></main>;
}
