import {catalogueTotals,frameworkRegions,searchFrameworks} from '../../../lib/audit-catalogue/catalogue';
import {CatalogueNotice} from '../../../lib/audit-catalogue/notice';
import css from '../../integration-directory/directory.module.css';

export const metadata={title:'Audit framework catalogue · RegPilot'};
export default async function Frameworks({searchParams}:{searchParams:Promise<{q?:string;region?:string;page?:string}>}){
  const params=await searchParams;
  const q=String(params.q??'').trim().slice(0,150),region=String(params.region??'');
  const result=searchFrameworks(q,region,Number(params.page??1));
  const href=(page:number)=>'?'+new URLSearchParams({q,region,page:String(page)});
  return <main className={css.main}>
    <nav className={css.nav}><a href="/audit-programmes">Audit programmes</a><a href="/team/programmes/frameworks">Workspace audits</a></nav>
    <header className={css.header}><h1>Audit framework catalogue</h1>
      <p>{catalogueTotals.families-catalogueTotals.preparationFamilies} distinct standards, regulations and assurance frameworks with published mappings or provisions. HITRUST e1, i1 and r2 also have RegPilot evidence preparation programmes.</p>
    </header>
    <form className={css.form}><label>Find a framework<input name="q" type="search" maxLength={150} defaultValue={q} placeholder="e.g. SOC 2, ISO 42001, clinical trials"/></label>
      <label>Region<select name="region" defaultValue={region}><option value="">All regions</option>{frameworkRegions.map(r=><option key={r}>{r}</option>)}</select></label>
      <button type="submit">Search</button></form>
    <p>{result.total} framework families · Page {result.page} of {result.pages}</p>
    <div className={css.grid}>{result.rows.map(options=>{const p=options[0];return <article key={p.family} className={css.panel}>
      <h2><a href={'/audit-programmes/frameworks/'+p.id}>{p.name}</a></h2>
      <p>{p.publisher} · {p.region}</p><p>{p.count} {p.source==='scf'?'mapped controls':p.source==='preparation'?'RegPilot workpapers':'indexed provisions'}{p.sampleCount?' · '+p.sampleCount+' prepared evidence samples':''}</p>
      {options.length>1&&<details><summary>{options.length} available versions or profiles</summary><ul>{options.map(v=><li key={v.id}><a href={'/audit-programmes/frameworks/'+v.id}>{v.label}</a></li>)}</ul></details>}
    </article>;})}</div>
    {!result.total&&<p>Try a different name or <a href="/audit-programmes/frameworks">clear the filters</a>.</p>}
    <nav className={css.nav} aria-label="Framework pages">{result.page>1&&<a href={href(result.page-1)}>Previous page</a>}{result.page<result.pages&&<a href={href(result.page+1)}>Next page</a>}</nav>
    <footer><a href={'/api/audit-programmes/frameworks'+href(result.page)}>Download this catalogue page with version and source details</a><CatalogueNotice/></footer>
  </main>;
}
