'use client';
import {useEffect,useState} from 'react';
import type {assuranceCoverage} from '../../../lib/server/assurance-coverage';
import {coverageAreas,readReportView,applyReportView,type ReportView,type CoverageArea} from '../../../lib/coverage-report-view';
import {riskRating} from '../../../lib/risk-register';
import ui from './briefing.module.css';
type Coverage=Awaited<ReturnType<typeof assuranceCoverage>>;
const axis=[1,2,3,4,5];
export function CoveragePanel({data,onExport}:{data:Coverage;onExport:(measures:Coverage['measures'])=>void}){
 const [view,setView]=useState<ReportView>({areas:[...coverageAreas],attentionOnly:false});
 useEffect(()=>{
  const read=()=>setView(readReportView(new URLSearchParams(window.location.search)));
  read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read);
 },[]);
 function update(next:ReportView){
  const address=new URL(window.location.href);applyReportView(address.searchParams,next);
  window.history.replaceState(window.history.state,'',address);
  setView(next);
 }
 const [cell,setCell]=useState<[number,number]|null>(null);
 const measures=data.measures.filter(row=>view.areas.includes(row.area as CoverageArea)&&(!view.attentionOnly||row.attention>0));
 const selected=cell?data.risks.filter(risk=>risk.likelihood===cell[0]&&risk.impact===cell[1]):[];
 const total=data.measures.find(row=>row.area==='risks')?.total||0;
 return <section className={ui.section} aria-label="Assurance coverage">
  <div className={ui.heading}><h2>Assurance coverage</h2><label><input type="checkbox" checked={view.attentionOnly} onChange={e=>update({...view,attentionOnly:e.target.checked})}/> Needs attention only</label></div>
  <p>Each check counts the organisation’s saved records when the report runs. Open an area to inspect the underlying evidence.</p>
  <details><summary>Customise this report</summary><p>Choose the areas to include. Bookmark the resulting address to reopen these filters with current data.</p>
   <fieldset className={ui.choices}><legend>Report areas</legend>{data.measures.map(row=>{
    const area=row.area as CoverageArea,checked=view.areas.includes(area);
    return <label key={area}><input type="checkbox" checked={checked} disabled={checked&&view.areas.length===1} onChange={()=>update({...view,areas:checked?view.areas.filter(x=>x!==area):[...view.areas,area]})}/>{row.title}</label>;
   })}</fieldset><button type="button" onClick={()=>update({areas:[...coverageAreas],attentionOnly:false})}>Restore all areas</button></details>
  <div className={ui.coverage}>{measures.map(row=><article key={row.area}><a href={row.href}>{row.title}</a><strong>{!row.total?'No records in scope':row.attention+' of '+row.total+' need attention'}</strong><small>{row.description}</small></article>)}</div>
  <button type="button" disabled={!measures.length} onClick={()=>onExport(measures)}>Export selected checks as CSV</button>
  {!measures.length&&<p>No recorded items flagged by these checks.</p>}
  {view.areas.includes('risks')&&<><h3>Inherent risk matrix</h3>
  {total>data.risks.length&&<p>Showing the first {data.riskLimit} risks by review date out of {total}.</p>}
  {total===0?<p>No unarchived risks recorded.</p>:<><table className={ui.matrix}><caption>Choose a count to inspect risks. Both scales run from 1 to 5.</caption><thead><tr><th scope="col">Likelihood ↓ / Impact →</th>{axis.map(i=><th key={i} scope="col">{i}</th>)}</tr></thead><tbody>{[...axis].reverse().map(l=><tr key={l}><th scope="row">{l}</th>{axis.map(i=>{
   const count=data.risks.filter(r=>r.likelihood===l&&r.impact===i).length,band=riskRating(l,i).band;
   return <td key={i}><button type="button" disabled={!count} aria-pressed={cell?.[0]===l&&cell[1]===i} aria-label={count+' risks, likelihood '+l+', impact '+i+', '+band.toLowerCase().replace('_',' ')} data-band={band} onClick={()=>setCell([l,i])}>{count}</button></td>;
  })}</tr>)}</tbody></table>{cell&&<div aria-live="polite"><h4>Likelihood {cell[0]} · Impact {cell[1]}</h4><ul>{selected.map(r=><li key={r.id}><a href={r.href}>{r.title}</a></li>)}</ul></div>}</>}
 </>}
 </section>;
}
