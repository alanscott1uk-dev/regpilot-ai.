import test from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/server/db";

const PRIVATE_TABLES=[
 "User","Organization","Membership","Obligation","Evidence","AuditEvent",
 "AiDailyUsage","AiReview","RegulatorySnapshot","BusinessProfile","IntelligenceRun","IntelligenceDecision","WatchSchedule","SemanticRequest","AssuranceAssessment","ProgrammeImport","ManagedControl","ControlLink","EvidenceConnector","ConnectorRun","RegisteredSource","LibraryRequirement","LibraryRevision","LibraryApplicability","CoverageRun","CoverageDecision","WorkspaceInvitation","PaidBudget","PaidReservation","ServiceJob","BillingAccount","BillingEvent","AuditRoom","AuditGrant","AuditQuestion","Policy","PolicyRevision","PolicyAssignment","Vendor","VendorReview","AuditRequest","ChangeResponse","ChangeAction","AccessInventory","AccessCampaign","AccessReviewItem","AssuranceAnswer","AssuranceQuestionnaire"
];
const UNTRUSTED_ROLES=["anon","authenticated","service_role"];

test("Prisma-owned private tables are RLS enabled and not exposed to Supabase Data API roles",async()=>{
 const tables=await db.$queryRawUnsafe<Array<{table_name:string;rls:boolean}>>(
  "SELECT c.relname AS table_name,c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relkind='r'"
 );
 for(const name of PRIVATE_TABLES){
  assert.ok(tables.find(t=>t.table_name===name),name+" table must exist");
  assert.equal(tables.find(t=>t.table_name===name)?.rls,true,name+" RLS must be enabled");
 }
 const roles=await db.$queryRawUnsafe<Array<{rolname:string}>>(
  "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')"
 );
 for(const role of UNTRUSTED_ROLES){
  assert.ok(roles.some(r=>r.rolname===role),role+" fixture role absent");
  for(const name of PRIVATE_TABLES){
   const qualified='public."'+name+'"';
   const privileges=await db.$queryRawUnsafe<Array<{can_read:boolean;can_write:boolean;can_update:boolean;can_delete:boolean}>>(
    "SELECT has_table_privilege($1::name,$2::text,'SELECT') AS can_read,has_table_privilege($1::name,$2::text,'INSERT') AS can_write,has_table_privilege($1::name,$2::text,'UPDATE') AS can_update,has_table_privilege($1::name,$2::text,'DELETE') AS can_delete",
    role,qualified
   );
   assert.ok(privileges.length===1,role+" / "+name);
   assert.deepEqual(privileges[0],{can_read:false,can_write:false,can_update:false,can_delete:false},role+" / "+name);
  }
 }
});
test("private Prisma tables have no publicly usable RLS policies",async()=>{
 const policies=await db.$queryRawUnsafe<Array<{tablename:string;policyname:string;roles:string[]}>>(
  "SELECT tablename,policyname,roles FROM pg_policies WHERE schemaname='public'"
 );
 const exposed=policies.filter(x=>PRIVATE_TABLES.includes(x.tablename) && (
  x.roles.some(r=>r==='public'||UNTRUSTED_ROLES.includes(r))
 ));
 assert.deepEqual(exposed,[]);
});
