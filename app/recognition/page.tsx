import Link from "next/link";
import {buildRecognitionRegister} from "../../lib/recognition/registry.mjs";
import styles from "./recognition.module.css";
export const metadata={title:"RegPilot | Independent assurance status",description:"A verifiable distinction between planned RegPilot assessments, independent certifications, MHRA regulatory advice, customer validation and government framework eligibility."};
export default function RecognitionPage(){
 const registry=buildRecognitionRegister();
 return <main className={styles.shell}>
  <header className={styles.nav}><Link href="/" className={styles.brand}>R <b>RegPilot AI</b></Link><Link href="/team/recognition" className={styles.internal}>Private assurance workspace</Link></header>
  <section className={styles.hero}>
   <span className={styles.eyebrow}>INDEPENDENT ASSURANCE / PUBLIC STATUS</span>
   <h1>Claims you can check.<br/><em>Not badges you have to trust.</em></h1>
   <p>Our ambition is independent AI, cybersecurity and pharmaceutical-quality assurance. This page distinguishes planned assessments from certifications actually awarded by independent bodies.</p>
   <p className={styles.heroNotice}>RegPilot does not claim MHRA product approval, UK government endorsement or approval of AI-generated regulatory decisions.</p>
  </section>
  <div className={styles.metrics}><div><strong>{registry.verified}</strong><span>Externally evidenced recognitions</span></div><div><strong>{registry.pending}</strong><span>Not yet independently evidenced</span></div></div>
  <section className={styles.statement}><h2>What recognition actually means</h2><p>ISO certificates apply to the specified management system and accredited audit scope. MHRA advice is regulatory guidance, not endorsement. Pharmaceutical computerised-system validation depends on each licensee’s intended use. G-Cloud admission, when awarded, is procurement eligibility rather than government approval of the product.</p></section>
  <section aria-label="Recognitions and evidence" className={styles.grid}>
   {registry.records.map(r=><article key={r.id} className={styles.card}>
    <div className={styles.cardTop}><span>{r.kind.replaceAll("_"," ")}</span><span className={styles.pending}>Not verified</span></div>
    <h3>{r.title}</h3><p>{r.purpose}</p><p className={styles.note}>{r.publicNote}</p>
    <div className={styles.proof}>{r.status==="EXTERNALLY_EVIDENCED"?
      <><p>Issuer: {r.issuer}</p><p>Scope: {r.scope}</p><a href={r.verificationUrl||"#"} rel="noopener noreferrer" target="_blank">Check independent issuer record</a></>:
      <p>No current independently verified award, admission or validation is recorded. We do not display a certificate or endorsement badge.</p>}</div>
   </article>)}
  </section>
  <section className={styles.sources}><h2>Check the issuing authorities</h2><p>These links describe the external schemes. Linking to a scheme is not evidence RegPilot has obtained it.</p>
   <div><a href="https://www.gov.uk/government/groups/mhra-innovation-office">MHRA Innovation Office</a><a href="https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity">MHRA GxP data integrity</a><a href="https://www.ukas.com/">UKAS</a><a href="https://www.ncsc.gov.uk/cyberessentials/overview">Cyber Essentials</a><a href="https://ico.org.uk/for-organisations/advice-and-services/certification-schemes/">ICO certification</a><a href="https://www.applytosupply.digitalmarketplace.service.gov.uk/suppliers/supply">Government Digital Marketplace</a></div>
  </section>
  <footer>{registry.notice} Evidence status is reviewed before publication. No compliance certificate is asserted by this page.</footer>
 </main>;
}
