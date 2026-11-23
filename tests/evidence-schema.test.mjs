import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const schema=readFileSync(new URL("../prisma/schema.prisma",import.meta.url),"utf8");
test("evidence and obligation have organisation-scoped composite unique keys",()=>{
 const evidence=schema.match(/model Evidence \{([\s\S]*?)\n\}/)?.[1]??"";
 const obligation=schema.match(/model Obligation \{([\s\S]*?)\n\}/)?.[1]??"";
 assert.match(evidence,/@@unique\(\[id, organizationId\]\)/);
 assert.match(obligation,/@@unique\(\[id, organizationId\]\)/);
});
test("link relations use composite foreign keys",()=>{
 const link=schema.match(/model DocumentActionLink \{([\s\S]*?)\n\}/)?.[1]??"";
 assert.match(link,/fields: \[evidenceId, organizationId\], references: \[id, organizationId\]/);
 assert.match(link,/fields: \[obligationId, organizationId\], references: \[id, organizationId\]/);
});
test("evidence has expiry and reviewer fields",()=>{
 const evidence=schema.match(/model Evidence \{([\s\S]*?)\n\}/)?.[1]??"";
 for(const field of ["expiresOn","reviewOn","reviewedAt","reviewedById","version"])assert.match(evidence,new RegExp("\\b"+field+"\\b"));
});
