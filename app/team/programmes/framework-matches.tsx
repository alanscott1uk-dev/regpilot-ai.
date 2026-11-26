'use client';
import {useEffect,useState} from 'react';
import {workspaceHref} from '../../../lib/client/workspace-context';
export function FrameworkMatches({query,organisation}:{query:string;organisation:string}){
 const clean=query.trim().slice(0,150);
 const [state,setState]=useState<{q:string;rows:{id:string;name:string}[];total:number}|null>(null);
 useEffect(()=>{
  if(!clean)return;
  const abort=new AbortController(),timer=setTimeout(async()=>{
   try{
    const response=await fetch('/api/audit-programmes/frameworks?'+new URLSearchParams({q:clean}),{signal:abort.signal});
    if(response.ok){const result=await response.json();if(!abort.signal.aborted)setState({q:clean,...result});}
   }catch{}
  },180);
  return()=>{clearTimeout(timer);abort.abort();};
 },[clean]);
 if(!clean)return null;
 const found=state?.q===clean?state:null;
 return <div>{!!found?.total&&<><h3>Matching framework audits</h3><ul>{found.rows.map(v=><li key={v.id}><a href={workspaceHref('/team/programmes/frameworks',organisation,{framework:v.id})}>{v.name}</a></li>)}</ul></>}
  <a href={'/audit-programmes/frameworks?'+new URLSearchParams({q:clean})}>Search the full framework catalogue</a></div>;
}
