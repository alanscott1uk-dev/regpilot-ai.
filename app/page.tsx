const modules = [
  { name: "Obligation register", detail: "Track regulatory requirements, owners and due dates" },
  { name: "Evidence library", detail: "Link documents and approvals to obligations" },
  { name: "Audit readiness", detail: "Review outstanding actions and export evidence" },
  { name: "AI review assistant", detail: "Draft suggestions for qualified human approval" }
];
export default function Home() {
  return <main style={{maxWidth:960,margin:"0 auto",padding:"48px 24px"}}>
    <div style={{fontSize:14,color:"#4361a8",fontWeight:700}}>REGPILOT AI · PROTOTYPE</div>
    <h1 style={{fontSize:44,marginBottom:8}}>Compliance, under control.</h1>
    <p style={{fontSize:18,color:"#526078",lineHeight:1.6}}>A foundation for obligation tracking, evidence management and audit preparation in regulated businesses.</p>
    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:18,marginTop:36}}>
      {modules.map(m=><article key={m.name} style={{background:"white",padding:24,borderRadius:14,border:"1px solid #e1e7f0"}}>
        <div style={{fontSize:12,color:"#6d7790",fontWeight:700}}>Planned</div>
        <h2 style={{fontSize:20}}>{m.name}</h2><p style={{lineHeight:1.5,color:"#526078"}}>{m.detail}</p>
      </article>)}
    </section>
    <p style={{marginTop:36,fontSize:13,color:"#69768a"}}>Demonstration interface only. No customer data storage or automated compliance determinations.</p>
  </main>;
}
