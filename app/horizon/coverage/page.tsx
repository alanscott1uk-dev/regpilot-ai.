import {publicIndexComparison} from '../../../lib/server/horizon-index-comparison';
import css from '../../integration-directory/directory.module.css';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=120;
export const metadata={title:'Official index coverage · RegPilot AI'};
export default async function OfficialCoverage(){
 const report=await publicIndexComparison().catch(()=>null);
 return <main className={css.main}><nav className={css.nav}><a href="/horizon">Regulatory feed</a><a href="/horizon?view=scottish-pharma-wholesale">Scottish medicines wholesaler</a></nav>
 <header className={css.header}><h1>Official index coverage</h1><p>Compare RegPilot’s collected publications with the MHRA safety indexes and four UK legislative series.</p></header>
 {report?<section className={css.panel}><p>Snapshot {report.snapshot} · Compared {report.verifiedAt}</p><p>{report.method}</p><div className={css.scroll}><table><thead><tr><th>Official index</th><th>Sampled</th><th>Found</th><th>Missing</th><th>Wrong publisher</th><th>Undetermined</th><th>In Scottish review</th></tr></thead><tbody>{report.indexes.map(i=><tr key={i.index}><td><a href={i.index}>{i.name}</a></td>{i.state==='UNAVAILABLE'?<td colSpan={6}>Index unavailable</td>:<><td>{i.selected}</td><td>{i.result?.found??0}</td><td>{i.result?.missing??0}</td><td>{i.result?.wrongPublisher??0}</td><td>{i.result?.indeterminate??0}</td><td>{i.inScottishReview}</td></>}</tr>)}</tbody></table></div>
 <p>The last column counts found publications shown to a Scottish medicines wholesaler for review. A site assessor determines which publications apply.</p>
 <a href="/api/horizon/coverage">Open the dated results with source URLs and index hashes</a></section>:<p>The source comparison is currently unavailable.</p>}</main>;
}
