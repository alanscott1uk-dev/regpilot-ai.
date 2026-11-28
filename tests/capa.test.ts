import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stockCountSchema,reconcileStock} from '../lib/stock-reconciliation';
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

test('reconciliation preserves decimal quantities, movement order and interim negative balances',()=>{
 const openedAt='2025-06-01T08:00:00.000Z', at='2025-06-01T09:00:00.000Z', countedAt='2025-06-01T10:00:00.000Z';
 const count={site:'Site A',product:'Test product',batch:'Batch A',unit:'g',opening:'0.100',physical:'0.300',openedAt,countedAt,
  registerId:randomUUID(),countId:randomUUID(),notes:'Compared the register and count.',
  movements:[{reference:'Line 1',direction:'IN',at,quantity:'0.200'}]};
 const valid=stockCountSchema.parse(count);
 assert.deepEqual(reconcileStock(valid),{received:'0.2',supplied:'0',expected:'0.3',difference:'0',negative:false,matched:true});
 const movements=[{...valid.movements[0],direction:'OUT' as const},{...valid.movements[0],reference:'Line 2',quantity:'0.4'}];
 assert.deepEqual(reconcileStock({...valid,movements}),{received:'0.4',supplied:'0.2',expected:'0.3',difference:'0',negative:true,matched:false});
 for(const invalid of [{...count,unit:'packs'}, {...count,countId:count.registerId},{...count,movements:[...count.movements,...count.movements]},
  {...count,movements:[{...count.movements[0],at:openedAt}]},{...count,movements:[{...count.movements[0],quantity:'0'}]},
  {...count,opening:'1e3'},{...count,physical:'-1'},{...count,physical:'0.1234'}])assert.equal(stockCountSchema.safeParse(invalid).success,false);
});
