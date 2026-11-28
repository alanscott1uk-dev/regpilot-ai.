import {settingGuidance,type PilotReceipt} from '../../../lib/pilot-receipt';

export default function RepositoryResults({checks,health}:{checks:PilotReceipt['checks'];health:boolean|null}){
 return <>{health===false&&<p role="status">The inventory read succeeded. Pipedream also reported a connection-health warning. Check the next scheduled read. Renew the grant if collection reports rejected credentials.</p>}
 {checks.length>0?<table><caption>Repository checks on this read</caption>
 <thead><tr><th scope="col">Setting</th><th scope="col">Result</th><th scope="col">Interpretation</th></tr></thead>
 <tbody>{checks.map(c=><tr key={c.id}><td>{c.label}</td><td>{c.status}</td><td>{settingGuidance(c.id,c.status)}</td></tr>)}</tbody></table>:<p>No repository checks were recorded on this read.</p>}</>;
}
