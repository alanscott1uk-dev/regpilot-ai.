import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {qualityCreateSchema,qualityActionSchema,qualityDecisionSchema,qualityDue,qualityCanClose} from '../lib/capa';
test('quality records require deviation detail, bounded classification and explicit owned action modes',()=>{
 const input={requestKey:randomUUID(),title:'Fictional excursion',kind:'DEVIATION',classification:'MAJOR',description:'A fictional excursion occurred during the controlled handling process.',impact:'The fictional batch remains segregated while the impact is investigated.',containment:'The affected fictional material was quarantined and its handling paused.',occurredAt:'2026-11-20',ownerId:randomUUID()};
 assert.equal(qualityCreateSchema.safeParse(input).success,true);assert.equal(qualityCreateSchema.safeParse({...input,classification:'CERTIFIED'}).success,false);assert.equal(qualityCreateSchema.safeParse({...input,impact:''}).success,false);
 const action={version:1,requestKey:randomUUID(),kind:'CORRECTIVE',purpose:'Correct and independently verify the handling control before its next use.'};
 assert.equal(qualityActionSchema.safeParse(action).success,false);assert.equal(qualityActionSchema.safeParse({...action,taskId:randomUUID()}).success,true);assert.equal(qualityActionSchema.safeParse({...action,taskId:randomUUID(),title:'Conflicting task'}).success,false);
 assert.equal(qualityDecisionSchema.safeParse({requestKey:randomUUID(),version:1,caseVersion:3,decision:'PASSED',notes:'The observation meets the recorded measurable effectiveness criteria.',confirm:false}).success,false);
});
test('effectiveness dates cannot imply premature closure; completed decisions leave the due queue',()=>{
 assert.equal(qualityCanClose('2026-11-20','2026-11-21','2026-11-20'),false);
 assert.equal(qualityCanClose('2026-11-19','2026-11-20','2026-11-20'),false);
 assert.equal(qualityCanClose('2026-11-20','2026-11-20','2026-11-20'),true);
 assert.equal(qualityCanClose('2026-11-20',null,'2026-11-20'),false);
 assert.equal(qualityDue('2026-11-19','ACTIONS_OPEN','2026-11-20'),'OVERDUE');assert.equal(qualityDue('2026-11-20','EFFECTIVENESS_DUE','2026-11-20'),'DUE_TODAY');assert.equal(qualityDue('2026-11-19','CLOSED','2026-11-20'),'NONE');
});
