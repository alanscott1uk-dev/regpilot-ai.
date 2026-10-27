import test from "node:test";
import assert from "node:assert/strict";
import {DOCUMENT_CATEGORIES,validDocumentMetadata} from "../lib/document-categories.mjs";
const doc={id:"demo-1",title:"Example procedure",category:"Policies & SOPs",department:"Quality Assurance",owner:"Quality lead",version:"1.0",reviewDate:"2026-12-01",status:"Draft"};
test("document categories cover cross-industry needs",()=>{for(const x of ["Certifications","Import & export","HR documentation","Risk assessments"])assert.ok(DOCUMENT_CATEGORIES.includes(x));});
test("document metadata validation",()=>{assert.equal(validDocumentMetadata(doc),true);assert.equal(validDocumentMetadata({...doc,category:"Unknown"}),false);assert.equal(validDocumentMetadata({...doc,title:""}),false);});

test("optional obligation linkage is accepted only as a bounded reference",()=>{
 assert.equal(validDocumentMetadata({...doc,obligationId:"sample-1"}),true);
 assert.equal(validDocumentMetadata({...doc,obligationId:123}),false);
});
