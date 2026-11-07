"use client";
import {useEffect,useRef,useState} from "react";
import {auditRequest} from "./audits/audit-session";
export const day=(offset=0)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
export function useRecordWorkspace<T,D>(resource:"policies"|"vendors",orgId:string){
 const [data,setData]=useState<T|null>(null),[detail,setDetail]=useState<D|null>(null),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const alive=useRef(true),lock=useRef(false),epoch=useRef(0),selection=useRef("");
 const base="/api/workspace/"+resource,query="?organizationId="+encodeURIComponent(orgId);
 async function refresh(){const value=await auditRequest(base+query);if(alive.current)setData(value);}
 useEffect(()=>{alive.current=true;void refresh().catch(e=>{if(alive.current)setNotice(e.message);});return()=>{alive.current=false;epoch.current++;};},[orgId,resource]);
 async function open(id:string,extraQuery=""){
  const gen=++epoch.current;selection.current=id;setSelected(id);setDetail(null);setNotice("");
  try{const value=await auditRequest(base+"/"+id+query+extraQuery);if(alive.current&&gen===epoch.current)setDetail(value);}catch(e){if(alive.current&&gen===epoch.current)setNotice(e instanceof Error?e.message:"Could not load this record");}
 }
 async function mutate(body:Record<string,unknown>,kind:"create"|"change"|"review"="change"){
  if(lock.current)return;lock.current=true;setBusy(true);setNotice("");const id=selection.current;
  try{
   const value=await auditRequest(base+(kind==="create"?"":"/"+id)+(kind==="review"?"/reviews":"")+query,body,kind==="change"?"PATCH":"POST");
   if(!alive.current)return;await refresh();if(!alive.current)return;
   if(kind==="create"||selection.current===id){await open(kind==="create"?value.id:id);if(alive.current)setNotice("Saved. The history records this change.");}
  }catch(e){if(alive.current)setNotice(e instanceof Error?e.message:"Could not save");}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return {data,detail,selected,busy,notice,open,mutate};
}
