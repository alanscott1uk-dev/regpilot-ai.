import test from "node:test";
import assert from "node:assert/strict";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
import {loadOfficialWeb,officialMainText,OfficialWebUnavailable} from "../lib/server/official-web-source";
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
