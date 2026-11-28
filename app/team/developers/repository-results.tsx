import {settingGuidance,type PilotReceipt} from '../../../lib/pilot-receipt';

import styles from './repository-results.module.css';

export default function RepositoryResults({checks,health}:{checks:PilotReceipt['checks'];health:boolean|null}){
 return <>{health===false&&<p className={styles.warning} role="status">The inventory read succeeded. Pipedream also reported a connection-health warning. Check the next scheduled read. Renew the grant if collection reports rejected credentials.</p>}
 {checks.length>0?<table className={styles.results}><caption>Repository checks on this read</caption>
 <thead><tr><th scope="col">Setting</th><th scope="col">Result</th><th scope="col">Interpretation</th></tr></thead>
 <tbody>{checks.map(c=><tr key={c.id}><td>{c.label}</td><td><span className={styles.result} data-result={c.status}>{c.status}</span></td><td>{settingGuidance(c.id,c.status)}</td></tr>)}</tbody></table>:<p>No repository checks were recorded on this read.</p>}</>;
}
