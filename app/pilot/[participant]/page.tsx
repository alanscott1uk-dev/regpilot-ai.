import {notFound} from 'next/navigation';
import css from '../../integration-directory/directory.module.css';
export const dynamic='force-dynamic';
export default async function PilotEntry({params}:{params:Promise<{participant:string}>}){
 const {participant}=await params;
 if(!['operator','assessor'].includes(participant)||process.env.VERCEL_ENV!=='preview'||process.env.REGPILOT_STAGING_PREFLIGHT!=='true')notFound();
 const operator=participant==='operator',release=process.env.VERCEL_GIT_COMMIT_SHA;
 const query=new URLSearchParams({participant,...(release&&/^[a-f0-9]{40}$/.test(release)?{release}:{})});
 return <main className={css.main}><nav className={css.nav}><a href="/integration-benchmark">Monitoring evidence</a></nav>
 <header className={css.header}><h1>{operator?'First-time operator trial':'Independent assessment'}</h1>
 <p>{operator?'Measure the time from setting up a connection to exporting the reading that needs review.':'Review workspace isolation, recovery and an authorised stock decision. Record each finding against the tested release.'}</p></header>
 <section className={css.panel}><h2>{operator?'Your assignment':'Assessment scope'}</h2>
 {operator?<ol><li>Sign in to your approved test workspace and start the operator timer.</li><li>Connect the public DailyMed label in Operations to a test control. Use version 34 as the older review baseline for this exercise and collect the current label.</li><li>Identify the failed check, the affected control and its owner. Export the exact reading. Record each time you need help, then stop the timer.</li></ol>:
 <ol><li>Use assigned test workspaces with different memberships. Record the expected access and observed result for the same test record before and after access is withdrawn.</li><li>Trace a collection failure through credential replacement and the subsequent verified reading. Inspect the restore drill separately and record its environment and limitations.</li><li>Open the quality case from your own account and retrieve the calibrated reading, stock evidence and signed disposition. Mark unavailable evidence as unobserved.</li></ol>}
 <p>Use approved test data. Start the timer when you are ready to perform the first task. Keep the trial open while you work in another tab.</p>
 <a href={'/team/trials?'+query}>Open {operator?'operator':'assessor'} trial →</a></section>
 {release&&/^[a-f0-9]{40}$/.test(release)&&<section className={css.panel}><h2>Release evidence</h2><p>Commit <code>{release.slice(0,12)}</code></p><a href={'https://github.com/alanscott1uk-dev/regpilot-ai./commit/'+release+'/checks'}>Build, isolation and disposable restore checks</a></section>}
 </main>;
}
