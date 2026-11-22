import {unstable_cache} from 'next/cache';
import {publicDirectory} from '../../lib/connectors/marketplace';
import {recordCatalogue} from '../../lib/connectors/record-catalogue';
import styles from './directory.module.css';

export const runtime='nodejs',dynamic='force-dynamic';
export const metadata={title:'Integration directory · RegPilot AI'};
const catalogue=unstable_cache(async()=>({entries:await publicDirectory(),checkedAt:new Date().toISOString()}),['regpilot-public-provider-directory-v1'],{revalidate:300});
type Query=Record<string,string|string[]|undefined>;
function value(q:Query,key:string){return typeof q[key]==='string'?q[key].slice(0,120).trim():'';}
const pageSize=25;

export default async function Directory({searchParams}:{searchParams:Promise<Query>}){
 const q=await searchParams,term=value(q,'q'),auth=value(q,'auth');
 const data=await catalogue().catch(()=>null);
 const entries=data?.entries??[],types=[...new Set(entries.map(item=>item.auth))].sort();
 const matches=entries.filter(item=>(!auth||item.auth===auth)&&[item.name,item.slug,item.category].some(v=>v.toLowerCase().includes(term.toLowerCase())));
 const pages=Math.max(1,Math.ceil(matches.length/pageSize)),number=Math.min(pages,Math.max(1,Number.parseInt(value(q,'page'),10)||1));
 const link=(p:number)=>'/integration-directory?'+new URLSearchParams({q:term,auth,page:String(p)});
 return <main className={styles.main}>
  <nav className={styles.nav} aria-label="Directory navigation"><a href="/">RegPilot AI</a><a href="/monitoring-proof">Staging monitoring evidence</a><a href="/integration-benchmark">500-integration benchmark</a><a href="/team/developers">Company integrations</a><a href="/team/developers#source-verification">Customer source verification</a></nav>
  <header className={styles.header}><h1>Integration directory</h1><p>Find a system, check how it connects and see which evidence RegPilot can collect.</p></header>
  <section className={styles.panel} aria-labelledby="providers"><div className={styles.intro}><div><h2 id="providers">Provider catalogue</h2>{data&&<p>{entries.length.toLocaleString('en-GB')} providers · {entries.filter(e=>e.auth==='API_KEY').length.toLocaleString('en-GB')} list API-key setup</p>}</div><a href={link(number)}>Refresh catalogue</a></div>
   <p>Listings come from Nango. Evidence monitoring requires an authorised workspace connection and a deployed sync model or a RegPilot collector.</p>
   {data?<><form className={styles.form} method="get" action="/integration-directory"><label>Provider or category<input type="search" name="q" defaultValue={term} maxLength={120} placeholder="e.g. OpenAI, accounting, laboratory"/></label>
    <label>Authentication<select name="auth" defaultValue={auth}><option value="">All methods</option>{types.map(t=><option key={t}>{t}</option>)}</select></label><button type="submit">Search providers</button></form>
    <p>{matches.length.toLocaleString('en-GB')} matching providers · Catalogue checked {data.checkedAt.slice(0,16).replace('T',' ')} UTC</p>
    {matches.length>0?<div className={styles.scroll}><table><thead><tr><th scope="col">Provider</th><th scope="col">Authentication</th><th scope="col">Category</th></tr></thead><tbody>{matches.slice((number-1)*pageSize,number*pageSize).map(e=><tr key={e.slug}><td><a href={e.docs??'https://nango.dev/docs/api-integrations/'+e.slug} rel="noreferrer" target="_blank">{e.name}</a></td><td>{e.auth}</td><td>{e.category||'Unlisted'}</td></tr>)}</tbody></table></div>:<p>Try another provider name or authentication method. <a href="/integration-directory">Clear filters</a></p>}
    {pages>1&&<nav className={styles.pages} aria-label="Catalogue pages">{number>1&&<a href={link(number-1)}>Previous</a>}<span>Page {number} of {pages}</span>{number<pages&&<a href={link(number+1)}>Next</a>}</nav>}</>:<p role="status">The provider catalogue is unavailable. Use Refresh catalogue to try again.</p>}
  </section>
  <div className={styles.grid}><section className={styles.panel}><h2>Pharmaceutical evidence</h2><h3>OPC UA temperature instruments</h3><p>Read a configured instrument on your site network and capture its serial, unit, timestamp, limits and calibration document fingerprint. <a href="/instrument-bridge/collect.py" download>Download the Python reader</a> and <a href="/instrument-bridge/example.json" download>example configuration</a>. <a href="/instrument-bridge/deliver.py" download>Download the delivery tool</a> · <a href="/instrument-bridge/setup.txt">Setup and manual submission</a>.</p><h3>UbiBot</h3><p>Read a physical logger by channel and serial. Each sample is checked against its age, temperature limits and independently reviewed calibration certificate.</p><a href={recordCatalogue.UBIBOT.docs}>UbiBot channel API</a><h3>Benchling</h3><p>Trace an assay result to its notebook entry, assigned reviewer and recorded decision. A quality team can follow up on a missing or superseded review.</p><a href={recordCatalogue.BENCHLING.docs}>Benchling entry API</a></section>
   <section className={styles.panel}><h2>Connect your AI</h2><p>Connect an OpenAI project or an approved private model server directly. An administrator can verify the model and link it to AI Studio. Hosted OpenAI and Anthropic connections are also supported.</p><a href="/ai">Open AI Studio</a><h3>Use your own client</h3><p>The private plugin provides read-only access to the controls, tasks and reviewed regulatory sources granted to its credential. An Action schema is available for compatible private GPTs.</p><p><a href="/api/v1/mcp/plugin">Download private plugin</a> · <a href="/api/v1/chatgpt">Open GPT Action schema</a></p></section></div>
 </main>;
}
