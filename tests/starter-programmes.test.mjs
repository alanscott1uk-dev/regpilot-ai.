import test from 'node:test';
import assert from 'node:assert/strict';
import {STARTER_PACKS,parseStarterProgramme,readStarterProgrammeJson,StarterProgrammeInputError} from '../lib/starter-programmes.mjs';
const owner='123e4567-e89b-42d3-a456-426614174000',now=new Date('2026-11-19T12:00:00Z');
const input=(pack=STARTER_PACKS[0])=>({packId:pack.id,packVersion:pack.version,name:pack.title,scopeRationale:'These operational starting points fit the fictional team and its selected activities.',items:pack.items.map(({key,title,description,why})=>({key,title,description,why,assigneeId:owner,dueDate:'2026-12-01'}))});
test('all starter packs can be adopted with their original editable guidance and explicit owners',()=>{
 for(const pack of STARTER_PACKS){const result=parseStarterProgramme(input(pack),now);const sizes={'soc2-iso27001-scoped':38,'soc2-iso27001-joint':24,'nist-800-53b-low':18,'nist-800-53b-moderate':18,'nist-800-53b-high':18,'nist-800-53b-privacy':16,'soc2-security':13,'iso27001-annex-a':19,'nist-csf-2':22,'soc2-iso27001':12,'uk-gdpr-accountability':7,'uk-gdp-self-inspection':10};const count=sizes[pack.id]??6;if(pack.id==='nist-csf-2')assert.equal(new Set(pack.items.flatMap(i=>i.mappings)).size,106);assert.equal(result.items.length,count);assert.equal(new Set(result.items.map(item=>item.key)).size,count);assert.equal(result.items.every(item=>item.assigneeId===owner),true);}
 const changed=input();changed.items=changed.items.slice(0,2).reverse();changed.items[0].title='Our own chosen operating task';assert.equal(parseStarterProgramme(changed,now).items[1].title,changed.items[0].title,'selection is editable and returns canonical pack order');
});
test('all optional SOC 2 criteria appear once and each activity offers a mapped ISO sample',()=>{
 const pack=STARTER_PACKS.find(p=>p.id==='soc2-iso27001-scoped');
 const base=STARTER_PACKS.find(p=>p.id==='soc2-iso27001-joint');
 assert.deepEqual(pack.items.filter(item=>!item.scopeCategory),base.items);
 const annex=new Set(base.items.flatMap(i=>i.mappings).filter(r=>r.startsWith('ISO/IEC 27001:2022 · A.')));
 const expected={Availability:'A1.1 A1.2 A1.3',Confidentiality:'C1.1 C1.2','Processing Integrity':'PI1.1 PI1.2 PI1.3 PI1.4 PI1.5',Privacy:'P1.1 P2.1 P3.1 P3.2 P4.1 P4.2 P4.3 P5.1 P5.2 P6.1 P6.2 P6.3 P6.4 P6.5 P6.6 P6.7 P7.1 P8.1'};
 for(const [category,identifiers] of Object.entries(expected)){
  const activities=pack.items.filter(i=>i.scopeCategory===category);
  const prefix='SOC 2 '+category+' · ';
  assert.deepEqual(activities.flatMap(i=>i.mappings.filter(r=>r.startsWith(prefix)).map(r=>r.slice(prefix.length))).sort(),identifiers.split(' ').sort());
  assert.ok(activities.every(i=>i.mappings.some(r=>annex.has(r))));
 }
 assert.equal(new Set(pack.items.flatMap(i=>i.mappings)).size,184);
});

test('starter planning rejects invented tasks, silent approvals, ambiguous items and impossible target dates',()=>{
 const valid=input();
 for(const value of [{...valid,packVersion:99},{...valid,status:'APPROVED'},{...valid,items:[]},{...valid,items:[valid.items[0],valid.items[0]]},{...valid,items:[{...valid.items[0],key:'foreign-key'}]},{...valid,items:[{...valid.items[0],completed:true}]},{...valid,items:[{...valid.items[0],assigneeId:''}]},{...valid,scopeRationale:'too short'},{...valid,token:'bad'},{...valid,confirm:false}])assert.throws(()=>parseStarterProgramme(value,now),StarterProgrammeInputError);
 for(const dueDate of ['2026-02-30','2026-11-18','2028-01-01','01/12/2026'])assert.throws(()=>parseStarterProgramme({...valid,items:[{...valid.items[0],dueDate}]},now),StarterProgrammeInputError);
 assert.equal(parseStarterProgramme({...valid,items:[{...valid.items[0],dueDate:'2026-11-18'}]},now,{allowPastDates:true}).items.length,1,'only the service uses past-date parsing to recognise an existing confirmed request');
});
test('programme request bodies enforce byte limits and valid UTF-8 before JSON parsing',async()=>{
 const request=body=>new Request('https://example.invalid',{method:'POST',body});
 assert.deepEqual(await readStarterProgrammeJson(request(JSON.stringify({text:'£'.repeat(9000)}))),{text:'£'.repeat(9000)});
 await assert.rejects(()=>readStarterProgrammeJson(request(JSON.stringify({text:'£'.repeat(33000)}))),(error)=>error.status===413);
 await assert.rejects(()=>readStarterProgrammeJson(request(new Uint8Array([0xc3,0x28]))),(error)=>error.status===400);
});
