import {type PilotReceipt} from '../../../lib/pilot-receipt';
import RepositoryResults from '../developers/repository-results';

import styles from './trials.module.css';

export default function ReceiptHandoff({receipt,organizationId,trialId}:{receipt:PilotReceipt;organizationId:string;trialId:string}){
 return <section className={styles.receipt} aria-label="Attached GitHub receipt"><h3>Attached GitHub inventory read</h3>
 <dl className={styles.facts}><div><dt>Collected at</dt><dd><time dateTime={receipt.checkedAt}>{receipt.checkedAt.replace('T',' ').replace('Z',' UTC')}</time></dd></div>
 <div><dt>Repositories read</dt><dd>{receipt.count}</dd></div><div><dt>Action</dt><dd>{receipt.action}</dd></div></dl>
 <RepositoryResults checks={receipt.checks} health={receipt.providerHealth}/>
 <details><summary>Receipt identity</summary><dl className={styles.identity}><dt>Worker receipt</dt><dd>{receipt.id}</dd>
 <dt>Inventory digest</dt><dd>{receipt.digest}</dd><dt>Collector revision</dt><dd>{receipt.revision??'Unavailable'}</dd></dl></details>
 <a href={'/team/trials?'+new URLSearchParams({organizationId,trialId})+'#trial-'+trialId}>Assessor link to this trial and receipt</a>
 </section>;
}
