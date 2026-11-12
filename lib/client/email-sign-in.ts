"use client";
import {browserAuth} from './supabase-auth';
import {authProblem,cooldownSeconds,signInDestination} from '../auth-flow.mjs';
const key='regpilot.sign-in.cooldown.v1';
let until=0,pending=false;
export function signInWait(){
 try{until=Math.max(until,Number(localStorage.getItem(key))||0);}catch{}
 return cooldownSeconds(until);
}
function pause(seconds:number){
 until=Date.now()+seconds*1000;
 try{localStorage.setItem(key,String(until));}catch{}
 window.dispatchEvent(new Event('regpilot-sign-in-cooldown'));
}
export async function requestSignIn(email:string,path:string){
 if(pending||signInWait()>0)return {ok:false,message:'Please wait before requesting another link. Check your inbox and junk folder for the latest email.'};
 pending=true;
 // Reserve the resend interval before the network call, including across page reloads.
 pause(60);
 try{
  const {error}=await browserAuth().auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:window.location.origin+signInDestination(path)}});
  if(error){const problem=authProblem(error);if(problem.seconds)pause(problem.seconds);return {ok:false,message:problem.message};}
  return {ok:true,message:'Sign-in link requested. Check your inbox and junk folder. Open the latest email in this same browser and on this same device.'};
 }catch(error){return {ok:false,message:authProblem(error).message};}
 finally{pending=false;}
}
