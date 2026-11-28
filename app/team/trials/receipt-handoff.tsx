import {type PilotReceipt} from '../../../lib/pilot-receipt';
import RepositoryResults from '../developers/repository-results';

export default function ReceiptHandoff({receipt,organizationId,trialId}:{receipt:PilotReceipt;organizationId:string;trialId:string}){
 return <section aria-label="Attached GitHub receipt"><h3>Attached GitHub inventory read</h3>
 <p><time dateTime={receipt.checkedAt}>{receipt.checkedAt.replace('T',' ').replace('Z',' UTC')}</time> · {receipt.count} repositories · {receipt.action}</p>
 <RepositoryResults checks={receipt.checks} health={receipt.providerHealth}/>
 <details><summary>Receipt identity</summary><dl><dt>Worker receipt</dt><dd>{receipt.id}</dd>
 <dt>Inventory digest</dt><dd>{receipt.digest}</dd><dt>Collector revision</dt><dd>{receipt.revision??'Unavailable'}</dd></dl></details>
 <a href={'/team/trials?'+new URLSearchParams({organizationId,trialId})+'#trial-'+trialId}>Assessor link to this trial and receipt</a>
 </section>;
}
