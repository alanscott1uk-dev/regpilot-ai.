"use client";
import {useEffect,useRef,useState} from 'react';
import {requestSignIn,signInWait} from '../../lib/client/email-sign-in';
import styles from './email-sign-in.module.css';
export default function EmailSignIn({destination='/team',disabled=false}:{destination?:string;disabled?:boolean}){
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[wait,setWait]=useState(0),[message,setMessage]=useState('');
 const mounted=useRef(false),sending=useRef(false);
 useEffect(()=>{
  mounted.current=true;const update=()=>setWait(signInWait());update();
  const timer=window.setInterval(update,1000);
  window.addEventListener('storage',update);window.addEventListener('regpilot-sign-in-cooldown',update);
  return()=>{mounted.current=false;window.clearInterval(timer);window.removeEventListener('storage',update);window.removeEventListener('regpilot-sign-in-cooldown',update);};
 },[]);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(sending.current||disabled||signInWait()>0)return;
  sending.current=true;setBusy(true);setMessage('');
  try{const result=await requestSignIn(email,destination);if(mounted.current)setMessage(result.message);}
  finally{sending.current=false;if(mounted.current){setBusy(false);setWait(signInWait());}}
 }
 return <form className={styles.form} onSubmit={submit} aria-label="Email sign-in">
  <label>Email sign-in<input type="email" autoComplete="email" required maxLength={254} placeholder="you@company.co.uk" value={email} disabled={busy||disabled} onChange={e=>setEmail(e.target.value)}/></label>
  <button disabled={busy||disabled||wait>0}>{busy?'Requesting link…':wait>0?`Request again in ${Math.floor(wait/60)}:${String(wait%60).padStart(2,'0')}`:'Send secure link'}</button>
  {message&&<p className={styles.notice} role="status">{message}</p>}
  <p className={styles.hint}>Use your approved pilot email. On your phone, request and open the link in the same browser, such as Chrome, rather than switching between an app’s browser and Chrome.</p>
  {wait>0&&<p className={styles.hint}>This countdown limits retries; email availability is controlled by the sign-in service and may take longer to recover.</p>}
 </form>;
}
