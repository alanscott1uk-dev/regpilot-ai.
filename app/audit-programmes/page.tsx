import {catalogueTotals,searchFrameworks} from '../../lib/audit-catalogue/catalogue';
import {notFound} from 'next/navigation';
import {STARTER_PACKS} from '../../lib/starter-programmes.mjs';
import css from '../integration-directory/directory.module.css';

export const metadata={title:'Audit and compliance programmes · RegPilot'};
export default async function AuditProgrammes({searchParams}:{searchParams:Promise<{programme?:string;q?:string}>}){
 const params=await searchParams,choice=params.programme,pack=STARTER_PACKS.find(value=>value.id===choice);
 if(choice&&!pack)notFound();
 const query=typeof params.q==='string'?params.q.trim().slice(0,100):'';
 const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
 const matches=STARTER_PACKS.filter(p=>{
  const content=[p.title,p.description,...p.items.flatMap(i=>[i.title,...(i.mappings??[])])].join(' ').toLowerCase();
  return terms.every(term=>content.includes(term));
 });
 const frameworkMatches=query?searchFrameworks(query,'',1):null;
 const href=(value:string)=>'/audit-programmes?'+new URLSearchParams({programme:value});
 return <main className={css.main}><nav className={css.nav}><a href="/">RegPilot</a><a href="/team/programmes">Workspace programmes</a></nav>
 {pack?<><header className={css.header}><a href="/audit-programmes">All programmes</a><h1>{pack.title}</h1><p>{pack.description}</p><a href={'/team/programmes?'+new URLSearchParams({starter:pack.id})}>Use this programme in your workspace</a></header>
 <section className={css.panel}><h2>{pack.items.length} editable tasks</h2><p>Each task can have an owner, a due date and reviewed evidence.</p>
 {pack.items.map(item=><details key={item.key}><summary>{item.title}</summary><p>{item.description}</p><p><strong>Evidence to collect</strong> {item.evidenceHint}</p>
 {!!item.mappings?.length&&<ul>{item.mappings.map(ref=><li key={ref}>{ref}</li>)}</ul>}
 {'sources' in item&&Array.isArray(item.sources)?<p>{item.sources.map((s:{url:string;name:string})=><span key={s.url}><a href={s.url}>{s.name}</a>{' '}</span>)}</p>:item.sourceUrl&&<p><a href={item.sourceUrl}>Read the source for this task</a></p>}</details>)}</section></>:
 <><header className={css.header}><h1>Audit and compliance programmes</h1><p>Choose a framework audit or an editable starter programme for your workspace.</p><a href="/audit-programmes/frameworks">Browse {catalogueTotals.families} framework families and regulatory programmes</a></header>
 <form className={css.form} action="/audit-programmes"><label>Find a programme or control<input type="search" name="q" defaultValue={query} maxLength={100} placeholder="e.g. wholesale, SOC 2, A.5.16"/></label><button type="submit">Search</button></form>
 {frameworkMatches&&frameworkMatches.total>0&&<section className={css.panel}><h2>Framework audits</h2><ul>{frameworkMatches.rows.slice(0,5).map(([p])=><li key={p.id}><a href={'/audit-programmes/frameworks/'+p.id}>{p.name}</a></li>)}</ul><a href={'/audit-programmes/frameworks?'+new URLSearchParams({q:query})}>View all {frameworkMatches.total} matching framework families</a></section>}
 <p>{matches.length} of {STARTER_PACKS.length} starter programmes</p>{query&&<p><a href="/audit-programmes">Clear search</a></p>}
 <div className={css.grid}>{matches.map(p=><article key={p.id} className={css.panel}><h2><a href={href(p.id)}>{p.title}</a></h2><p>{p.description}</p><p>{p.items.length} editable tasks</p></article>)}</div></>}</main>;
}
