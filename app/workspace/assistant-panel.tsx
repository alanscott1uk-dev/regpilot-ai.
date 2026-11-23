"use client";
import {useState} from "react";
import {stagingSupabase} from "../../lib/staging-supabase";
export default function AssistantPanel({organizationId}:{organizationId:string}){
 const [question,setQuestion]=useState(""),[answer,setAnswer]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function ask(e:React.FormEvent){e.preventDefault();if(busy||question.trim().length<3)return;
 setBusy(true);setError("");setAnswer("");
 try{
 const {data:{session}}=await stagingSupabase().auth.getSession();
 if(!session?.access_token)throw new Error("Please sign in again.");
 const response=await fetch("/api/assistant",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({organizationId,question:question.trim()})});
 const data=await response.json() as {answer?:string;error?:string};
 if(!response.ok)throw new Error(data.error||"The assistant is unavailable.");
 setAnswer(data.answer??"");
 }catch(e){setError(e instanceof Error?e.message:"Unable to answer right now.");}finally{setBusy(false);}
 }
 return <section style={{border:"1px solid #dbe3ee",borderRadius:16,padding:16,background:"#fff",display:"grid",gap:12}}>
 <h2 style={{margin:0,fontSize:20}}>Ask EAGNEXIS</h2>
 <p style={{margin:0,fontSize:14,color:"#475569"}}>Ask a question in plain English. This early assistant gives general UK compliance guidance; it cannot check your documents or confirm legal compliance.</p>
 <form onSubmit={e=>void ask(e)} style={{display:"grid",gap:10}}>
 <label htmlFor="eagnexis-question" style={{fontWeight:600,fontSize:14}}>What would you like help with?</label>
 <textarea id="eagnexis-question" value={question} maxLength={1200} rows={3} onChange={e=>setQuestion(e.target.value)} placeholder="For example: How should I organise a supplier qualification review?" style={{padding:12,borderRadius:10,border:"1px solid #cbd5e1",width:"100%",boxSizing:"border-box",font:"inherit"}}/>
 <button disabled={busy||question.trim().length<3} type="submit" style={{padding:12,border:0,borderRadius:10,background:"#2659df",color:"#fff",fontWeight:700,opacity:busy?0.6:1}}>{busy?"Thinking…":"Ask question"}</button>
 </form>
 {error&&<p role="alert" style={{color:"#991b1b",margin:0}}>{error}</p>}
 {answer&&<div aria-live="polite" style={{padding:14,borderRadius:10,background:"#f1f5f9",whiteSpace:"pre-wrap",lineHeight:1.6}}>{answer}</div>}
 <p style={{fontSize:12,color:"#64748b",margin:0}}>Do not enter confidential information. Answers may be inaccurate; verify important requirements with official sources.</p>
 </section>;
}
