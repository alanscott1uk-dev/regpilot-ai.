import test from "node:test";
import assert from "node:assert/strict";
import {MockLanguageModelV3} from "ai/test";
import {groundProgramme,findProgrammePassages,type ImportDocument} from "../lib/programme/import";
import {generateProgramme} from "../lib/server/programme-model";
const id="123e4567-e89b-42d3-a456-426614174000";
const quote="Fictional widget staff must retain training records unless a documented exemption applies.";
const docs:ImportDocument[]=[{id,filename:"fictional.pdf",document:{version:"fixture",totalPages:1,pages:[{page:1,text:quote}],characters:quote.length,truncated:false,skippedPages:[],requiresVisualReview:true}}];
const proposal={title:"Retain fictional training records",description:quote,testProcedure:"Inspect dated records and confirm whether the stated exemption applies.",theme:"records",citations:[{evidenceId:id,page:1,quote}]};
test("programme controls have exact page/offset provenance and no effectiveness verdict",()=>{const r=groundProgramme({controls:[proposal]},docs),c=r.controls[0];assert.equal(c.citations[0].quote,docs[0].document.pages[0].text.slice(c.citations[0].start,c.citations[0].end));assert.equal(c.description,quote);assert.equal(r.documents[0].extractedPages,1);assert.equal((c as any).compliant,undefined);assert.match(r.warnings.join(" "),/not certified framework mappings/);});
for(const [name,edit] of Object.entries({invented:{quote:"All businesses must submit invented records within seven days."},wrongPage:{page:2},wrongFile:{evidenceId:"123e4567-e89b-42d3-a456-426614174001"},stitched:{quote:quote.slice(0,30)+" ... "+quote.slice(-30)}}))test("programme rejects "+name+" citations",()=>{const r=groundProgramme({controls:[{...proposal,citations:[{...proposal.citations[0],...edit}]}]},docs);assert.equal(r.controls.length,0);assert.equal(r.rejected,1);});
test("ambiguous text, unknown themes and repeated proposals are withheld",()=>{assert.equal(groundProgramme({controls:[proposal]},[{...docs[0],document:{...docs[0].document,pages:[{page:1,text:quote+quote}]}}]).controls.length,0);assert.equal(groundProgramme({controls:[{...proposal,theme:"ISO-certified"}]},docs).controls.length,0);assert.equal(groundProgramme({controls:[proposal,proposal]},docs).rejected,1);assert.throws(()=>groundProgramme({controls:Array(31).fill(proposal)},docs));});
test("search keeps conditions and incomplete extraction visible without declaring sufficiency",()=>{const r=findProgrammePassages([{...docs[0],document:{...docs[0].document,totalPages:2,truncated:true,skippedPages:[2]}}]);assert.equal(r.controls[0].citations[0].quote,quote);assert.equal(r.documents[0].truncated,true);assert.deepEqual(r.documents[0].skippedPages,[2]);assert.match(r.warnings[0],/reviewer/);});
test("programme model uses bounded structured output with no tools",async()=>{let calls=0;const model=new MockLanguageModelV3({doGenerate:async options=>{calls++;assert.equal(options.maxOutputTokens,6500);assert.equal(options.tools?.length||0,0);assert.match(JSON.stringify(options.prompt),/UNTRUSTED DATA/);assert.match(JSON.stringify(options.prompt),/negative statements/);return {content:[{type:"text",text:JSON.stringify({controls:[proposal]})}],finishReason:{unified:"stop",raw:undefined},usage:{inputTokens:{total:20,noCache:20,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:20,text:20,reasoning:undefined}},warnings:[]};}});assert.equal(groundProgramme(await generateProgramme(docs,model),docs).controls.length,1);assert.equal(calls,1);});
test("programme provider failure is not retried",async()=>{let calls=0;const model=new MockLanguageModelV3({doGenerate:async()=>{calls++;throw Error("fixture failure");}});await assert.rejects(()=>generateProgramme(docs,model));assert.equal(calls,1);});

test('the published catalogue counts distinct families and opens source-backed controls in every profile',async()=>{
 const m=await import('../lib/audit-catalogue/catalogue');
 const totals=m.catalogueTotals;
 assert.ok(totals.families>=300);
 assert.equal(totals.families,totals.mappedFamilies+totals.uk+totals.eu+totals.preparationFamilies);
 assert.ok(totals.profiles>totals.families);
 const first=m.searchFrameworks('','',1),all=Array.from({length:first.pages},(_,i)=>m.searchFrameworks('','',i+1).rows).flat();
 assert.equal(new Set(all.map(v=>v[0].family)).size,totals.families);
 assert.equal(all.flat().length,totals.profiles);
 for(const p of all.flat()){
   const ids=m.controlIds(p);assert.equal(ids.length,p.count);assert.ok(p.count>0);
   const c=m.getAuditControl(p,ids[0])!;assert.ok(c.name&&c.reference&&(c.url.startsWith('http')||p.source==='preparation'&&c.url.startsWith('/audit-programmes/')));
   for(const id of ids)assert.ok(m.referenceFor(p,id));
   assert.equal(m.getAuditControl(p,'__proto__'),undefined);
   if(p.source==='uk'||p.source==='eu'){
     const prepared=m.frameworkPage(p,'',1).rows.filter(r=>r.evidence.length&&!r.suggestedEvidence);
     assert.equal(prepared.length,p.sampleCount);
     assert.ok(prepared.every(r=>r.sourcePassage&&r.sourcePassage.length>=24));
   }
 }
 const hit=m.searchFrameworks('HITRUST','',1);assert.equal(hit.total,1);assert.deepEqual(hit.rows[0].map(p=>p.id),['hitrust-e1','hitrust-i1','hitrust-r2']);
 for(const profile of hit.rows[0]){assert.equal(profile.source,'preparation');assert.equal(m.controlIds(profile).length,profile.count);assert.ok(m.getAuditControl(profile,'RP-identity')!.evidence.length);}
 assert.ok(m.searchFrameworks('PCI DSS','',1).rows[0].length>1);
 const p=m.getProfile('general-iso-27001-2022')!,c=m.frameworkPage(p,'GOV-02',1).rows.find(r=>r.id==='GOV-02');
 assert.ok(c?.objectives.length);
 const trial=m.getProfile('eu-reg-2014-536')!,protocol=m.getAuditControl(trial,'47')!;
 assert.match(protocol.name,/good clinical practice/i);assert.match(protocol.sourcePassage!,/sponsor of a clinical trial/i);
 assert.ok(protocol.url.endsWith('#art_47'));assert.equal(protocol.suggestedEvidence,false);
 const modification=m.getAuditControl(trial,'18')!;
 assert.match(modification.sourcePassage!,/shall assess/i);
 assert.match(modification.evidence[0].name,/completed assessment/i);assert.equal(modification.suggestedEvidence,true);
 assert.equal(m.frameworkPage(p,'impossibletermxyz',1).rows.length,0);
});

test('MyCSF keeps scoped boundaries in the requirement revision and rejects partial or ambiguous lists',async()=>{
 const {myCsfApi}=await import('../lib/mycsf/api');
 const detail={BUID:'FAKE-1','OBJ ID':123,TYPE:'e1',STATEMENT:'Fictional evidence requirement.',SCOPE:'Test site A',LEVEL:'one','BASELINE CONTROL':true};
 let listing:unknown=[{Id:123,Name:'Fictional assessment',Type:'e1'}],requests=0;
 const api=myCsfApi({username:'test',key:'test'},async url=>{
   requests++;
   return Response.json(new URL(String(url)).pathname.includes('assessmentdetailed')?[detail]:listing);
 });
 const first=await api.snapshot(7,123,'e1');
 detail.SCOPE='Test site B';const second=await api.snapshot(7,123,'e1');
 assert.notEqual(second.rows[0].hash,first.rows[0].hash);
 detail.TYPE='e1 or r2';
 await assert.rejects(()=>api.snapshot(7,123,'e1'));
 listing={Items:[],Total:1};await assert.rejects(()=>api.assessments(7));
 const partial=myCsfApi({username:'test',key:'test'},async url=>Response.json(new URL(String(url)).search
  ?[{Id:2,Name:'Two'}]:{Items:[{Id:1,Name:'One'}],Total:3,Next:'?page=2'}));
 await assert.rejects(()=>partial.assessments(7));
 listing={Items:[],Total:'invalid'};await assert.rejects(()=>api.assessments(7));
 listing={Items:[],Next:'https://fictional.example.invalid/next'};
 const before=requests;await assert.rejects(()=>api.assessments(7));assert.equal(requests,before+1);
});

test('first-import suggestions distinguish requirement IDs, linked control tests and unrelated files',async()=>{
 const {suggestReviewedEvidence}=await import('../lib/mycsf/evidence-search');
 const row={buid:'FAKE.12',domain:'Access',text:'Independently reconcile privileged account grants.',applicability:'',reference:'',hash:'x'};
 const file={id:'a',filename:'sample.pdf',task:'Quarterly records',test:'',procedure:'',taskId:'demo'};
 const hits=suggestReviewedEvidence([row],[{...file,filename:'FAKE.12.pdf'},{...file,id:'b',test:'Privileged access controls',procedure:'Reconcile account grants'},
  {...file,id:'c',filename:'FAKE.123.pdf'},{...file,id:'d',filename:'FAKEx12.pdf'},{...file,id:'e',test:'Buildings',procedure:'Check inspection dates'}]);
 assert.deepEqual(hits.map(h=>h.id),['a','b']);assert.ok(hits[0].exact);assert.ok(hits[1].matched.includes('privileged'));assert.equal(hits[1].test,'Privileged access controls');
});

test('joint audit matrix carries both published references for a shared control and rejects a preparation profile',async()=>{
 const {GET}=await import('../app/api/audit-programmes/crosswalk/route');
 const {referenceFor,getProfile}=await import('../lib/audit-catalogue/catalogue');
 const {csvEscape}=await import('../lib/obligations.mjs');
 const first='general-iso-27001-2022',second='general-aicpa-tsc-2017';
 const download=(other:string)=>GET(new Request('https://regpilot.example/api/audit-programmes/crosswalk?'+new URLSearchParams({first,second:other})));
 assert.equal(download(first).status,400);
 assert.equal(download('hitrust-e1').status,400);
 const id='GOV-02',refs=[first,second].map(key=>referenceFor(getProfile(key)!,id));
 assert.ok(refs.every(Boolean));
 const response=download(second);assert.equal(response.status,200);
 const content=await response.text();assert.ok(content.includes(refs.map(csvEscape).join(',')));
});
