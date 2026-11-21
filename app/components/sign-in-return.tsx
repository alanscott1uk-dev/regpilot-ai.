"use client";
import {useEffect,useState} from 'react';
import {completeSignInReturn} from '../../lib/client/supabase-auth';
import styles from './email-sign-in.module.css';
export default function SignInReturn(){
 const [state,setState]=useState<{ok:boolean;message:string;destination:string}|null>(null);
 useEffect(()=>{
  let alive=true;const result=completeSignInReturn();if(!result)return;
  setState({ok:false,message:'Checking your sign-in link…',destination:''});
  void result.then(next=>{
   if(!alive)return;setState(next);
   // A same-site demo landing page must not silently swallow a valid callback.
   if(next.ok&&window.location.pathname!==next.destination)window.location.replace(next.destination);
  });
  return()=>{alive=false;};
 },[]);
 if(!state)return null;
 return <section className={styles.return} role="status" aria-label="Sign-in result">
  <h2>{state.destination?(state.ok?'Sign-in verified':'Sign-in needs attention'):'Checking sign-in'}</h2><p>{state.message}</p>
  {state.destination&&<a href={state.destination}>{state.ok?'Continue to your workspace':'Return to private sign-in'} →</a>}
  {!state.ok&&state.destination&&<small>A demonstration page does not confirm that you are signed in. Do not share your email sign-in link or verification codes.</small>}
 </section>;
}
