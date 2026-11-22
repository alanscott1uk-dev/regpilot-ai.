import test from "node:test";
import assert from "node:assert/strict";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
import {loadOfficialWeb,officialMainText,OfficialWebUnavailable} from "../lib/server/official-web-source";
import {loadGovUkHtml} from "../lib/server/govuk-html-source";
const source=REGULATORY_SOURCES.find(s=>s.id==="ico-accountability")!;
const html=(extra="")=>`<html><nav>Outside navigation</nav><main><h1>${source.heading}</h1><p>${"Fictional accountability guidance. ".repeat(10)}</p>${extra}</main><footer>Outside footer</footer></html>`;
const response=(body=html(),status=200,type="text/html")=>new Response(body,{status,headers:{"content-type":type,"last-modified":"Mon, 01 Jan 2024 00:00:00 GMT"}});
test("inspectorate answers use only the identified author's article and exclude reader comments",async()=>{
 const source=REGULATORY_SOURCES.find(s=>s.id==="mhra-temperature-mapping")!;
 const wording="Fictional article paragraph about a storage area. ".repeat(7).trim();
 const article='<article><header><h1>'+source.heading+'</h1></header><div class="entry-content"><p>'+wording+'</p></div></article>';
 const comments='<section id="comments"><p>Unverified reader suggestion.</p></section>';
 const read=(content:string)=>loadOfficialWeb(source,async()=>response("<main>"+content+"</main>"));
 assert.equal((await read(article+comments)).text,wording);
 for(const changed of [article+article,article.replace("entry-content","reader-content"),article.replace(source.heading!,"Other title"),article.replace("</p>","</p>"+comments),article.replace("</div>",""),article.replace("</div>",'</div><div class="entry-content">Second</div>')])
  await assert.rejects(()=>read(changed),OfficialWebUnavailable);
});
test("curated official pages retain main text only and do not invent publication dates",async()=>{
 const result=await loadOfficialWeb(source,async(url,options)=>{assert.equal(url,source.url);assert.equal(options?.method,"GET");assert.equal(options?.redirect,"error");assert.equal(options?.cache,"no-store");return response(html('<nav>MENU SECRET</nav><script>RAW SCRIPT</script><aside>ASIDE</aside><form>FORM</form><!-- COMMENT --><p>A &amp; B &#xA3;5</p>'));});
 assert.match(result.text,/A & B £5/);assert.doesNotMatch(result.text,/Outside|MENU|RAW|ASIDE|FORM|COMMENT|<p>/);assert.equal(result.updatedAt,null);assert.equal(result.revisionAt,null);assert.equal(result.url,source.url);
});
test("official retrieval refuses arbitrary targets before network access",async()=>{
 for(const changed of [{...source,url:"http://127.0.0.1/"},{...source,id:"unknown"},{...source,path:"/different"}])await assert.rejects(()=>loadOfficialWeb(changed,async()=>{assert.fail("must not fetch");}),OfficialWebUnavailable);
});
test("semantic main divs and commented templates do not change article boundaries",()=>{
 const text=html('<div><div>Nested article material</div></div>');
 const converted='<!-- <main><h1>commented template</h1></main> -->'+text.replace('<main>','<div role="main">').replace('</main>','</div>');
 assert.equal(officialMainText(converted,source.heading!),officialMainText(text,source.heading!));
 assert.throws(()=>officialMainText(converted.replace('</div></html>','</html>').replace('</div><footer>','<footer>'),source.heading!),OfficialWebUnavailable);
});
test("official source failures and changed page identities never become valid snapshots",async()=>{
 for(const value of [response(html(),403),response(html(),200,"application/json"),response(""),response(html().replace(/main/g,"article")),response(html()+html()),response(html().replace(source.heading!,"Page not found")),response(html().replace('</main>','<h1>Another title</h1></main>')),response(`<main><h1>${source.heading}</h1>Too short</main>`),response(html("x".repeat(60000))),response(html("x".repeat(1000000)))])await assert.rejects(()=>loadOfficialWeb(source,async()=>value),OfficialWebUnavailable);
 await assert.rejects(()=>loadOfficialWeb(source,async()=>{throw new TypeError("redirect blocked");}),OfficialWebUnavailable);
 const moved=response();Object.defineProperty(moved,"url",{value:"https://example.invalid/moved"});await assert.rejects(()=>loadOfficialWeb(source,async()=>moved),OfficialWebUnavailable);
 assert.throws(()=>officialMainText('<main><h1>Verify you are human</h1>'+"x".repeat(250)+'</main>',"Verify you are human"),OfficialWebUnavailable);
});

test("GOV.UK API fallback accepts only exact bounded official HTML text without claiming publication dates",async()=>{
 const source=REGULATORY_SOURCES.find(s=>s.id==="uk-data-protection")!;
 let called=0;
 const body='<html><main id="content"><h1>'+source.title+'</h1><div><p>'+("Fictional UK publication body and controlled subsection. ").repeat(12)+'</p></div></main><footer>Ignore footer</footer></html>';
 const result=await loadGovUkHtml(source,async(url,opts)=>{
  called++;assert.equal(url,"https://www.gov.uk"+source.path);
  assert.equal(opts?.redirect,"error");assert.equal(opts?.method,"GET");assert.equal(opts?.cache,"no-store");
  return new Response(body,{headers:{"content-type":"text/html"}});
 });
 assert.equal(called,1);assert.equal(result.id,source.id);assert.equal(result.revisionAt,null);
 assert.equal(result.updatedAt,null);assert.match(result.text,/Fictional UK publication/);
 assert.doesNotMatch(result.text,/Ignore footer/);
});
test("GOV.UK fallback rejects moved, mismatched, oversized and arbitrary pages",async()=>{
 const source=REGULATORY_SOURCES.find(s=>s.id==="uk-data-protection")!;
 const valid='<main><h1>'+source.title+'</h1>'+("Fictional public text ").repeat(30)+'</main>';
 const mocked=(body:string,status=200,kind="text/html")=>new Response(body,{status,headers:{"content-type":kind}});
 for(const changed of [{...source,path:"/../../internal"},{...source,path:"/api//secrets"},{...source,provider:"OFFICIAL_WEB" as const}])
  await assert.rejects(()=>loadGovUkHtml(changed,async()=>assert.fail("No network")),OfficialWebUnavailable);
 for(const response of [mocked(valid,403),mocked(valid,200,"application/json"),mocked(valid.replace(source.title,"Unrelated publication")),mocked("<html>No main</html>"),mocked(valid+"x".repeat(1024*1024))])
  await assert.rejects(()=>loadGovUkHtml(source,async()=>response),OfficialWebUnavailable);
 const moved=mocked(valid);Object.defineProperty(moved,"url",{value:"https://www.gov.uk/different"});
 await assert.rejects(()=>loadGovUkHtml(source,async()=>moved),OfficialWebUnavailable);
});


test("official text reads recover transient errors but retain permanent failure diagnostics",async()=>{
 let calls=0;
 const recovered=await loadOfficialWeb(source,async()=>++calls===1?response("",503):response());
 assert.equal(calls,2);assert.match(recovered.text,/Fictional accountability/);
 calls=0;
 await assert.rejects(()=>loadOfficialWeb(source,async()=>{calls++;return response("",404)}),(e:any)=>e instanceof OfficialWebUnavailable&&e.reasonCode==="HTTP_STATUS"&&e.httpStatus===404);
 assert.equal(calls,1);
 await assert.rejects(()=>loadOfficialWeb(source,async()=>{throw Error("secret provider detail")}), (e:any)=>e instanceof OfficialWebUnavailable&&e.reasonCode==="PROVIDER_UNAVAILABLE"&&!e.message.includes("secret"));
});
test("SEPA uses the verified replacement publication linked from its current waste index",async()=>{
 const sepa=REGULATORY_SOURCES.find(s=>s.id==="sepa-waste-duty")!;
 const r=await loadOfficialWeb(sepa,async(url,options)=>{
  assert.equal(url,"https://www.sepa.org.uk/regulation/waste/duty-of-care/");assert.equal(options?.redirect,"error");
  return response(`<main><h1>Duty of Care</h1><p>${"Fictional waste guidance. ".repeat(15)}</p></main>`);
 });
 assert.equal(r.url,sepa.url);assert.equal(r.id,sepa.id);
 await assert.rejects(()=>loadOfficialWeb({...sepa,url:"https://beta.sepa.scot/regulation/waste/duty-of-care/"},async()=>assert.fail("Do not revisit the redirected former host")),OfficialWebUnavailable);
});

test("partial responses and publisher interstitials never enter the publication history",async()=>{
 for(const status of [202,206])await assert.rejects(()=>loadOfficialWeb(source,async()=>response(html(),status)),
  (e:any)=>e.reasonCode==="HTTP_STATUS"&&e.httpStatus===status);
 const challenge=response();challenge.headers.set("x-amzn-waf-action","challenge");
 await assert.rejects(()=>loadOfficialWeb(source,async()=>challenge),(e:any)=>e.reasonCode==="PUBLISHER_CHALLENGE");
 await assert.rejects(()=>loadOfficialWeb(source,async()=>response("<html><title>Unavailable</title></html>")),
  (e:any)=>e.reasonCode==="MAIN_REGION_MISSING"&&e.httpStatus===200);
});

test("a partial or queued GOV.UK response cannot provide evidence for a research citation",async()=>{
 const {boundedPublicJson}=await import("../lib/server/publication-catalogue");
 const publication=REGULATORY_SOURCES.find(row=>row.id==="mhra-gmp-gdp")!;
 for(const status of [202,206]) {
  await assert.rejects(()=>loadGovUkHtml(publication,async()=>new Response("<main><h1>"+publication.title+"</h1>"+("Text ".repeat(70))+"</main>",{status,headers:{"content-type":"text/html"}})));
  await assert.rejects(()=>boundedPublicJson("https://www.gov.uk/api/content"+publication.path,async()=>new Response('{"title":"partial"}',{status})));
 }
});

test('both NHS SPS references remain at the publisher, including when a caller supplies an old automatic descriptor',async()=>{
 const {REGULATORY_SOURCES}=await import('../lib/regulatory-sources.mjs');
 const {loadPublication}=await import('../lib/server/ai-sources');
 const {loadOfficialWeb}=await import('../lib/server/official-web-source');
 for(const id of ['sps-aseptic-sops','sps-medicines-temperature-mapping']){
  const source=REGULATORY_SOURCES.find(s=>s.id===id)!;
  assert.equal(source.refreshMode,'manual');
  await assert.rejects(loadPublication({...source,refreshMode:undefined}),{reasonCode:'MANUAL_REFRESH'});
  await assert.rejects(loadOfficialWeb({...source,refreshMode:undefined},async()=>{throw Error('Unexpected publisher access')}),{reasonCode:'MANUAL_REFRESH'});
 }
});
