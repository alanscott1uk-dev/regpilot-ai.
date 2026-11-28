import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {requiredVendorCriteria,vendorAssessmentIssues,vendorReviewSchema,VENDOR_CRITERIA,policyActionSchema,acknowledgementSchema} from "../lib/assurance-workflows";
import {futureDate} from "../lib/server/reviewed-files";
const id=randomUUID(),tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
const scope={criticality:"HIGH",dataAccess:"PERSONAL",systemAccess:true};
const review=()=>vendorReviewSchema.parse({version:1,evidenceIds:[id],assessment:VENDOR_CRITERIA.map(c=>({id:c.id,outcome:"SUPPORTED",rationale:"Fictional supporting record covers this finding.",evidenceIds:[id]})),recommendation:"APPROVE",rationale:"The fictional supporting evidence covers the recorded service scope.",followUpDue:tomorrow,validUntil:tomorrow});
test("supplier checks follow actual business impact, information and access scope",()=>{
 assert.deepEqual([...requiredVendorCriteria({criticality:"LOW",dataAccess:"NONE",systemAccess:false})],["service","incidents"]);
 assert.equal(requiredVendorCriteria(scope).size,6);
 assert.equal(requiredVendorCriteria({...scope,systemAccess:false}).has("access"),false);
});
test("unsupported, unreferenced and missing scope findings cannot become approval",()=>{
 const d=review();assert.deepEqual(vendorAssessmentIssues(scope,d),[]);
 d.assessment[0].evidenceIds=[];assert.match(vendorAssessmentIssues(scope,d).join(" "),/need evidence/);
 d.assessment[0].evidenceIds=[randomUUID()];assert.match(vendorAssessmentIssues(scope,d).join(" "),/only selected/);
 d.assessment[0].outcome="GAP";assert.match(vendorAssessmentIssues(scope,d).join(" "),/conditional/);
 d.recommendation="CONDITIONAL";d.assessment[0].evidenceIds=[];assert.deepEqual(vendorAssessmentIssues(scope,d),[]);
 d.assessment[1].outcome="NOT_APPLICABLE";assert.match(vendorAssessmentIssues(scope,d).join(" "),/requires assessment/);
});
test("supplier review requires all six distinct checks and a bounded evidence set",()=>{
 const d=review();d.assessment[5]=d.assessment[0];assert.equal(vendorReviewSchema.safeParse(d).success,false);
 d.assessment=review().assessment;d.evidenceIds=Array.from({length:11},()=>randomUUID());assert.equal(vendorReviewSchema.safeParse(d).success,false);
});
test("policy publication requires explicit consent, unique named readers and versions",()=>{
 const d={action:"PUBLISH",version:1,revisionId:id,revisionVersion:1,notes:"Independently reviewed the entire fictional policy and its intended readership.",userIds:[id],dueDate:tomorrow,confirm:true};
 assert.equal(policyActionSchema.safeParse(d).success,true);
 for(const change of [{confirm:false},{userIds:[]},{userIds:[id,id]},{version:0},{revisionVersion:0}])assert.equal(policyActionSchema.safeParse({...d,...change}).success,false);
});
test("policy acknowledgement binds an explicit statement to the exact file manifest",()=>{
 const d={version:1,fileHash:"a".repeat(64),readAndUnderstood:true};assert.equal(acknowledgementSchema.safeParse(d).success,true);
 assert.equal(acknowledgementSchema.safeParse({...d,readAndUnderstood:false}).success,false);
 assert.equal(acknowledgementSchema.safeParse({...d,fileHash:"invalid"}).success,false);
});
test("review dates reject past dates, rollover and dates beyond the bounded window",()=>{
 assert.equal(futureDate(tomorrow).toISOString().slice(0,10),tomorrow);
 for(const d of ["2020-01-01","2027-02-30","2099-01-01","not-a-date"])assert.throws(()=>futureDate(d));
});
