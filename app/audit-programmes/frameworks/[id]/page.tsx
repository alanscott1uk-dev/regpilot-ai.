import {notFound} from 'next/navigation';
import {frameworkPage,getProfile,mappedProfileChoices,variantsOf} from '../../../../lib/audit-catalogue/catalogue';
import {CatalogueNotice} from '../../../../lib/audit-catalogue/notice';
import css from '../../../integration-directory/directory.module.css';
export const metadata={title:'Framework controls and evidence · RegPilot'};
export default async function FrameworkDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{q?:string;page?:string}>}){
  const p=getProfile((await params).id);if(!p)notFound();
  const search=await searchParams,q=String(search.q??'').trim().slice(0,150),result=frameworkPage(p,q,Number(search.page??1));
  const href=(page:number)=>'?'+new URLSearchParams({q,page:String(page)});
  const alternatives=variantsOf(p);
  return <main className={css.main}><nav className={css.nav}><a href="/audit-programmes/frameworks">All frameworks</a><a href={'/team/programmes/frameworks?'+new URLSearchParams({framework:p.id})}>Open in workspace</a></nav>
    <header className={css.header}><h1>{p.name}</h1><p>{p.publisher} · {p.region} · {p.count} {p.source==='scf'?'mapped controls':p.source==='preparation'?'RegPilot workpapers':'indexed provisions'}</p>
      {p.source==='preparation'?<p>Use these workpapers to prepare your own evidence. Your licensed MyCSF assessment determines the official requirements in scope. <a href={p.url}>HITRUST MyCSF</a></p>:<p>{p.source==='scf'?'The published crosswalk ties each control to the source references it addresses.':p.sampleCount+' provisions have prepared evidence samples. '+(p.passageCount??0)+' provisions include an opening passage from the source. Review applicability before assigning evidence.'} <a href={p.url}>Read the source instrument</a></p>}
      {p.source==='eu'&&<p>Source edition · {p.url.includes('/oj/')?'Original Official Journal publication':'Consolidated text dated 22 June 2026'}. Check subsequent amendments for the period under audit.</p>}
    </header>
    {p.source==='scf'&&<form className={css.form} action="/api/audit-programmes/crosswalk">
      <input type="hidden" name="first" value={p.id}/>
      <label>Compare published controls with another audit<select name="second" required defaultValue=""><option value="" disabled>Select a framework profile</option>
        {mappedProfileChoices.filter(v=>v.id!==p.id).map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
      <button type="submit">Download joint control and evidence matrix</button></form>}
    {alternatives.length>1&&<details className={css.panel}><summary>Versions and assessment profiles</summary><ul>{alternatives.map(v=><li key={v.id}><a href={'/audit-programmes/frameworks/'+v.id}>{v.label}</a></li>)}</ul></details>}
    <form className={css.form}><label>Find a control or provision<input type="search" name="q" maxLength={150} defaultValue={q} placeholder="Control ID, article or subject"/></label><button type="submit">Search</button></form>
    <p>{result.total} results · Page {result.page} of {result.pages}</p>
    <section className={css.panel}>{result.rows.map(c=><details key={c.id}><summary>{c.id} · {c.name}</summary>
      {c.description&&<p>{c.description}</p>}<p style={{whiteSpace:'pre-line'}}><strong>Source reference</strong> {c.reference}</p>
      {c.sourcePassage&&<><h3>Opening passage</h3><blockquote>{c.sourcePassage}</blockquote></>}
      {!!c.objectives.length&&<><h3>Assessment objectives</h3><ul>{c.objectives.map(a=><li key={a.id}>{a.id} · {a.text}</li>)}</ul></>}
      {!!c.evidence.length&&<><h3>{c.suggestedEvidence?'Suggested evidence request':'Evidence to collect'}</h3><ul>{c.evidence.map(e=><li key={e.id}>{e.name}{e.description&&<p>{e.description}</p>}</li>)}</ul></>}
      {p.source!=='preparation'&&<a href={c.url}>Source document</a>}
    </details>)}</section>
    <nav className={css.nav} aria-label="Control pages">{result.page>1&&<a href={href(result.page-1)}>Previous page</a>}{result.page<result.pages&&<a href={href(result.page+1)}>Next page</a>}</nav>
    <footer><CatalogueNotice source={p.source}/></footer>
  </main>;
}
