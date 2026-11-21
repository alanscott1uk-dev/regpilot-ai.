import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRiskSchema,treatmentSchema,riskReviewSchema,riskDecisionSchema,riskQuerySchema,riskRating} from '../lib/risk-register';

const date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
const fields=()=>({requestKey:randomUUID(),title:'Fictional records loss',description:'Loss of the fictional company working records would interrupt its customer service.',category:'OPERATIONAL',ownerId:randomUUID(),likelihood:3,impact:4,ratingRationale:'The fictional backup process has not yet been tested against a representative recovery.',strategy:'MITIGATE',reviewDueAt:date,controlIds:[]});

test('risk ratings retain both dimensions and reject values outside the stated five-point scale',()=>{
 for(const [likelihood,impact,score,band] of [[1,5,5,'LOW'],[2,5,10,'MODERATE'],[3,5,15,'HIGH'],[4,5,20,'VERY_HIGH']] as const)assert.deepEqual(riskRating(likelihood,impact),{score,band});
 for(const pair of [[0,3],[6,3],[2,1.5],[NaN,1],[1,Infinity]])assert.throws(()=>riskRating(pair[0],pair[1]));
 const valid=fields();assert.equal(createRiskSchema.safeParse(valid).success,true);
 for(const patch of [{likelihood:0},{impact:6},{ownerId:'foreign-looking-name'},{category:'CERTIFIED'},{strategy:'IGNORE'},{reviewDueAt:'2026-02-30'},{controlIds:[valid.ownerId,valid.ownerId]}])assert.equal(createRiskSchema.safeParse({...valid,...patch}).success,false);
});

test('treatment requests choose exactly one existing task or one complete owned-task definition',()=>{
 const common={version:1,requestKey:randomUUID(),purpose:'Verify a recoverable copy of the fictional customer records.'};
 assert.equal(treatmentSchema.safeParse({...common,taskId:randomUUID()}).success,true);
 assert.equal(treatmentSchema.safeParse({...common,title:'Exercise fictional recovery',ownerId:randomUUID(),dueDate:date}).success,true);
 for(const patch of [{},{taskId:randomUUID(),ownerId:randomUUID()},{title:'Exercise fictional recovery',ownerId:randomUUID()},{title:'Exercise fictional recovery',dueDate:date}])assert.equal(treatmentSchema.safeParse({...common,...patch}).success,false);
});

test('risk assessment and acceptance require bounded evidence, versions and explicit confirmation',()=>{
 const id=randomUUID(),proposal={version:2,requestKey:randomUUID(),residualLikelihood:2,residualImpact:3,rationale:'The fictional recovery was exercised and a separately reviewed record supports the remaining risk judgement.',validUntil:date,evidenceIds:[id],confirm:true};
 assert.equal(riskReviewSchema.safeParse(proposal).success,true);
 for(const patch of [{confirm:false},{version:0},{evidenceIds:[]},{evidenceIds:[id,id]},{evidenceIds:Array.from({length:11},()=>randomUUID())},{rationale:'Looks fine'}])assert.equal(riskReviewSchema.safeParse({...proposal,...patch}).success,false);
 const decision={version:1,riskVersion:3,decision:'ACCEPTED',notes:'The remaining risk was reviewed independently for the stated period.',confirm:true};
 assert.equal(riskDecisionSchema.safeParse(decision).success,true);
 assert.equal(riskDecisionSchema.safeParse({...decision,confirm:false}).success,false);
 assert.equal(riskDecisionSchema.safeParse({...decision,riskVersion:0}).success,false);
 assert.deepEqual(riskQuerySchema.parse({}),{q:'',status:'all',page:1,taskQ:'',taskPage:1});
 for(const query of [{page:0},{page:'1.5'},{status:'approved'},{riskId:'invalid'},{q:'x'.repeat(121)}])assert.equal(riskQuerySchema.safeParse(query).success,false);
});
