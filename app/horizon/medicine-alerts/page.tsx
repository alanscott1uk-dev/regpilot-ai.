import {medicineAlertRouting} from '../../../lib/server/deployed-medicine-alert-routing';
import css from '../../integration-directory/directory.module.css';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=120;
export const metadata={title:'Medicines alert routing · RegPilot'};
export default async function MedicineAlerts(){
 const report=await medicineAlertRouting().catch(()=>null),counts=report?.counts;
 return <main className={css.main}><nav className={css.nav}><a href="/horizon?view=scottish-medicines-only">Scottish medicines-only view</a><a href="/horizon/coverage">Publisher coverage</a></nav>
 <header className={css.header}><h1>Where Scottish wholesale alerts go</h1><p>For a wholesaler handling human medicines, compare the main review list and the separate weekly device circulars with the MHRA’s own publication categories.</p></header>
 {report?<><section className={css.panel}><h2>Current publisher sample</h2><p>{report.method} Mixed updates stay in the main view. An operator still needs to check the affected products, stock and site activities.</p>
 {counts?<><p><strong>{counts.kept} of {counts.medicines} medicines notices</strong> reached the medicines review list. <strong>{counts.listedSeparately} of {counts.devices} device notices</strong> are available in the separate list.</p>
 <p>The broader wholesale view included {counts.devicesInBroadView} of these device notices in its main list. The medicines-only view included {counts.devicesInMedicinesView}. {counts.missing} sampled notices were missing from collection.</p></>:<p>Both publisher indexes and a measurable sample are needed for totals.</p>}
 <p>{report.unavailable} comparisons unavailable · {report.ambiguous.length} conflicting classifications · Checked {report.checkedAt.slice(0,16).replace('T',' ')} UTC</p><a href="/api/horizon/medicine-alerts">Open the source hashes and individual results</a></section>
 {report.indexes.map(index=><section key={index.category} className={css.panel}><h2>{index.label}</h2><p><a href={index.url}>MHRA category index</a> · {index.state==='READ'?index.rows.length+' selected':'Unavailable'}</p><div className={css.scroll}><table><thead><tr><th>Official publication</th><th>RegPilot destination</th></tr></thead><tbody>{index.rows.map(row=><tr key={row.url}><td><a href={row.url}>{row.title}</a></td><td>{report.ambiguous.includes(row.url)?'Conflicting publisher categories':row.destination}</td></tr>)}</tbody></table></div></section>)}</>:<p role="status">The current comparison is unavailable.</p>}</main>;
}
