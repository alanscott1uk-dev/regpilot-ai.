"use client";
import {useEffect,useState} from "react";
type Source={id:string;agency:string;topic:string;title:string;url:string;updatedAt:string|null;description:string;status:string};
type Response={checkedAt:string;results:Source[];disclaimer:string};
export default function RegulatorySources(){
 const [data,setData]=useState<Response|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 async function refresh(){
  setLoading(true);setError("");
  try{const r=await fetch("/api/regulatory-sources",{cache:"no-store"});if(!r.ok)throw new Error("Source service unavailable");setData(await r.json());}
  catch{setError("Could not retrieve regulatory sources. Try again later.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{void refresh()},[]);
 return <main style={{maxWidth:940,margin:"auto",padding:"24px 16px 60px",fontFamily:"Arial,sans-serif",color:"#17253b",lineHeight:1.5}}>
  <a href="/" style={{color:"#3159df",fontSize:13}}>← Compliance dashboard</a>
  <p style={{fontSize:12,color:"#3159df",fontWeight:800,letterSpacing:1.5,marginTop:30}}>REGPILOT AI / REGULATORY SOURCES</p>
  <h1 style={{fontSize:"clamp(27px,5vw,38px)",letterSpacing:-1,margin:"6px 0"}}>Official regulatory sources</h1>
  <p style={{color:"#64748b"}}>Publication metadata retrieved from GOV.UK. This is a source directory, not a live compliance verdict.</p>
  <div style={{background:"#fff8e8",border:"1px solid #e8cf95",borderRadius:12,padding:14,fontSize:13,margin:"20px 0"}}>No automatic regulatory-change detection or AI assessment is active. Publication dates are not necessarily the dates of legally significant changes. Always verify the original guidance.</div>
  <button type="button" disabled={loading} onClick={()=>void refresh()} style={{border:0,background:"#3159df",color:"white",borderRadius:9,padding:"11px 17px",fontWeight:700,cursor:"pointer"}}>{loading?"Checking…":"Refresh sources"}</button>
  {error&&<p role="alert">{error}</p>}
  {data&&<><p style={{fontSize:12,color:"#64748b"}}>Last checked: {new Date(data.checkedAt).toLocaleString()}</p><section style={{display:"grid",gap:12,marginTop:18}}>{data.results.map(x=><article key={x.id} style={{background:"white",border:"1px solid #e1e7f0",borderRadius:14,padding:18}}>
   <div style={{fontSize:11,fontWeight:800,color:"#3159df"}}>{x.agency} · {x.topic}</div>
   <h2 style={{fontSize:19,margin:"7px 0"}}>{x.title}</h2>
   <p style={{fontSize:13,color:"#64748b"}}>{x.description||"Open the official page for full details."}</p>
   <p style={{fontSize:12,color:x.status==="available"?"#24744a":"#a14b30"}}>{x.status==="available"?"Metadata retrieved":"Source temporarily unavailable"} · Published update: {x.updatedAt?new Date(x.updatedAt).toLocaleDateString("en-GB"):"Not available"}</p>
   <a href={x.url} target="_blank" rel="noopener noreferrer" style={{color:"#3159df",fontSize:13,fontWeight:700}}>View official GOV.UK source ↗</a>
  </article>)}</section></>}
 </main>;
}
