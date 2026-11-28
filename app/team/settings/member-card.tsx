"use client";
import {useState} from "react";
import {mayManageRole,type TeamRole} from "../../../lib/team-policy";
import ui from "../operations/operations.module.css";
export type Member={role:TeamRole;user:{id:string;email:string}};
export default function MemberCard({member,members,actorRole,userId,busy,onChange}:{member:Member;members:Member[];actorRole:string;userId:string;busy:boolean;onChange:(data:Record<string,unknown>)=>void}){
 const [role,setRole]=useState<TeamRole>(member.role),[replacement,setReplacement]=useState("");
 const self=member.user.id===userId,canManage=!self&&mayManageRole(actorRole,member.role);
 function submit(action:"ROLE"|"REMOVE"|"TRANSFER"){
  const message=action==="TRANSFER"?"Make this administrator the owner? You will become an administrator.":action==="REMOVE"?"Remove this colleague's access? Open assigned work will move to the replacement owner, if selected.":"Save this role change? Invitations issued by this colleague will be revoked.";
  if(window.confirm(message))onChange({userId:member.user.id,expectedRole:member.role,action,...(action==="ROLE"?{role}:{}),...(replacement?{replacementId:replacement}:{})});
 }
 return <article><span className={ui.eyebrow}>{member.role}{self?" · YOU":""}</span><h3>{member.user.email}</h3>
  {canManage&&<details><summary>Manage access</summary><div className={ui.formGrid}>
   <label className={ui.full}>Role<select disabled={busy} value={role} onChange={e=>setRole(e.target.value as TeamRole)}>{(actorRole==="OWNER"?["ADMIN","EDITOR","VIEWER"]:["EDITOR","VIEWER"]).map(r=><option key={r}>{r}</option>)}</select></label>
   <label className={ui.full}>Replacement owner for open work<select disabled={busy} value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">Choose if removing or making read-only</option>{members.filter(m=>m.user.id!==member.user.id&&m.role!=="VIEWER").map(m=><option value={m.user.id} key={m.user.id}>{m.user.email}</option>)}</select></label>
   <p className={ui.hint}>Existing approvals and completed work keep their history. Open tasks, active controls and the latest applicable requirement decisions move together. Relationships affected by changed ownership need review. Automations configured by a removed or demoted administrator pause and their stored connector credentials are removed.</p>
   <div className={ui.buttons}><button disabled={busy||role===member.role} onClick={()=>submit("ROLE")}>Save role</button><button disabled={busy} onClick={()=>submit("REMOVE")}>Remove access</button></div>
  </div></details>}
  {!self&&actorRole==="OWNER"&&member.role==="ADMIN"&&<button disabled={busy} className={ui.linkButton} onClick={()=>submit("TRANSFER")}>Transfer ownership</button>}
 </article>;
}
