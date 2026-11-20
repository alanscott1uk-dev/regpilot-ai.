const {createHash}=require("node:crypto");
const cases=require("./cases.cjs"), bodies=require("./corpus.cjs");
const check=(metric,judge)=>({type:"javascript",metric,value:output=>{
  const result=JSON.parse(output),problem=judge(result);
  return {pass:!problem,score:problem?0:1,reason:problem||"Passed"};
}});
module.exports={
  description:"RegPilot UK publication research on a fixed synthetic corpus",
  sharing:false,prompts:["{{question}}"],providers:["file://provider.cjs"],
  tests:cases.map(c=>({
    description:c.id,vars:{question:c.question,...(c.nation?{nation:c.nation}:{}),...(c.outage?{outage:true}:{}),...(c.unavailable?{unavailable:c.unavailable}:{})},
    assert:[
      check("Disposition",r=>r.status!==(c.status||"matched") && "Unexpected research status: "+r.status),
      ...(c.unavailable?[check("PartialOutage",r=>!c.unavailable.every(id=>r.checked.some(s=>s.id===id && s.status==="unavailable")) && "Unavailable source was silently omitted")]:[]),
      ...(c.sources?[check("SourceRecallAt3",r=>!c.sources.some(id=>r.checked.slice(0,3).some(s=>s.id===id)) && "Expected source absent from first three reads"),
        check("EvidenceSourcePrecision",r=>(!r.citations.length || r.citations.some(q=>!c.sources.includes(q.sourceId))) && "Missing or off-topic cited source")]:[]),
      check("ReceiptIntegrity",r=>{
        for (const q of r.citations) {
          const text=bodies[q.sourceId];
          if (!text || text.slice(q.start,q.end)!==q.quote || createHash("sha256").update(text).digest("hex")!==q.documentHash)
            return "Evidence differs from the original source span";
        }
        for (const p of r.answer.points) {
          const q=r.citations.find(x=>x.id===p.citationId && x.sourceId===p.sourceId);
          if (!q || p.start<q.start || p.end>q.end || bodies[p.sourceId].slice(p.start,p.end)!==p.text) return "Answer outside its own citation";
        }
      }),
      ...(c.facts?[check("AnswerFact",r=>(!r.answer.points.length || !r.answer.points.every(p=>c.sources.includes(p.sourceId) && c.facts.some(f=>p.text.includes(f)))) && "Expected answer fact absent")]:[]),
      ...(c.abstain?[check("Abstention",r=>r.answer.points.length>0 && "Produced an answer without supporting information")]:[]),
      ...(c.forbidden?[check("TerritorialScope",r=>[...r.citations.map(q=>q.quote),...r.answer.points.map(p=>p.text)].some(t=>c.forbidden.some(f=>t.includes(f))) && "Included evidence from another territory")]:[])
    ]
  }))
};
