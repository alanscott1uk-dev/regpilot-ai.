"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {browserAuth} from './supabase-auth';
import {workUuid} from '../work-hub.mjs';

export type WorkspaceOrganization={id:string;name:string;role:string};
type Context={organisations:WorkspaceOrganization[];organizationId:string;userId:string;email:string;loading:boolean;error:string;revision:number};
const empty:Context={organisations:[],organizationId:'',userId:'',email:'',loading:true,error:'',revision:0};

export function workspaceHref(path:string,organizationId:string,values:Record<string,string>={}){
 const hash=path.indexOf('#'),fragment=hash<0?'':path.slice(hash);
 const [pathname,query='']=(hash<0?path:path.slice(0,hash)).split('?');
 const params=new URLSearchParams(query);
 if(organizationId)params.set('organizationId',organizationId);
 for(const [key,value] of Object.entries(values))if(value)params.set(key,value);
 return pathname+(params.size?'?'+params.toString():'')+fragment;
}
function recordOrganization(id:string,clearLinkedRecords=false){
 const url=new URL(window.location.href);
 if(id)url.searchParams.set('organizationId',id);else url.searchParams.delete('organizationId');
 if(clearLinkedRecords)for(const key of ['trialId','monitorProduct','taskId','sourceId','snapshotId','assessmentId','importId','evidenceId','programmeId','riskId','systemId','questionnaireId','questionId','answerId','productId','caseId','indexId','searchId','curriculumId','trainingId','credentialId','observationId','policyId','releaseId','challengeId','endpointId','deliveryId','runId','ocrRunId','ocrReviewId','watchlistId'])url.searchParams.delete(key);
 window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
 window.dispatchEvent(new Event('regpilot-workspace-navigation'));
}

/** One account and organisation boundary for the connected customer journey.
 * A link to an unavailable organisation never falls back to another tenant.
 * Every request is checked again after token lookup and response parsing.
 */
export function useWorkspaceContext(){
 const [context,setContext]=useState<Context>(empty);
 const current=useRef({...empty,externalId:''}),mounted=useRef(false),sequence=useRef(0);
 const publish=useCallback((changes:Partial<Context>,invalidate=false)=>{
  current.current={...current.current,...changes,revision:current.current.revision+(invalidate?1:0)};
  if(mounted.current)setContext({...current.current});
 },[]);
 const refreshContext=useCallback(async(preferredId?:string)=>{
  const serial=++sequence.current;
  const isCurrent=()=>mounted.current&&sequence.current===serial;
  try{
   const session=(await browserAuth().auth.getSession()).data.session;
   if(!isCurrent())return false;
   if(!session){current.current.externalId='';publish({...empty,loading:false},true);return false;}
   if(current.current.externalId!==session.user.id){current.current.externalId=session.user.id;publish({...empty,loading:true},true);}
   const response=await fetch('/api/ai/context',{cache:'no-store',headers:{authorization:'Bearer '+session.access_token}});
   const body=await response.json();if(!isCurrent())return false;
   if(!response.ok)throw new Error(body.error||'Your workspace could not be loaded.');
   const organisations:WorkspaceOrganization[]=Array.isArray(body.organisations)?body.organisations:[];
   const requested=preferredId??new URLSearchParams(window.location.search).get('organizationId');
   const id=requested?.toLowerCase();
   const unavailable=requested!==null&&requested!==undefined&&(!workUuid(requested)||!organisations.some(o=>o.id===id));
   const organizationId=unavailable?'':id||(organisations.some(o=>o.id===current.current.organizationId)?current.current.organizationId:organisations[0]?.id||'');
   const membershipChanged=organisations.length!==current.current.organisations.length||organisations.some(org=>current.current.organisations.find(previous=>previous.id===org.id)?.role!==org.role);
   const changed=current.current.organizationId!==organizationId||current.current.userId!==(body.userId||'')||membershipChanged;
   publish({organisations,organizationId,userId:body.userId||'',email:body.email||session.user.email||'',loading:false,error:unavailable?'The linked organisation is unavailable for this account. Choose an organisation to continue.':''},changed);
   if(organizationId)recordOrganization(organizationId);
   return true;
  }catch(error){if(isCurrent())publish({...empty,loading:false,error:error instanceof Error?error.message:'Your workspace could not be loaded.'},true);return false;}
 },[publish]);
 useEffect(()=>{
  mounted.current=true;let unsubscribe=()=>{};
  try{
   const subscription=browserAuth().auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'||(current.current.externalId&&session?.user.id!==current.current.externalId)){
     sequence.current++;current.current.externalId=session?.user.id||'';publish({...empty,loading:event!=='SIGNED_OUT'},true);
    }
    if(event!=='SIGNED_OUT')setTimeout(()=>{if(mounted.current)void refreshContext();},0);
   });
   unsubscribe=()=>subscription.data.subscription.unsubscribe();void refreshContext();
  }catch{publish({...empty,loading:false,error:'Private workspace sign-in is not configured in this environment.'},true);}
  return()=>{mounted.current=false;sequence.current++;current.current.revision++;unsubscribe();};
 },[publish,refreshContext]);
 const chooseOrganization=useCallback((id:string)=>{
  if(!current.current.organisations.some(o=>o.id===id))return;
  sequence.current++;recordOrganization(id,true);publish({organizationId:id,error:'',loading:false},true);
 },[publish]);
 const capture=useCallback(()=>{
  const revision=current.current.revision;
  return ()=>mounted.current&&revision===current.current.revision;
 },[]);
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const valid=()=>mounted.current&&revision===current.current.revision;
  const revision=current.current.revision,externalId=current.current.externalId;
  const session=(await browserAuth().auth.getSession()).data.session;
  if(!valid()||session?.user.id!==externalId)throw new Error('Your account or organisation changed. Reload before continuing.');
  if(!session)throw new Error('Sign in to your private workspace first.');
  const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,authorization:'Bearer '+session.access_token}});
  const body=await response.json();
  if(!valid())throw new Error('Your account or organisation changed. Reload before continuing.');
  if(!response.ok)throw new Error(body.error||'The request could not be completed.');
  return body;
 },[]);
 /** Binary and streaming readers retain the same account boundary as JSON reads.
  * Callers must also check capture() after consuming the response body.
  */
 const requestResponse=useCallback(async(path:string,options:RequestInit={})=>{
  const revision=current.current.revision,externalId=current.current.externalId;
  const valid=()=>mounted.current&&revision===current.current.revision&&externalId===current.current.externalId;
  const session=(await browserAuth().auth.getSession()).data.session;
  if(!valid()||session?.user.id!==externalId)throw new Error('Your account or organisation changed. Reload before continuing.');
  if(!session)throw new Error('Sign in to your private workspace first.');
  const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,authorization:'Bearer '+session.access_token}});
  if(!valid())throw new Error('Your account or organisation changed. Reload before continuing.');
  if(!response.ok){
   const body=await response.json().catch(()=>({error:'The request could not be completed.'}));
   if(!valid())throw new Error('Your account or organisation changed. Reload before continuing.');
   throw new Error(body.error||'The request could not be completed.');
  }
  return response;
 },[]);
 return {...context,signedIn:!!context.email,chooseOrganization,refreshContext,capture,request,requestResponse};
}
