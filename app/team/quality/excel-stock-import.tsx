'use client';
import {useEffect,useRef,useState} from 'react';
import OfficeReceive from '../../components/office-receive';
import {parseExcelStock} from '../../../lib/excel-stock';
type Stock=ReturnType<typeof parseExcelStock>;
export default function ExcelStockImport({apply}:{apply:(stock:Stock)=>void}){
 const [stock,setStock]=useState<Stock|null>(null),[notice,setNotice]=useState('');
 const version=useRef(0);useEffect(()=>()=>{version.current++;},[]);
 function receive(value:unknown){version.current++;setStock(null);try{setStock(parseExcelStock(value));setNotice('');}catch(e){setNotice((e as Error).message);}}
 return <details><summary>Import Excel stock rows</summary><p>In Excel, select the eight columns for one batch. Include the OPEN and COUNT rows and all movements between them.</p>
 <a href="/office/stock-example.tsv" download>Download example stock rows</a><OfficeReceive host="excel" receive={receive}/>
 <label>Excel stock transfer file<input type="file" accept=".json" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';const token=++version.current;setStock(null);setNotice('');
  if(!f)return;try{if(f.size>96000)throw Error('Choose a stock selection under 96 KB.');const v=JSON.parse(await f.text());if(token===version.current)receive(v);}
  catch(err){if(token===version.current)setNotice(err instanceof SyntaxError?'Choose a valid Excel stock transfer.':(err as Error).message);}}}/></label>
 {stock&&<><p>{stock.site} · {stock.product} · Batch {stock.batch} · {stock.movements.length} movements · Physical count {stock.physical} {stock.unit}.</p>
 <button type="button" onClick={()=>{try{apply(stock);setStock(null);setNotice('Excel figures copied into the draft. Review them before continuing.');}catch(e){setNotice((e as Error).message);}}}>Use these figures in place of the current draft</button></>}
 {notice&&<p role="status">{notice}</p>}</details>;
}
