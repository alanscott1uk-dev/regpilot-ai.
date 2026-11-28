import {db} from '../../lib/server/db';
import styles from '../integration-directory/directory.module.css';

export const runtime='nodejs',dynamic='force-dynamic';
export const metadata={title:'Staging monitoring evidence · RegPilot AI'};
type Sample={id:string;collected_at:Date;resources:number;tests:number;passed:number;fingerprint:string};
async function history(){
 if(process.env.VERCEL_ENV!=='preview'||process.env.REGPILOT_STAGING_PREFLIGHT!=='true')return [];
 return db.$queryRaw<Sample[]>`SELECT id,collected_at,resources,tests,passed,fingerprint FROM regpilot_verification.history ORDER BY collected_at DESC LIMIT 48`;
}
export default async function MonitoringProof(){
 const samples=await history().catch(()=>[]),latest=samples[0],first=samples.at(-1);
 const age=latest?Date.now()-latest.collected_at.getTime():Infinity;
 return <main className={styles.main}><nav className={styles.nav}><a href="/">RegPilot AI</a><a href="/integration-directory">Integration directory</a></nav><header className={styles.header}><h1>Staging monitoring evidence</h1><p>Live observations of the database supporting the RegPilot pilot. Each snapshot checks every application table for presence, row-level security, restricted access from both client roles and permissions for the application.</p></header>
 <section className={styles.panel}><div className={styles.intro}><h2>Database observations</h2><a href="/monitoring-proof">Refresh history</a></div>
 {latest?<><p><strong>{latest.passed} of {latest.tests} checks passed</strong> across {latest.resources} tables. {age>=0&&age<=20*60000?'Current within the 15-minute schedule and 5-minute grace period.':'Collection is overdue.'}</p><p>Recorded span in this view: {Math.floor((latest.collected_at.getTime()-first!.collected_at.getTime())/60000)} minutes. Identical fingerprints indicate the same recorded control states.</p>
 <div className={styles.scroll}><table><thead><tr><th>Captured (UTC)</th><th>Passed / tested</th><th>Change from prior snapshot</th><th>Receipt</th></tr></thead><tbody>{samples.map((s,i)=><tr key={s.id}><td>{s.collected_at.toISOString().replace('T',' ').slice(0,19)}</td><td>{s.passed} / {s.tests}</td><td>{!samples[i+1]?'First shown':s.fingerprint===samples[i+1].fingerprint?'Same states':'Changed'}</td><td>{s.id}</td></tr>)}</tbody></table></div></>:<p>No staging observations are available in this environment.</p>}</section>
 <section className={styles.panel}><h2>Scope of the evidence</h2><p>These observations cover RegPilot’s own staging database. Customer instruments, laboratory decisions and AI provider accounts require separate, authorised source receipts.</p><a href="/team/operations?view=connections">Open workspace connections</a></section></main>;
}
