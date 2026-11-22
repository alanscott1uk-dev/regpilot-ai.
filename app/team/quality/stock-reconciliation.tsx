'use client';
import {useState} from 'react';
import {stockCountSchema,type StockRecord} from '../../../lib/stock-reconciliation';
import css from './quality.module.css';

type Props={
 records:StockRecord[]; files:{id:string;filename:string}[]; userId:string; editable:boolean; administrator:boolean; busy:boolean;
 save:(action:'RECORD_STOCK'|'REVIEW_STOCK',input:Record<string,unknown>)=>void;
};
const utc=(value:FormDataEntryValue|null)=>new Date(String(value)).toISOString();
const field=(form:FormData,name:string)=>String(form.get(name)??'');

export default function StockReconciliation({records,files,userId,editable,administrator,busy,save}:Props){
 const [rows,setRows]=useState<number[]>([]),[next,setNext]=useState(1),[error,setError]=useState('');
 const latest=records.at(-1);
 const fileChoice=(name:string,label:string)=><label>{label}<select required name={name}><option value="">Select reviewed evidence</option>
  {files.map(f=><option key={f.id} value={f.id}>{f.filename}</option>)}</select></label>;
 function prepare(form:FormData) {
  try{
   const count=stockCountSchema.parse({
    site:field(form,'site'),product:field(form,'product'),batch:field(form,'batch'),unit:field(form,'unit'),
    openedAt:utc(form.get('openedAt')),countedAt:utc(form.get('countedAt')),opening:field(form,'opening'),physical:field(form,'physical'),
    movements:rows.map(id=>({reference:field(form,'ref'+id),direction:field(form,'direction'+id),quantity:field(form,'quantity'+id),at:utc(form.get('at'+id))})),
    registerId:field(form,'registerId'),countId:field(form,'countId'),notes:field(form,'notes')
   });
   setError('');save('RECORD_STOCK',{count});
  }catch(err){setError(err && typeof err==='object' && 'issues' in err && Array.isArray(err.issues)?String(err.issues[0]?.message):'Check the stock quantities and the times entered.');}
 }
 return <details className={css.section}><summary>Controlled-stock reconciliation</summary>
  <p>Compare the register extract with a physical count for one site, product and batch. Use the same unit throughout.</p>
  {records.map(record=>{
   const {count,review,totals}=record;
   return <details key={record.key} open={record.key===latest?.key}>
    <summary>{count.site} · {count.product} · {count.batch} · {new Date(count.countedAt).toLocaleString('en-GB')} · {totals.matched?'Matched':'Discrepancy'}</summary>
    <p>Opening {count.opening} + received {totals.received} − supplied {totals.supplied} = expected {totals.expected} {count.unit}.</p>
    <p>Physical count {count.physical} {count.unit}. Difference (physical less expected) {totals.difference} {count.unit}.</p>
    {totals.negative&&<p>A movement took the running balance below zero.</p>}
    <p>{count.notes}</p>
    <ul>{count.movements.map(m=><li key={m.reference}>{m.reference} · {m.at} · {m.direction} {m.quantity} {count.unit}</li>)}</ul>
    {record.files.map(f=><p key={f.id}>{f.id===count.registerId?'Register extract':'Physical count'} · {f.filename}</p>)}
    <p>{review?(review.decision==='RECOUNT'?'Recount requested':'Source figures verified')+' · '+review.notes:'Awaiting independent review'}</p>
   </details>;
  })}
  {error&&<p role="alert">{error}</p>}
  {editable&&(!latest||latest.review)&&<form onSubmit={e=>{e.preventDefault();prepare(new FormData(e.currentTarget));}}>
   <fieldset disabled={busy}><legend>{latest?'Record a later physical count':'Record stock reconciliation'}</legend>
    <label>Site and stock location<input name="site" defaultValue={latest?.count.site} readOnly={!!latest} required maxLength={120}/></label>
    <label>Product, strength and form<input name="product" defaultValue={latest?.count.product} readOnly={!!latest} required maxLength={120}/></label>
    <label>Batch or lot<input name="batch" defaultValue={latest?.count.batch} readOnly={!!latest} required maxLength={120}/></label>
    <label>Stock unit<select name="unit" defaultValue={latest?.count.unit??'packs'}>{(latest?[latest.count.unit]:['packs','units','g','mL']).map(u=><option key={u}>{u}</option>)}</select></label>
    <label>Opening balance time (local)<input type="datetime-local" name="openedAt" required/></label>
    <label>Opening balance<input name="opening" inputMode="decimal" required/></label>
    {rows.map((id,i)=><fieldset key={id}><legend>Movement {i+1}</legend>
     <label>Register line reference<input required name={'ref'+id} maxLength={120}/></label>
     <label>Movement time (local)<input required name={'at'+id} type="datetime-local"/></label>
     <label>Direction<select name={'direction'+id}><option value="IN">Received</option><option value="OUT">Supplied or removed</option></select></label>
     <label>Quantity<input required name={'quantity'+id} inputMode="decimal"/></label>
     <button type="button" onClick={()=>setRows(list=>list.filter(r=>r!==id))}>Remove movement {i+1}</button>
    </fieldset>)}
    <button type="button" disabled={rows.length>=40} onClick={()=>{setRows(list=>[...list,next]);setNext(next+1);}}>Add register movement</button>
    <label>Physical count time (local)<input type="datetime-local" name="countedAt" required/></label>
    <label>Quantity physically counted<input name="physical" inputMode="decimal" required/></label>
    {fileChoice('registerId','Register extract covering the whole period')}{fileChoice('countId','Dated physical count record')}
    <label>{latest?'Recount findings and action taken':'Count notes'}<textarea required name="notes" minLength={10} maxLength={800}/></label>
    <button>Save for independent review</button>
   </fieldset>
  </form>}
  {editable&&administrator&&latest&&!latest.review&&latest.actor!==userId&&!latest.files.some(f=>f.uploadedById===userId)&&
   <form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);save('REVIEW_STOCK',{review:{countKey:latest.key,decision:field(form,'decision'),notes:field(form,'reviewNotes')}});}}>
    <fieldset disabled={busy}><legend>Independent stock review</legend>
     <label>Decision<select required name="decision" defaultValue=""><option value="">Choose a decision</option><option value="VERIFIED">Verify figures against the source records</option><option value="RECOUNT">Request a recount</option></select></label>
     <label>Review findings<textarea required name="reviewNotes" minLength={15} maxLength={800}/></label>
     <button>Record review</button>
    </fieldset>
   </form>}
 </details>;
}
