import test from "node:test";
import assert from "node:assert/strict";
import {extractPdf} from "../lib/server/pdf-extraction";
import {fixturePdf} from "./helpers/pdf-fixture.mjs";
test("real PDF parser retains page boundaries and line text without a model or rendering",async()=>{
  const pdf=await extractPdf(fixturePdf([["FICTIONAL TRAINING RECORD","Staff completed widget training on 4 November 2026."],["FICTIONAL ACCESS REVIEW","Access was not reviewed for the second site."]]));
  assert.equal(pdf.totalPages,2);assert.equal(pdf.pages[0].page,1);assert.equal(pdf.pages[1].page,2);assert.match(pdf.pages[0].text,/Staff completed widget training/);assert.match(pdf.pages[1].text,/not reviewed/);assert.deepEqual(pdf.skippedPages,[]);assert.equal(pdf.truncated,false);
});
test("missing text is visible, and image-only/blank documents cannot become positive proof",async()=>{
  const partial=await extractPdf(fixturePdf([["Fictional visible record with sufficient text."],[]]));assert.deepEqual(partial.skippedPages,[2]);
  await assert.rejects(()=>extractPdf(fixturePdf([[]])),(e:any)=>e.status===422);
  const visionOnly=await extractPdf(fixturePdf([[]]),{allowEmpty:true});assert.equal(visionOnly.characters,0);assert.deepEqual(visionOnly.skippedPages,[1],"AI Studio may retain its visual review path without claiming text grounding");
});
test("malformed and oversized PDFs fail closed",async()=>{
  await assert.rejects(()=>extractPdf(Buffer.from("%PDF-1.7\nThis is not a valid PDF structure.\n%%EOF")),(e:any)=>e.status===422);
  await assert.rejects(()=>extractPdf(new Uint8Array(5_000_001)),(e:any)=>e.status===413);
});
test("page limit is disclosed rather than implying complete coverage",async()=>{
  const doc=await extractPdf(fixturePdf(Array.from({length:41},(_,i)=>["Fictional record on page "+i+" with readable text."])));assert.equal(doc.totalPages,41);assert.equal(doc.pages.length,40);assert.equal(doc.truncated,true);
});
