'use client';
import {useCallback,useEffect,useState} from 'react';
import type {useWorkspaceContext} from '../../../lib/client/workspace-context';
import type {operatorReceiptOptions} from '../../../lib/server/capability-trial-service';

type Page=Awaited<ReturnType<typeof operatorReceiptOptions>>;
export function useTrialReadings(w:ReturnType<typeof useWorkspaceContext>,id:string,stopped:boolean){
 const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const {request,capture,organizationId}=w;
 const url='/api/workspace/trials/'+id+'/readings?'+new URLSearchParams({organizationId});
 const load=useCallback(async(before?:string)=>{
  const valid=capture();setBusy(true);setError('');
  try{
   const data:Page=await request(url+(before?'&before='+encodeURIComponent(before):''));
   if(valid()){setPage(prev=>({...data,options:before?[...(prev?.options??[]),...data.options]:data.options}));}
  }catch(e){if(valid())setError(e instanceof Error?e.message:'Could not load readings.');}
  finally{if(valid())setBusy(false);}
 },[url,request,capture]);
 useEffect(()=>{if(stopped)void load();},[load,stopped]);
 return {page,error,busy,load};
}
type Readings=ReturnType<typeof useTrialReadings>;
export function ReadingControls({readings}:{readings:Readings}){
 const {busy,load,page,error}=readings;
 return <><button type="button" disabled={busy} onClick={()=>void load()}>{page?'Refresh readings':'Find eligible readings'}</button>{page?.next&&<button type="button" disabled={busy} onClick={()=>void load(page.next!)}>Earlier readings</button>}{error&&<p role="alert">{error}</p>}</>;
}
export default function ReadingPicker({page,step}:{page:Page|null;step:string}){
 const [selected,choose]=useState<string|null>(null);
 const choices=page?.options.filter(x=>x.steps.includes(step))??[];
 const automatic=choices.length===1&&!page?.next?choices[0].id:'';
 return <><label>Verified collection for this task<select name={step+'-run'} value={selected??automatic} onChange={e=>choose(e.target.value)}>
  <option value="">Choose a reading</option>{choices.map(x=><option key={x.id} value={x.id}>{x.provider} · {x.at} · {x.id.slice(0,8)}</option>)}</select></label>
 {page&&!choices.length&&<p>No eligible collection on this page. Complete the task and refresh readings.</p>}
 </>;
}
