'use client';
import {useState} from 'react';
import {auditRequest} from './audit-session';
import type {buyerAnnexOptions} from '../../../lib/server/buyer-annex';
type Options=Awaited<ReturnType<typeof buyerAnnexOptions>>;
export default function PartnerAnnexPanel({org,room,grants}:{org:string;room:string;grants:{id:string;email:string;status:string}[]}){
 const base='/api/workspace/trust/'+room+'/annex?organizationId='+org,[buyer,choose]=useState(''),[view,setView]=useState<Options|null>(null),[msg,tell]=useState(''),[busy,lock]=useState(false);
 async function load(id:string){choose(id);setView(null);tell('');if(!id)return;lock(true);try{setView(await auditRequest(base+'&grantId='+id));}catch(e){tell(e instanceof Error?e.message:'Could not verify recipient consent.');}finally{lock(false);}}
 return <details><summary>Share a consented supplier record with a named buyer</summary><label>Named buyer<select disabled={busy} value={buyer} onChange={e=>void load(e.target.value)}><option value="">Choose an invitation</option>{grants.filter(g=>['ACCEPTED','PENDING'].includes(g.status)).map(g=><option value={g.id} key={g.id}>{g.email}</option>)}</select></label>
 {view&&!view.receipts.length&&<p>No current supplier record authorises disclosure to this buyer.</p>}{view?.receipts.map(r=><form key={r.id} onSubmit={async e=>{e.preventDefault();lock(true);try{await auditRequest(base,{grantId:buyer,observationId:r.id,receiptHash:r.receiptHash,confirm:true});tell('Shared with '+view.buyer+'.');}catch(e){tell(e instanceof Error?e.message:'Could not share this receipt.');}finally{lock(false);}}}><h4>{r.source} · {r.recordId} · revision {r.revision}</h4><p>{Object.entries(r.record).map(([k,v])=>k+' '+v).join(' · ')}</p><label><input type="checkbox" required/> I approve these details for {view.buyer}.</label><button disabled={busy}>Share this source receipt</button></form>)}{msg&&<p role="status">{msg}</p>}</details>;
}
