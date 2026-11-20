"use client";
import {useEffect,useRef,useState} from "react";
import {browserAuth} from "../../../lib/client/supabase-auth";
import {awsRegions,awsRoleTemplate} from "../../../lib/connectors/aws-target";
import ui from "./operations.module.css";

export function AwsFields({organizationId,broker,accountId,region}:{organizationId:string;broker?:string|null;accountId?:string;region?:string}){
  function download(){
    if(!broker)return;
    const file=new Blob([JSON.stringify(awsRoleTemplate(organizationId,broker),null,2)+"\n"],{type:"application/json"});
    const href=URL.createObjectURL(file),link=document.createElement("a");
    link.href=href;link.download="regpilot-aws-evidence-role.json";link.click();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  return <>
    <label>AWS account ID<input name="accountId" defaultValue={accountId} required inputMode="numeric" pattern="[0-9]{12}" maxLength={12} placeholder="12-digit account number"/></label>
    <label>AWS region<select name="region" defaultValue={region??"eu-west-2"}>{Object.entries(awsRegions).map(([id,city])=><option key={id} value={id}>{city} ({id})</option>)}</select></label>
    {broker&&<div className={ui.full}><button type="button" onClick={download}>Download AWS role template</button>
      <p className={ui.hint}>Give this CloudFormation file to your AWS administrator to review and apply in the selected account. It grants this workspace four read permissions.</p></div>}
  </>;
}

type Candidate={lei:string;name:string};
export function GleifFields({organizationId,active,savedNumber,savedLei}:{organizationId:string;active:boolean;savedNumber?:string;savedLei?:string}){
  const [number,setNumber]=useState(savedNumber??""),[lei,setLei]=useState(savedLei??""),[rows,setRows]=useState<Candidate[]>([]);
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[organizationId]);
  function changeNumber(value:string){
    pending.current?.abort();setBusy(false);setNumber(value.toUpperCase());setLei("");setRows([]);setMessage("");
  }
  async function lookup(){
    pending.current?.abort();
    const controller=new AbortController();pending.current=controller;
    setBusy(true);setRows([]);setMessage("");
    try{
      const token=(await browserAuth().auth.getSession()).data.session?.access_token;
      if(!token)throw new Error("Sign in to this workspace again.");
      const params=new URLSearchParams({organizationId,companyNumber:number});
      const res=await fetch("/api/workspace/connectors/gleif?"+params,{headers:{authorization:"Bearer "+token},cache:"no-store",signal:controller.signal});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"Could not reach GLEIF.");
      if(controller.signal.aborted)return;
      setRows(data.candidates);
      setMessage((data.candidates.length?"Choose the matching legal entity below.":"No exact UK match found in the returned records.")+(data.more?" Only the first 25 results were checked. You can enter a known LEI below.":""));
    }catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:"Lookup unavailable.");}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <>
    <label>Companies House number<input name="companyNumber" value={number} onChange={e=>changeNumber(e.target.value)} required pattern="([0-9]{8}|[A-Z]{2}[0-9]{6})" maxLength={8} placeholder="SC045551"/></label>
    <div><button type="button" disabled={!active||busy||!/^(?:\d{8}|[A-Z]{2}\d{6})$/.test(number)} onClick={()=>void lookup()}>Find matching LEIs</button><p role="status">{busy?"Searching GLEIF…":message}</p></div>
    {rows.length>0&&<label>Matching legal entity<select value={rows.some(row=>row.lei===lei)?lei:""} onChange={e=>setLei(e.target.value)}>
      <option value="">Choose a legal entity</option>{rows.map(row=><option key={row.lei} value={row.lei}>{row.name} · {row.lei}</option>)}</select></label>}
    <label>Legal entity identifier (LEI)<input name="lei" value={lei} onChange={e=>setLei(e.target.value.toUpperCase())} required pattern="[A-Z0-9]{18}[0-9]{2}" maxLength={20}/></label>
  </>;
}
