"use client";
import {useCallback,useEffect,useRef,useState} from "react";

type Source={id:string;agency:string;topic:string;title:string;url:string;updatedAt:string|null;revisionAt?:string|null;description:string;status:string};
type Response={checkedAt:string;results:Source[];disclaimer:string};
type Snapshot=Record<string,string>;
const SNAPSHOT_KEY="regpilot-source-snapshots-v1";
function marker(x:Source){return x.revisionAt||x.updatedAt||"";}
function readSnapshot():Snapshot{
 try{const parsed:unknown=JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||"{}");if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return Object.fromEntries(Object.entries(parsed).filter(([,v])=>typeof v==="string")) as Snapshot;}catch{}
 return {};
}
export default function RegulatorySources(){
 const [data,setData]=useState<Response|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [changed,setChanged]=useState<string[]>([]);
 const [baseline,setBaseline]=useState(false);
 const busy=useRef(false);
 const refresh=useCallback(async()=>{
  if(busy.current)return;
  busy.current=true;setLoading(true);setError("");
  try{
   const r=await fetch("/api/regulatory-sources",{cache:"no-store"});
   if(!r.ok)throw new Error("Source service unavailable");
   const response:Response=await r.json();
   if(!response||!Array.isArray(response.results))throw new Error("Invalid source response");
   const previous=readSnapshot();
   const next={...previous};
   const modifications:string[]=[];
   for(const source of response.results){
     if(source.status!=="available"||!marker(source))continue;
     const version=marker(source);
     if(previous[source.id]&&previous[source.id]!==version)modifications.push(source.id);
     next[source.id]=version;
   }
   try{localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(next));}catch{}
   setBaseline(Object.keys(previous).length===0);
   setChanged(modifications);
   setData(response);
  }catch{setError("Could not retrieve the official sources. Previous information may be stale.");}
  finally{setLoading(false);busy.current=false;}
 },[]);
 useEffect(()=>{
   void refresh();
   const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh()},15*60*1000);
   const onVisible=()=>{if(document.visibilityState==="visible")void refresh()};
   document.addEventListener("visibilitychange",onVisible);
   return ()=>{clearInterval(timer);document.removeEventListener("visibilitychange",onVisible)};
 },[refresh]);
 return <main style={{maxWidth:940,margin:"auto",padding:"24px 16px 60px",fontFamily:"Arial,sans-serif",color:"#17253b",lineHeight:1.5}}>
  <a href="/" style={{color:"#3159df",fontSize:13}}>← Compliance dashboard</a>
  <p style={{fontSize:12,color:"#3159df",fontWeight:800,letterSpacing:1.5,marginTop:30}}>REGPILOT AI / LIVE PUBLIC SOURCES</p>
  <h1 style={{fontSize:"clamp(27px,5vw,38px)",letterSpacing:-1,margin:"6px 0"}}>MHRA & Home Office updates</h1>
  <p style={{color:"#64748b"}}>Direct links to official GOV.UK publications, refreshed when you open this page and approximately every 15 minutes while it stays open.</p>
  <div style={{background:"#fff8e8",border:"1px solid #e8cf95",borderRadius:12,padding:14,fontSize:13,margin:"20px 0"}}>
   Updates are based on GOV.UK publication metadata, not verified changes in legal obligations. Comparisons use this browser's previous successful checks only. No background server monitoring or licensing-portal access is active.
  </div>
  <button type="button" disabled={loading} onClick={()=>void refresh()} style={{border:0,background:"#3159df",color:"white",borderRadius:9,padding:"11px 17px",fontWeight:700,cursor:"pointer"}}>{loading?"Checking official sources…":"Check for updates now"}</button>
  {error&&<p role="alert" style={{color:"#b45309"}}>{error}</p>}
  {data&&<><p role="status" style={{fontSize:13,color:"#475569"}}>
   Last checked: {new Date(data.checkedAt).toLocaleString()} · {changed.length?changed.length+" source(s) changed since the previous successful check":baseline?"First successful check — monitoring baseline saved":"No publication metadata changes detected since the previous check"}
  </p>
  <section style={{display:"grid",gap:12,marginTop:18}}>{data.results.map(x=><article key={x.id} style={{background:"white",border:"1px solid "+(changed.includes(x.id)?"#e8b45c":"#e1e7f0"),borderRadius:14,padding:18}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
    <span style={{fontSize:11,fontWeight:800,color:"#3159df"}}>{x.agency} · {x.topic}</span>
    <span style={{fontSize:11,fontWeight:700,color:changed.includes(x.id)?"#a15c10":x.status==="available"?"#24744a":"#a14b30"}}>{changed.includes(x.id)?"Publication metadata changed — review":x.status==="available"?"Source available":"Source unavailable"}</span>
   </div>
   <h2 style={{fontSize:19,margin:"7px 0"}}>{x.title}</h2>
   <p style={{fontSize:13,color:"#64748b"}}>{x.description||"Open the official page for full details."}</p>
   <p style={{fontSize:12,color:"#64748b"}}>Public update: {x.updatedAt?new Date(x.updatedAt).toLocaleDateString("en-GB"):"Not available"}</p>
   <a href={x.url} target="_blank" rel="noopener noreferrer" style={{color:"#3159df",fontSize:13,fontWeight:700}}>Open official {x.agency} guidance ↗</a>
  </article>)}</section></>}
 </main>;
}
