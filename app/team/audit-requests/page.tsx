"use client";
import {useState} from "react";
import AuditSession,{type Context} from "../audits/audit-session";
import {RequestPanel} from "./request-panel";
import ui from "../operations/operations.module.css";
export default function AuditRequests(){return <AuditSession>{ctx=><Inbox ctx={ctx}/>}</AuditSession>;}
function Inbox({ctx}:{ctx:Context}){const [org,setOrg]=useState(ctx.organisations[0]?.id||"");return <><section className={ui.toolbar}><label>Organisation<select value={org} onChange={e=>setOrg(e.target.value)}>{ctx.organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><a href="/team/audits">Manage audit rooms</a></section>{org?<RequestPanel key={org} orgId={org} userId={ctx.userId||""}/>:<p>Join a workspace to see assigned evidence requests.</p>}</>;}
