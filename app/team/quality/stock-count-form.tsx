'use client';
import {useEffect,useRef,useState} from 'react';
import {reconcileStock,stockCountSchema,stockRegisterSchema,type StockCount,type StockRecord} from '../../../lib/stock-reconciliation';
import {localStockTime,type parseExcelStock} from '../../../lib/excel-stock';
import ExcelStockImport from './excel-stock-import';
import css from './quality.module.css';

export type StockFile={id:string;filename:string;sha256?:string};
type Props={latest?:StockRecord;files:StockFile[];fileLibrary:string;reloadFiles:()=>Promise<StockFile[]>;busy:boolean;save:(count:StockCount)=>void};
const text=(form:FormData,key:string)=>String(form.get(key)??'');
const utc=(value:string)=>new Date(value).toISOString();
type Movement={key:number;reference:string;direction:'IN'|'OUT';at:string;quantity:string};
const headings=['Enter register movements','Enter the physical count','Check and submit'];
const guidance=[
 'Use the opening balance in the register. Add every receipt and removal up to the count. Leave movements empty if there were none.',
 'Use the dated physical count sheet. Select a reviewed register extract and a separate count record so a colleague can check both.',
 'Compare the calculated balance with the physical count. Go back to correct an entry, or send the figures to an independent reviewer.'
];

export default function StockCountForm({latest,files:initialFiles,fileLibrary,reloadFiles,busy,save}:Props){
 const [files,setFiles]=useState(initialFiles),[refreshing,setRefreshing]=useState(false),[fileNotice,setFileNotice]=useState('');
 async function refresh(){
  setRefreshing(true);setFileNotice('');
  try{
   const current=await reloadFiles();setFiles(current);
   setCount(prev=>({...prev,registerId:current.some(f=>f.id===prev.registerId)?prev.registerId:'',countId:current.some(f=>f.id===prev.countId)?prev.countId:''}));
   setFileNotice('Reviewed file list updated.');
  }catch{setFileNotice('Could not refresh the file list. Try again.');}
  finally{setRefreshing(false);}
 }
 const [page,setPage]=useState(0),[error,setError]=useState(''),[preview,setPreview]=useState<StockCount|null>(null);
 const [register,setRegister]=useState({site:latest?.count.site??'',product:latest?.count.product??'',batch:latest?.count.batch??'',
  unit:latest?.count.unit??'packs',openedAt:'',opening:''});
 const [movements,setMovements]=useState<Movement[]>([]),sequence=useRef(0);
 const [count,setCount]=useState({countedAt:'',physical:'',registerId:'',countId:'',notes:''});
 const heading=useRef<HTMLHeadingElement>(null),previous=useRef(page);
 useEffect(()=>{if(previous.current!==page){previous.current=page;heading.current?.focus();}},[page]);
 function move(to:number){setError('');setPage(to);}
 function editMovement(key:number,change:Partial<Omit<Movement,'key'>>){
  setMovements(rows=>rows.map(row=>row.key===key?{...row,...change}:row));
 }
 function importExcel(s:ReturnType<typeof parseExcelStock>){
  if(latest&&(['site','product','batch','unit'] as const).some(k=>s[k]!==latest.count[k]))throw Error('Use the same site, product, batch and unit for a recount.');
  const openedAt=localStockTime(s.openedAt),countedAt=localStockTime(s.countedAt);
  const rows=s.movements.map(m=>({...m,key:++sequence.current,at:localStockTime(m.at)}));
  setRegister({site:s.site,product:s.product,batch:s.batch,unit:s.unit,openedAt,opening:s.opening});setMovements(rows);
  setCount({countedAt,physical:s.physical,registerId:'',countId:'',notes:''});setPreview(null);setError('');setFileNotice('');
 }
 function check(form:FormData){
  if(page===2){if(preview)save(preview);return;}
  try{
   const source={...register,openedAt:utc(register.openedAt),movements:movements.map(({key,at,...row})=>({...row,at:utc(at)}))};
   if(page===0){
    const checked=stockRegisterSchema.safeParse(source);
    if(!checked.success){setError(checked.error.issues[0].message);return;}
    move(1);return;
   }
   const checked=stockCountSchema.safeParse({...source,...count,countedAt:utc(text(form,'countedAt'))});
   if(!checked.success){setError(checked.error.issues[0].message);return;}
   const current=checked.data;
   if(Date.parse(current.countedAt)>Date.now()){setError('Choose a physical count time up to now.');return;}
   const registerFile=files.find(f=>f.id===current.registerId),countFile=files.find(f=>f.id===current.countId);
   if(registerFile?.sha256&&registerFile.sha256===countFile?.sha256){setError('Select two different source documents.');return;}
   if(latest&&(Date.parse(current.countedAt)<=Date.parse(latest.count.countedAt)||current.countId===latest.count.countId)){
    setError('Use a later count time and the new physical count record for this recount.');return;
   }
   setPreview(current);move(2);
  }catch{setError('Check the local date and time entries before continuing.');}
 }
 const totals=preview?reconcileStock(preview):null;
 return <form onSubmit={e=>{e.preventDefault();check(new FormData(e.currentTarget));}} className={css.stockForm}>
  <fieldset disabled={busy||refreshing}>
   <p className={css.stepLabel}>Step {page+1} of 3</p>
   <h4 ref={heading} tabIndex={-1}>{headings[page]}</h4><p>{guidance[page]}</p>
   {page===0&&<>
    <ExcelStockImport apply={importExcel}/>
    <div className={css.stockFields}>{([['site','Site and stock location'],['product','Product, strength and form'],['batch','Batch or lot']] as const).map(([key,label])=>
     <label key={key}>{label}<input value={register[key]} readOnly={!!latest} required maxLength={120} onChange={e=>setRegister({...register,[key]:e.target.value})}/></label>)}
     <label>Stock unit<select value={register.unit} onChange={e=>setRegister({...register,unit:e.target.value as StockCount['unit']})}>{(latest?[latest.count.unit]:['packs','units','g','mL']).map(u=><option key={u}>{u}</option>)}</select></label>
     <label>Opening balance time (local)<input type="datetime-local" step="any" required value={register.openedAt} onChange={e=>setRegister({...register,openedAt:e.target.value})}/></label>
     <label>Opening balance<input inputMode="decimal" required value={register.opening} onChange={e=>setRegister({...register,opening:e.target.value})}/></label>
    </div>
    {movements.map((row,i)=><fieldset key={row.key} className={css.movement}><legend>Movement {i+1}</legend><div className={css.stockFields}>
     <label>Register line reference<input required maxLength={120} value={row.reference} onChange={e=>editMovement(row.key,{reference:e.target.value})}/></label>
     <label>Movement time (local)<input required type="datetime-local" step="any" value={row.at} onChange={e=>editMovement(row.key,{at:e.target.value})}/></label>
     <label>Direction<select value={row.direction} onChange={e=>editMovement(row.key,{direction:e.target.value as Movement['direction']})}><option value="IN">Received</option><option value="OUT">Supplied or removed</option></select></label>
     <label>Quantity<input required inputMode="decimal" value={row.quantity} onChange={e=>editMovement(row.key,{quantity:e.target.value})}/></label>
    </div><button type="button" onClick={()=>setMovements(rows=>rows.filter(m=>m.key!==row.key))}>Remove movement {i+1}</button></fieldset>)}
    <button type="button" disabled={movements.length>=40} onClick={()=>{const key=++sequence.current;setMovements(rows=>[...rows,{key,reference:'',direction:'IN',quantity:'',at:''}]);}}>Add register movement</button>
   </>}
   {page===1&&<><div className={css.stockFields}>
    <label>Physical count time (local)<input type="datetime-local" step="any" name="countedAt" required value={count.countedAt} onChange={e=>setCount({...count,countedAt:e.target.value})}/></label>
    <label>Quantity physically counted ({register.unit})<input inputMode="decimal" required value={count.physical} onChange={e=>setCount({...count,physical:e.target.value})}/></label>
    {([['registerId','Register extract covering the whole period'],['countId','Dated physical count record']] as const).map(([key,label])=><label key={key}>{label}
     <select required value={count[key]} onChange={e=>setCount({...count,[key]:e.target.value})}><option value="">Choose reviewed evidence</option>{files.map(f=><option value={f.id} key={f.id}>{f.filename}</option>)}</select></label>)}
   </div><label>{latest?'Recount findings and action taken':'Count notes'}<textarea required minLength={10} maxLength={800} value={count.notes} onChange={e=>setCount({...count,notes:e.target.value})}/></label>
   {files.length<2&&<p>You need two independently reviewed documents.</p>}
   <div className={css.stockButtons}><a href={fileLibrary} target="_blank" rel="noreferrer">Open evidence library in a new tab</a><button type="button" onClick={()=>void refresh()}>Refresh reviewed files</button></div>
   {fileNotice&&<p role="status">{fileNotice}</p>}
   </>}
   {page===2&&preview&&totals&&<><p>{preview.site} · {preview.product} · Batch {preview.batch}</p>
    <dl className={css.stockTotals}>{[['Expected balance',totals.expected],['Physical count',preview.physical],['Difference',totals.difference]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value} {preview.unit}</dd></div>)}</dl>
    <p>{totals.matched?'The quantities match. An independent reviewer will check the source records.':totals.negative?'A movement took the running balance below zero. Check the register sequence and record any discrepancy.':'The quantities differ. Check the entries and describe the discrepancy in the count notes.'}</p>
    <p>Opening {preview.opening} + received {totals.received} − supplied {totals.supplied} = {totals.expected} {preview.unit}.</p>
    <p>Register extract · {files.find(f=>f.id===preview.registerId)?.filename}<br/>Count record · {files.find(f=>f.id===preview.countId)?.filename}</p>
    <p>Count notes · {preview.notes}</p>
   </>}
   {error&&<p role="alert">{error}</p>}
   <div className={css.stockButtons}>
    {page>0&&<button type="button" onClick={()=>move(page-1)}>Back</button>}
    <button type="submit">{['Continue to physical count','Preview reconciliation','Send for independent review'][page]}</button>
   </div>
  </fieldset>
 </form>;
}
