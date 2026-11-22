'use client';
import {useState} from 'react';
import type {StockCount,StockRecord} from '../../../lib/stock-reconciliation';
import {workspaceHref} from '../../../lib/client/workspace-context';
import StockCountForm,{type StockFile} from './stock-count-form';
import css from './quality.module.css';

type Member={id:string;email:string;role:string};
type Props={
 records:StockRecord[]; files:StockFile[]; organizationId:string; userId:string; owner:string; members:Member[];
 editable:boolean; administrator:boolean; busy:boolean; expanded:boolean; onToggle:(open:boolean)=>void;
 reloadFiles:()=>Promise<StockFile[]>; download:()=>void;
 save:(action:'RECORD_STOCK'|'REVIEW_STOCK',input:Record<string,unknown>)=>void;
};

export default function StockReconciliation({records,files,organizationId,userId,owner,members,editable,administrator,busy,expanded,onToggle,reloadFiles,download,save}:Props){
 const latest=records.at(-1),waiting=!!latest&&!latest.review;
 const eligible=(id:string)=>latest?.actor!==id&&!latest?.files.some(file=>file.uploadedById===id);
 const canReview=waiting&&editable&&administrator&&eligible(userId);
 const reviewerNames=members.filter(m=>['OWNER','ADMIN'].includes(m.role)&&eligible(m.id)).map(m=>m.email);
 const recount=!!latest?.review&&(latest.review.decision==='RECOUNT'||!latest.totals.matched);
 const [another,setAnother]=useState(false);
 const href=(id?:string)=>workspaceHref('/team/evidence',organizationId,id?{evidenceId:id}:{});
 return <details id="quality-stock" open={expanded} onToggle={e=>{if(e.currentTarget.open!==expanded)onToggle(e.currentTarget.open);}} className={css.section}>
  <summary>Controlled-stock reconciliation</summary>
  {waiting&&<div className={css.stockNotice}><h4>{canReview?'Review the submitted count':'Awaiting independent stock review'}</h4>
   <p>{canReview?'Open the register extract and physical count record below. Check the entries, then verify the figures or request a recount.':'An independent quality administrator must check the register and count records.'}</p>
   {!canReview&&reviewerNames.length>0&&<p>Eligible reviewers include {reviewerNames.slice(0,3).join(', ')}.</p>}
  </div>}
  {latest?.review&&<div className={css.stockNotice}><h4>{recount?(latest.review.decision==='RECOUNT'?'Recount requested':'Stock discrepancy still open'):'Stock figures verified'}</h4>
   <p>{recount?'Case owner: '+owner+'. Investigate the difference or review finding, then enter a later physical count and its dated evidence.':'Download the inspection summary for the reviewed figures and their source records.'}</p>
   <p>Reviewer’s finding · {latest.review.notes}</p>
   <button type="button" disabled={busy} onClick={download}>Download stock inspection summary</button>
  </div>}
  {records.map(record=>{
   const {count,review,totals}=record;
   return <details key={record.key} open={record.key===latest?.key} className={css.stockRecord}>
    <summary>{count.site} · {count.product} · {count.batch} · {new Date(count.countedAt).toLocaleString('en-GB')} · {totals.matched?'Matched':'Discrepancy'}</summary>
    <p>Opening {count.opening} + received {totals.received} − supplied {totals.supplied} = expected {totals.expected} {count.unit}.</p>
    <p>Physical count {count.physical} {count.unit}. Difference (physical less expected) {totals.difference} {count.unit}.</p>
    {totals.negative&&<p>A movement took the running balance below zero.</p>}
    <p>{count.notes}</p>
    {!!count.movements.length&&<ul>{count.movements.map(m=><li key={m.reference}>{m.reference} · {m.at} · {m.direction} {m.quantity} {count.unit}</li>)}</ul>}
    {record.files.map(f=><p key={f.id}><a href={href(f.id)} target="_blank" rel="noreferrer">{f.id===count.registerId?'Open register extract':'Open physical count record'} · {f.filename}</a></p>)}
    {review&&<p>{review.decision==='RECOUNT'?'Recount requested':'Source figures verified'} · {members.find(m=>m.id===review.actor)?.email??'Reviewer '+review.actor} · {new Date(review.at).toLocaleString('en-GB')}</p>}
    {review&&record.key!==latest?.key&&<p>{review.notes}</p>}
   </details>;
  })}
  {editable&&!waiting&&(latest?.review&&!recount&&!another?<button type="button" disabled={busy} onClick={()=>setAnother(true)}>Start a later stock count</button>:
   <StockCountForm latest={latest} files={files} fileLibrary={href()} reloadFiles={reloadFiles} busy={busy} save={(count:StockCount)=>save('RECORD_STOCK',{count})}/>)}
  {canReview&&latest&&<form className={css.stockForm} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);
   save('REVIEW_STOCK',{review:{countKey:latest.key,decision:String(form.get('decision')),notes:String(form.get('reviewNotes'))}});}}>
   <fieldset disabled={busy}><legend>Independent stock review</legend>
    <label>Decision<select required name="decision" defaultValue=""><option value="">Choose a decision</option><option value="VERIFIED">Verify figures against the source records</option><option value="RECOUNT">Request a recount</option></select></label>
    <label>Review findings<textarea required name="reviewNotes" minLength={15} maxLength={800}/></label>
    {!latest.totals.matched&&<p>Verifying these figures records the discrepancy. It stays open until a later count reconciles.</p>}
    <button>Record review</button>
   </fieldset>
  </form>}
 </details>;
}
