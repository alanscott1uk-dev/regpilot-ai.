import {registerBenchmark} from '../../lib/connectors/register-benchmark';
import {publicRegisterHistory,registerStagingEnabled} from '../../lib/server/public-register-history';
import {recordCatalogue} from '../../lib/connectors/record-catalogue';
import css from '../integration-directory/directory.module.css';
export const runtime='nodejs',dynamic='force-dynamic';
export const metadata={title:'Integration benchmark · RegPilot AI'};
const utc=(stamp:string)=>new Date(stamp).toISOString().slice(0,16).replace('T',' ')+' UTC';
const download=(provider:string,batch:string)=>'/api/integration-benchmark/receipt?'+new URLSearchParams({provider,batch});
export default async function BenchmarkPage(){
 const history=registerStagingEnabled()?await publicRegisterHistory().catch(()=>null):null;
 const report=history?await registerBenchmark(history):null;
 return <main className={css.main}><nav className={css.nav}><a href="/">RegPilot AI</a><a href="/integration-directory">Integration directory</a><a href="/team/developers#source-verification">Customer source verification</a></nav>
 <header className={css.header}><h1>Integration benchmark</h1><p>RegPilot’s target is 500 distinct products with verified monitoring. This register tracks the public pharmaceutical sources observed by staging.</p></header>
 <section className={css.panel}><div className={css.intro}><h2>Verified public integrations</h2><a href="/integration-benchmark">Refresh evidence</a></div>
 {report?<><p><strong>{report.qualified} of {report.target}</strong> evidenced by this register. Each product counts once after two complete reads 24 to 24½ hours apart. A current reading can identify a control that needs follow-up.</p><p>Staging collects daily. Evidence becomes stale after 24 hours and a 30-minute collection allowance.</p>
 {report.products.map(p=><article key={p.provider}><h3>{recordCatalogue[p.provider].name}</h3>
 <p><strong>{p.stale?'Stale':p.qualifies?'Verified':p.latest?.state==='Collected'?'First daily receipt':p.latest?.state??'Awaiting first collection'}</strong>{p.latest?' · '+utc(p.latest.startedAt):''}</p>
 {p.latest?.reason&&<p>{p.latest.reason}</p>}{p.latest?.observation&&<><ul>{p.latest.observation.checks.map(c=><li key={c.id}><strong>{c.status}</strong> · {c.label} · {c.observed}</li>)}</ul><p>{p.latest.observation.limitations.join(' ')}</p><a href={p.latest.observation.sourceUrl}>Open source record</a>{' · '}</>}
 {p.latest&&<a href={download(p.provider,p.latest.batch)}>Download latest receipt</a>}{p.previous&&<> · <a href={download(p.provider,p.previous.batch)}>Download earlier receipt</a></>}
 <p><a href={'/team/operations?view=connections&register='+p.provider}>Monitor this record in your workspace</a></p>
 </article>)}</>:<p role="status">Public register receipts are unavailable in this environment.</p>}</section></main>;
}
