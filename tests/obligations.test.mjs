import test from "node:test";
import assert from "node:assert/strict";
import { isValidDate, validateObligation, isOverdue, csvEscape, exportObligationsCsv } from "../lib/obligations.mjs";

const item = { id:"abc", title:"Review SOP", regulator:"Internal", owner:"Quality lead", due:"2026-11-01", status:"Open", notes:"" };

test("validates calendar dates including leap years", () => {
  assert.equal(isValidDate("2028-02-29"), true);
  assert.equal(isValidDate("2027-02-29"), false);
  assert.equal(isValidDate("2026-13-01"), false);
});
test("validates demo obligation shape", () => {
  assert.equal(validateObligation(item), true);
  assert.equal(validateObligation({...item, title:""}), false);
  assert.equal(validateObligation({...item, status:"Unknown"}), false);
  assert.equal(validateObligation({...item, due:"2026-02-30"}), false);
});
test("completed actions are not overdue", () => {
  assert.equal(isOverdue(item,"2026-11-02"), true);
  assert.equal(isOverdue({...item,status:"Complete"},"2026-11-02"), false);
  assert.equal(isOverdue(item,"2026-11-01"), false);
});
test("escapes CSV delimiters and formula-like values", () => {
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(csvEscape("=1+1"), '"\'=1+1"');
  assert.equal(csvEscape(" +SUM(A1)"), '"\' +SUM(A1)"');
  assert.match(exportObligationsCsv([item]), /Review SOP/);
});
