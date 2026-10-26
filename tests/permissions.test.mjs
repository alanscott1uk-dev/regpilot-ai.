import test from "node:test";
import assert from "node:assert/strict";
import { can, ROLES, ACTIONS } from "../lib/permissions.mjs";

test("roles default to no permissions for unknown values", () => {
  assert.equal(can("UNKNOWN", "obligation:read"), false);
  assert.equal(can("VIEWER", "unknown"), false);
  assert.equal(can("", "obligation:write"), false);
});
test("viewer is read-only", () => {
  assert.equal(can("VIEWER", "obligation:read"), true);
  assert.equal(can("VIEWER", "obligation:write"), false);
  assert.equal(can("VIEWER", "membership:manage"), false);
});
test("editor can write obligations but not manage membership or review evidence", () => {
  assert.equal(can("EDITOR", "obligation:write"), true);
  assert.equal(can("EDITOR", "membership:manage"), false);
  assert.equal(can("EDITOR", "evidence:review"), false);
});
test("admin and owner can perform all defined actions", () => {
  for (const role of ["ADMIN", "OWNER"]) for (const action of ACTIONS) assert.equal(can(role, action), true);
  assert.deepEqual(ROLES, ["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
});
