import test from "node:test";
import assert from "node:assert/strict";
import { assessBackendReadiness } from "../lib/backend-readiness.mjs";
test("missing configuration never reports ready",()=>{
 const r=assessBackendReadiness({});
 assert.equal(r.databaseConfigured,false);
 assert.equal(r.authConfigured,false);
 assert.equal(r.readyForCustomerData,false);
});
test("readiness does not expose secrets or claim security approval",()=>{
 const r=assessBackendReadiness({
  DATABASE_URL:"postgresql://secret:password@db.example.com/app",
  AUTH_PROVIDER_ISSUER:"https://identity.example.com",
  AUTH_PROVIDER_AUDIENCE:"regpilot",
  PRIVATE_STORAGE_BUCKET:"private-evidence"
 });
 assert.equal(r.databaseConfigured,true);
 assert.equal(r.authConfigured,true);
 assert.equal(r.storageConfigured,true);
 assert.equal(r.readyForCustomerData,false);
 assert.equal(JSON.stringify(r).includes("password"),false);
});
