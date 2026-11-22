import TestBuilder from './test-builder';
import {sourceCatalogue,registryFilters,sourceKinds,planPath} from '../../lib/server/source-registry';
import css from '../integration-directory/directory.module.css';
export const runtime='nodejs',dynamic='force-dynamic';
export const metadata={title:'Database and source integrations · RegPilot AI'};
const kinds:Record<string,string>={database:'Database',api:'API',file:'File'};

export default async function Sources({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=new URLSearchParams();
  for (const [key,value] of Object.entries(await searchParams)) if (typeof value==='string') params.set(key,value);
  const filters=registryFilters(params);
  const data=await sourceCatalogue(filters).catch(()=>null);
  const href=(page:number)=>'/database-integrations?'+new URLSearchParams({q:filters.term,kind:filters.kind,tested:filters.tested?'1':'',page:String(page)});
  return <main className={css.main}>
    <nav className={css.nav}><a href="/">RegPilot AI</a><a href="/integration-directory">Integration directory</a><a href="/integration-benchmark">Verified monitoring benchmark</a></nav>
    <header className={css.header}><h1>Database and source integrations</h1><p>Choose a source, download its collection plan and evaluate a control on your own infrastructure.</p></header>
    <section className={css.panel}><div className={css.intro}><h2>Source catalogue</h2><a href={href(data?.page||1)}>Refresh view</a></div>
    {data?<><p><strong>{data.counts.total} source definitions</strong> from Airbyte · {data.counts.databases} database definitions · {data.counts.plans} collection plans with a checked image digest</p>
    {data.counts.plans>0&&<p><a href="/api/database-integrations/manifest">Download all {data.counts.plans} checked plans</a></p>}
    <form method="get" className={css.form}><label>Source name<input type="search" name="q" defaultValue={filters.term} maxLength={120} placeholder="Postgres, MySQL, Salesforce…"/></label>
      <label>Source type<select name="kind" defaultValue={filters.kind}><option value="">All types</option>{sourceKinds.map(k=><option key={k} value={k}>{kinds[k]}</option>)}</select></label>
      <label>Test evidence<select name="tested" defaultValue={filters.tested?'1':''}><option value="">All definitions</option><option value="1">Workspace delivery tested</option></select></label><button type="submit">Search</button></form>
    <p>{data.counts.matches} matching definitions{data.counts.refreshed&&<> · Imported {data.counts.refreshed.toISOString().slice(0,16).replace('T',' ')} UTC</>}</p>
    {data.entries.length>0?<div className={css.scroll}><table><thead><tr><th>Source</th><th>Type</th><th>Version</th><th>Collection plan</th></tr></thead><tbody>
    {data.entries.map(row=><tr key={row.id}><td>{row.name}{row.workspace_tested&&<> · <a href={'#test-'+row.id}>View collection test</a></>}</td><td>{kinds[row.kind]||row.kind}</td><td>{row.version}</td><td>{row.artifact_verified?<a href={planPath(row.id,row.version)} aria-label={'Download '+row.name+' plan'}>Download JSON</a>:row.plan_available?'Image check pending or unavailable':'Provider-managed'}</td></tr>)}</tbody></table></div>:<p>No matching source. <a href="/database-integrations">Clear filters</a></p>}
    
    {data.pages>1&&<nav className={css.pages} aria-label="Source pages">{data.page>1&&<a href={href(data.page-1)}>Previous</a>}<span>Page {data.page} of {data.pages}</span>{data.page<data.pages&&<a href={href(data.page+1)}>Next</a>}</nav>}</>:<p role="status">The staging source catalogue is unavailable.</p>}</section>
    <section className={css.panel}><TestBuilder sources={(data?.entries ?? []).filter(row=>row.artifact_verified).map(({id,name,version})=>({id,name,version}))}/></section>
    {data&&data.acceptance.length>0&&<section className={css.panel}><h2>Database collection tests</h2>
    <p>These tests use disposable databases. Each test reads a held record, rotates the source credential, checks the retired credential is rejected and submits both collection receipts to a private test workspace.</p>
    <div className={css.scroll}><table><thead><tr><th>Database</th><th>First read</th><th>After correction</th><th>Test record</th></tr></thead><tbody>
      {data.acceptance.map(a=><tr key={a.id} id={'test-'+a.id}><td>{a.name} {a.version}</td><td>{a.before_different} held of {a.before_matched+a.before_different}</td><td>{a.after_matched} accepted of {a.after_matched}</td>
      <td><a href={'https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/'+a.run+'/job/'+a.job}>View test · {a.completed_at.toISOString().slice(0,10)}</a></td></tr>)}
    </tbody></table></div></section>}
    <section className={css.panel}><h2>Run a manual collection</h2><p>Use a read-only source account and an approved connector image. The runner discovers streams, reads the one you select and checks a field or nested value against your expected result or numeric limits. By default the receipt records aggregate counts. To identify affected records, choose an approved resource ID field and a source instance. You can track up to 16 IDs per reading and review their history after a correction.</p>
    <p><a href="/database-bridge/setup.txt">Set up collection and resource findings</a> · <a href="/database-bridge/collect.py" download>Download the runner</a> · <a href="/database-bridge/watch.py" download>Download scheduled checks</a> · <a href="/instrument-bridge/deliver.py" download>Download the delivery tool</a></p>
    <p>Workspace submissions go to an administrator for review. The <a href="/integration-benchmark">monitoring benchmark</a> tracks separate evidence of repeated live collection.</p></section></main>;
}
