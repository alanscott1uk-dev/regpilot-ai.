const fs=require("node:fs");
const cases=require("./cases.cjs");
const results=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).results.results;
const byId=new Map(results.map(row=>[row.testCase.description,row]));
if (byId.size!==cases.length || results.length!==cases.length) throw new Error("Incomplete research benchmark");
let candidateFirst=0, first=0, reciprocal=0, ranked=0, questions=0, grounded=0, points=0, abstained=0, abstentions=0;
for (const c of cases) {
  const row=byId.get(c.id), result=JSON.parse(row.response.output);
  if (c.sources) {
    ranked++;
    if(result.checked.some(s=>s.candidateRank===1 && c.sources.includes(s.id))) candidateFirst++;
    const i=result.checked.findIndex(s=>c.sources.includes(s.id));
    if (i===0) first++;
    if (i>=0) reciprocal+=1/(i+1);
  }
  if (c.facts) {
    questions++;
    points+=result.answer.points.length;
    grounded+=result.answer.points.filter(p=>c.sources.includes(p.sourceId) && c.facts.some(f=>p.text.includes(f))).length;
  }
  if (c.abstain) {abstentions++;if (!result.answer.points.length) abstained++;}
}
console.log("Expected source first before reading publications: "+candidateFirst+"/"+ranked);
console.log("Expected source first after checking the text: "+first+"/"+ranked+"; mean reciprocal rank: "+(reciprocal/ranked).toFixed(3));
console.log("Supported answer points: "+grounded+"/"+points+" across "+questions+" answerable cases; correct abstentions: "+abstained+"/"+abstentions);
if (results.some(row=>!row.success)) process.exitCode=1;
