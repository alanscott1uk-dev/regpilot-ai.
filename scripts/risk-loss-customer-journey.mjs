import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function riskLossJourney({upload,app,org,riskId,evidenceId,checkpoint,passed}) {
  await checkpoint("compare and save a GBP loss scenario on the actual risk");
  await upload.goto(app+"/team/risks?"+new URLSearchParams({organizationId:org.id,riskId}));
  await upload.getByText("Financial exposure in pounds",{exact:true}).click();
  await upload.getByLabel("Compare after treatment").check();
  for(const [stage,rate] of [["Before","1"],["After","0.25"]]) {
    await upload.getByLabel(stage+" treatment Expected events per year",{exact:true}).fill(rate);
    for (const [label,amount] of [["Low","1000"],["Most likely","2000"],["High","3000"]]) {
      await upload.getByLabel(stage+" treatment "+label+" loss per event (£)",{exact:true}).fill(amount);
    }
  }
  await upload.getByRole("button",{name:"Calculate exposure",exact:true}).click();
  await upload.getByText("£1,500 reduction",{exact:true}).waitFor();
  const section=upload.locator("details").filter({has:upload.getByText("Financial exposure in pounds",{exact:true})}).first();
  await section.getByLabel("Scenario name").fill("Fictional continuity loss");
  await section.locator('select[name="evidence"]').selectOption(evidenceId);
  await section.getByLabel("Sources and assumptions").fill("Fictional service costs from the reviewed exercise. Incident response lowers the assumed event rate.");
  await section.getByRole("button",{name:"Save scenario",exact:true}).click();
  await section.getByText("Scenario saved against this risk version.",{exact:true}).waitFor();
  await section.getByText("Fictional continuity loss · £2,000 expected annual loss",{exact:true}).click();
  const receipt=upload.waitForEvent("download");
  await section.getByRole("button",{name:"Download scenario"}).click();
  const record=JSON.parse(await readFile(await (await receipt).path(),"utf8"));
  assert.equal(record.format,"regpilot-gbp-risk-scenario");assert.equal(record.riskId,riskId);
  assert.equal(record.result.expectedReduction,1500);assert.equal(record.evidenceStatus,"Reviewed evidence current");
  assert.ok(await upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  passed("A mobile user compared baseline and treated annual loss, saved the assumptions and downloaded the attributed GBP scenario with its evidence status.");
  return {before:2000,after:500,modelledReduction:1500,currency:"GBP"};
}
