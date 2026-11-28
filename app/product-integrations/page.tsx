import {productActionUrl,productSearch,productTotal} from '../../lib/connectors/product-recipes';
import catalogue from '../../public/cloud-controls/catalogue.json';
import styles from '../integration-directory/directory.module.css';
export const metadata={title:'Hourly customer integrations · RegPilot AI'};
export default async function ProductDirectory({searchParams}:{searchParams:Promise<{q?:string;page?:string}>}){
 const input=await searchParams,q=typeof input.q==='string'?input.q.slice(0,100):'',matches=productSearch(q);
 const pages=Math.max(1,Math.ceil(matches.length/40)),page=Math.min(pages,Math.max(1,Number.parseInt(input.page??'1',10)||1));
 const link=(n:number)=>'/product-integrations?'+new URLSearchParams({q,page:String(n)});
 return <main className={styles.main}><nav className={styles.nav}><a href="/integration-directory">Integration directory</a><a href="/team/developers#product-monitors">Connect a customer account</a><a href="/monitoring-proof">Monitoring evidence</a><a href="/product-monitors/setup.txt">Hosted project setup</a></nav>
 <header className={styles.header}><h1>Hourly customer integrations</h1><p>{productTotal.toLocaleString('en-GB')} distinct products have a version-pinned, authenticated inventory read. For actions that return the required fields, administrators can map identity, device, backup, calibration, laboratory, training, change approval, supplier payment or equipment checks. Preview the results on the authorised sample before enabling hourly collection.</p></header>
 <section className={styles.panel}><h2>Product reads</h2><form><label>Search products and actions <input name="q" defaultValue={q} maxLength={100}/></label> <button>Search</button></form>
 <p>{matches.length} matching reads · Page {page} of {pages}</p><ul>{matches.slice((page-1)*40,page*40).map(r=><li key={r.app+'/'+r.action}><strong>{r.name}</strong> · <a href={productActionUrl(r)}>{r.action}</a> · {r.version} · {r.auth}</li>)}</ul>
 <nav className={styles.nav}>{page>1&&<a href={link(page-1)}>Previous</a>}{page<pages&&<a href={link(page+1)}>Next</a>}</nav></section>
 <section className={styles.panel}><h2>Cloud controls</h2><p>The Prowler {catalogue.version} collector can schedule {catalogue.uniquePolicies.toLocaleString('en-GB')} distinct cloud policies across {Object.keys(catalogue.providers).length} platforms. Each customer selects a provider, authorised account and applicable checks. A policy needs an observed resource decision to count as executed.</p>
 <p><a href="/cloud-controls/guide.txt">Install the hourly cloud collector</a> · <a href="/cloud-controls/catalogue.json">Inspect the policy IDs</a> · <a href="/cloud-controls/verification.json">Inspect the executed fixture evidence</a></p></section></main>;
}
