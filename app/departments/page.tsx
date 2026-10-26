"use client";
import {useEffect,useState} from "react";
import {INDUSTRIES,getIndustry,validateDepartments} from "../../lib/industry-catalog.mjs";
import styles from "../dashboard.module.css";
type Config={company:string;industry:string;departments:string[]};
const KEY="regpilot-company-configuration-v1";
const initial:Config={company:"Star Medical — fictional pilot",industry:"healthcare",departments:getIndustry("healthcare").departments};
export default function Departments(){
 const [config,setConfig]=useState<Config>(initial);
 const [ready,setReady]=useState(false);
 const [custom,setCustom]=useState("");
 const [message,setMessage]=useState("");
 useEffect(()=>{try{const raw=localStorage.getItem(KEY);if(raw){const v:unknown=JSON.parse(raw);if(v&&typeof v==="object"){const c=v as Partial<Config>;if(typeof c.company==="string"&&c.company.length<=120&&typeof c.industry==="string"&&validateDepartments(c.departments))setConfig(c as Config);}}}catch{}setReady(true)},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify(config))}catch{setMessage("Unable to save browser-local configuration.")}},[config,ready]);
 function changeIndustry(id:string){const template=getIndustry(id);setConfig(c=>({...c,industry:template.id,departments:[...template.departments]}));setMessage("Industry template loaded. Review the departments before use.");}
 function addDepartment(e:React.FormEvent){e.preventDefault();const value=custom.trim();if(!value||value.length>80||config.departments.length>=40||config.departments.some(x=>x.toLowerCase()===value.toLowerCase())){setMessage("Enter a unique department name (maximum 40).");return;}setConfig(c=>({...c,departments:[...c.departments,value]}));setCustom("");setMessage("Department added.");}
 return <main className={styles.shell}>
  <header className={styles.top}><div className={styles.brand}><span className={styles.mark}>R</span>RegPilot <span style={{color:"#3159df"}}>AI</span></div><span className={styles.pill}>DEMO WORKSPACE</span></header>
  <a href="/" style={{fontSize:13,color:"#3159df"}}>← Compliance dashboard</a>
  <div style={{marginTop:24}}><div className={styles.eyebrow}>Organisation setup</div><h1 className={styles.heading}>Industry & departments</h1><p className={styles.sub}>Configure a fictional company and the departments it needs.</p></div>
  <div className={styles.notice}><strong>Prototype only.</strong> This setup is saved in your browser, not shared with other users. Industry templates are organisational suggestions, not validated regulatory checklists.</div>
  <section className={styles.panel} style={{marginBottom:18}}>
   <h2 className={styles.panelTitle}>Business profile</h2>
   <div className={styles.form}>
    <label className={styles.label}>Company name<input className={styles.field} maxLength={120} value={config.company} onChange={e=>setConfig(c=>({...c,company:e.target.value}))}/></label>
    <label className={styles.label}>Industry<select className={styles.field} value={config.industry} onChange={e=>changeIndustry(e.target.value)}>{INDUSTRIES.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
   </div>
  </section>
  <section className={styles.panel}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><h2 className={styles.panelTitle} style={{margin:0}}>Departments</h2><span className={styles.pill}>{config.departments.length} enabled</span></div>
   <p className={styles.sub} style={{margin:"10px 0 18px"}}>Remove departments you don't need or add your own.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
    {config.departments.map(x=><div key={x} style={{border:"1px solid #e1e7f0",padding:"12px 14px",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}><span style={{fontSize:13,fontWeight:650}}>{x}</span><button type="button" aria-label={"Remove "+x} onClick={()=>setConfig(c=>({...c,departments:c.departments.filter(d=>d!==x)}))} style={{border:0,background:"transparent",color:"#a14b30",cursor:"pointer",fontSize:12}}>Remove</button></div>)}
   </div>
   <form onSubmit={addDepartment} style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:20}}>
    <input aria-label="Custom department name" className={styles.field} style={{flex:"1 1 200px"}} maxLength={80} placeholder="Add custom department" value={custom} onChange={e=>setCustom(e.target.value)}/>
    <button className={styles.button}>Add department</button>
   </form>
   {message&&<p role="status" className={styles.meta}>{message}</p>}
  </section>
  <p className={styles.footer}>Department profiles are not yet connected to obligation assignment or authenticated organisation accounts.</p>
 </main>;
}
