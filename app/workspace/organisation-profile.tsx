"use client";
import {useEffect,useState} from "react";
import {stagingSupabase} from "../../lib/staging-supabase";
import {findRelevantAuthorities} from "../../lib/authority-registry.mjs";
const ACTIVITY_OPTIONS=[
 ["medicines-wholesale","Medicines wholesale"],["controlled-drugs","Controlled drugs"],
 ["healthcare","Healthcare"],["food","Food and hospitality"],["construction","Construction"],
 ["manufacturing","Manufacturing"],["logistics","Logistics"],["financial-services","Financial services"],
 ["technology","Technology"],["retail","Retail"]
];
export default function OrganisationProfile({orgId,canEdit}:{orgId:string;canEdit:boolean}){
 const [jurisdiction,setJurisdiction]=useState("Scotland"),[activities,setActivities]=useState<string[]>([]);
 const [loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{let active=true;setLoaded(false);setMessage("");setActivities([]);setJurisdiction("Scotland");
 stagingSupabase().from("organization_compliance_profiles").select("jurisdiction,activities").eq("organization_id",orgId).maybeSingle().then(({data,error})=>{
 if(!active)return;if(error)setMessage("Unable to load business profile: "+error.message);
 else if(data){setJurisdiction(data.jurisdiction);setActivities(data.activities??[]);}setLoaded(true);
 });return()=>{active=false;};},[orgId]);
 async function save(){if(!canEdit)return;setSaving(true);setMessage("");
 const {data:{user}}=await stagingSupabase().auth.getUser();if(!user){setMessage("Please sign in again.");setSaving(false);return;}
 const {error}=await stagingSupabase().from("organization_compliance_profiles").upsert({organization_id:orgId,jurisdiction,activities,updated_by:user.id,updated_at:new Date().toISOString()});
 setMessage(error?"Could not save: "+error.message:"Business profile saved.");setSaving(false);}
 const candidates=loaded?findRelevantAuthorities({jurisdiction,sectors:activities}):[];
 return <section style={{padding:16,border:"1px solid #dbe3ee",borderRadius:14,background:"#fff",display:"grid",gap:12}}>
 <h3 style={{margin:0}}>Tell us about your business</h3><p style={{margin:0,fontSize:13,color:"#64748b"}}>This helps us suggest relevant regulatory authorities. It does not determine legal obligations.</p>
 <label>Where does this business operate?<select value={jurisdiction} disabled={!canEdit||!loaded} onChange={e=>setJurisdiction(e.target.value)} style={{display:"block",width:"100%",padding:11,marginTop:6}}>{["England","Scotland","Wales","Northern Ireland"].map(x=><option key={x}>{x}</option>)}</select></label>
 <fieldset disabled={!canEdit||!loaded} style={{border:"1px solid #e2e8f0",borderRadius:10,display:"grid",gap:9}}><legend>What does your business do?</legend>{ACTIVITY_OPTIONS.map(([value,label])=><label key={value} style={{display:"flex",gap:9,alignItems:"center",fontSize:14}}><input type="checkbox" checked={activities.includes(value)} onChange={e=>setActivities(p=>e.target.checked?[...p,value]:p.filter(x=>x!==value))}/>{label}</label>)}</fieldset>
 {canEdit&&<button type="button" disabled={saving||!loaded} onClick={()=>void save()} style={{padding:12,border:0,borderRadius:10,background:"#2659df",color:"white"}}>{saving?"Saving…":"Save business profile"}</button>}
 {message&&<p role="status" style={{fontSize:13}}>{message}</p>}
 <strong>Potentially relevant authorities ({candidates.length})</strong>
 {candidates.length?candidates.map((a:{id:string;name:string;url:string})=><a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" style={{fontSize:13}}>{a.name}</a>):<p style={{fontSize:13,color:"#64748b"}}>Select business activities to explore possible authorities.</p>}
 <p style={{fontSize:12,color:"#64748b"}}>Candidate matches only. Applicability, exemptions and regulatory requirements must be independently verified.</p>
 </section>;
}
