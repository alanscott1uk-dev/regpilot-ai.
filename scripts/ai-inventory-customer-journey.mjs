import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

export async function aiInventoryJourney({upload, review, app, org, db, evidenceId, checkpoint, passed}) {
  const serial = "urn:uuid:" + randomUUID(), name = "Fictional stock forecast model";
  const url = app + "/team/ai-inventory?organizationId=" + org.id;
  async function importRevision(version) {
    const document = {bomFormat:"CycloneDX",specVersion:"1.7",serialNumber:serial,version,components:[
      {type:"application",name:"Fictional demand planning",components:[{type:"machine-learning-model","bom-ref":"demand-model",name,version:String(version)}]},
    ]};
    await upload.goto(url);
    await upload.getByRole("button",{name:"Discover models from a BOM"}).click();
    await upload.getByLabel("CycloneDX file").setInputFiles({name:"models.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(document))});
    await upload.getByRole("button",{name:"Import selected models"}).click();
    await upload.getByRole("button",{name,exact:true}).click();
  }
  await checkpoint("import and assess an AI model declared inside a software bill of materials");
  await importRevision(1);
  await upload.getByText("Model · Needs assessment · Version 1",{exact:true}).waitFor();
  await upload.getByRole("button",{name:"Edit use or start a new review"}).click();
  await upload.getByLabel("Intended use").fill("Forecast demand from fictional stock movements.");
  await upload.getByLabel("Highest data sensitivity").selectOption("INTERNAL");
  await upload.getByLabel("System permissions").selectOption("DRAFT");
  await upload.getByLabel("Area of impact").selectOption("INTERNAL");
  await upload.getByLabel("Safeguards and human oversight").fill("A member of the replenishment team checks every recommendation.");
  await upload.getByRole("button",{name:"Save system",exact:true}).click();
  await upload.getByText("Model · Awaiting review · Version 2",{exact:true}).waitFor();
  assert.equal(await upload.getByRole("button",{name:"Record independent decision"}).count(),0);
  await review.goto(upload.url());
  await review.getByLabel("Decision",{exact:true}).selectOption("RESTRICTED");
  await review.getByLabel("Review through").fill(new Date(Date.now()+21*86400000).toISOString().slice(0,10));
  await review.getByLabel("Supporting evidence").selectOption(evidenceId);
  await review.getByLabel("Reason and any conditions").fill("Use only for supervised purchasing recommendations during this pilot.");
  await review.getByRole("button",{name:"Record independent decision"}).click();
  await review.getByText("Model · Restricted · Version 2",{exact:true}).waitFor();
  await checkpoint("detect a model change and retain the previous independent decision");
  await importRevision(2);
  await upload.getByText("Model · Awaiting review · Version 3",{exact:true}).waitFor();
  await upload.getByText("Version 2 · Restricted",{exact:true}).waitFor();
  const rows=await db.aiSystem.findMany({where:{organizationId:org.id,bomSerial:serial},include:{decisions:true}});
  assert.equal(rows.length,1);assert.equal(rows[0].decisions.length,1);assert.equal(rows[0].componentVersion,"2");
  assert.ok(await upload.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  passed("A nested model was imported, assessed, independently restricted using verified file bytes and reopened after a later BOM changed its declared version.");
  return {systems:1,modelUpdates:1,retainedDecisions:1,activeDecisionAfterChange:false};
}
