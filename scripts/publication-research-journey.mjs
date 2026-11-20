import assert from "node:assert/strict";
import {checkAccessibility} from "./browser-accessibility.mjs";

export async function publicationResearchJourney(browser,base,viewport,name) {
  const context=await browser.newContext({viewport});
  try {
    const page=await context.newPage(), requests=[];
    const checkedAt="2026-11-20T10:00:00Z", title="Fictional medicines publication";
    const url="https://www.gov.uk/guidance/good-manufacturing-practice-and-good-distribution-practice";
    const passage={id:"b".repeat(64),sourceId:"mhra-gmp-gdp",documentHash:"c".repeat(64),title,url,
      agency:"MHRA",start:0,end:60,checkedAt,quote:"Fictional wording on producing and distributing medicines.",jurisdictions:["Scotland"]};
    passage.end=passage.quote.length;
    await page.route("**/api/ai/research",route=>{
      requests.push(route.request().postDataJSON());
      return route.fulfill({json:{status:"matched",catalogueSize:47,nations:["Scotland"],checked:[{id:passage.sourceId,title,url,status:"matched"}],unavailable:0,citations:[passage]}});
    });
    await page.route("**/api/ai/research/verify",route=>{
      const body=route.request().postDataJSON();
      assert.equal(body.id,passage.id);assert.equal(body.quote,passage.quote);
      return route.fulfill({json:{status:"relocated",start:37,end:37+passage.quote.length,checkedAt,documentHash:"d".repeat(64)}});
    });
    await page.goto(base+"/ai#source-research");
    const research=page.getByRole("region",{name:"Search UK regulatory sources"});
    await research.getByLabel("UK nation").selectOption("Scotland");
    await research.getByRole("button",{name:"Try a medicines question"}).click();
    await research.getByText(passage.quote,{exact:true}).waitFor();
    assert.equal(requests[0].nation,"Scotland");
    assert.equal(await research.getByRole("heading",{name:title}).getByRole("link").getAttribute("href"),url);
    await research.getByText("Verify this passage",{exact:true}).click();
    await research.getByRole("button",{name:"Recheck publication"}).click();
    await research.getByText(/New character range 37/).waitFor();
    await checkAccessibility(page,"artifacts/usability/"+name+"-publication-research-axe.json","#source-research");
    await research.getByLabel("Research question").fill("A different question");
    assert.equal(await research.getByText(passage.quote,{exact:true}).count(),0);
    return {scenario:"publication-research-"+name,passed:true};
  } finally {await context.close();}
}
