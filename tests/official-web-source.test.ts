import test from "node:test";
import assert from "node:assert/strict";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
import {loadOfficialWeb,officialMainText,OfficialWebUnavailable} from "../lib/server/official-web-source";
import {loadGovUkHtml} from "../lib/server/govuk-html-source";
const source=REGULATORY_SOURCES.find(s=>s.id==="ico-accountability")!;
const html=(extra="")=>`<html><nav>Outside navigation</nav><main><h1>${source.heading}</h1><p>${"Fictional accountability guidance. ".repeat(10)}</p>${extra}</main><footer>Outside footer</footer></html>`;
const response=(body=html(),status=200,type="text/html")=>new Response(body,{status,headers:{"content-type":type,"last-modified":"Mon, 01 Jan 2024 00:00:00 GMT"}});
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
 await assert.rejects(()=>loadOfficialWeb(source,async()=>{throw new TypeError("redirect blocked");}),TypeError);
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
