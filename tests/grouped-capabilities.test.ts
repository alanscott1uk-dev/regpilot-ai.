import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {customerObservationInput,reportedObservationOutcome} from '../lib/customer-api';
import {partnerRecordSchema,partnerValidity} from '../lib/partner-records';
import {portalFields,mapPortalFields} from '../lib/portal-questionnaire';
import {trialTracks} from '../lib/capability-trials';
import {nhsProcurementPack} from '../lib/nhs-procurement-pack.mjs';
const date=new Date('2026-11-19T12:00:00Z').toISOString();
const source={schemaVersion:1,revision:1,recordId:'batch-1',sourceSystem:'Authorised test source',sourceVersion:'v2',decisionOwnerRef:'quality-lead-7',state:'CURRENT'};
const generic={externalId:'ref-1',observedAt:date,validUntil:'2026-11-20T12:00:00.000Z',summary:'Source observation is ready for review.',controlId:randomUUID(),checks:[{key:'source',label:'Source checks',status:'PASS',observed:'Present',detail:''}]};
const reading={kind:'CALIBRATED_READING',siteRef:'glasgow',sensorRef:'s17',calibrationRef:'cert007',calibratedAt:'2026-11-10T12:00:00Z',calibrationDue:'2026-12-01T12:00:00Z',unit:'CELSIUS',minimum:2,maximum:8,reading:4};
function result(record:object){return reportedObservationOutcome(customerObservationInput.parse({...generic,partnerRecord:{...source,record}}));}
test('source-specific exceptions and limits cannot be overruled by a passing generic check',()=>{
 assert.equal(result({...reading,reading:12}),'REPORTED_FAILURE');assert.equal(result(reading),'REPORTED_PASS');
 assert.equal(result({...reading,calibrationDue:'2026-11-11T12:00:00Z'}),'REPORTED_UNKNOWN');
 assert.equal(result({kind:'MODEL_CHANGE',systemRef:'S',vendorRef:'V',modelRef:'M',modelVersion:'2',approval:'PENDING'}),'REPORTED_UNKNOWN');
 assert.equal(result({kind:'PRODUCT_EVENT',event:'BATCH_RELEASE',productRef:'P',eventRef:'E',decision:'ON_HOLD',decisionRef:'D'}),'REPORTED_FAILURE');
 assert.equal(result({kind:'FOOD_HAZARD',siteRef:'S',hazardRef:'H',result:'DEVIATION'}),'REPORTED_FAILURE');
 assert.equal(result({kind:'SUPPLIER_ASSESSMENT',supplierRef:'S',assessment:'ESG',assessmentRef:'A',consentRef:'C',consentExpiresAt:'2026-11-17T00:00:00Z',result:'CLEAR'}),'REPORTED_UNKNOWN');
 assert.throws(()=>partnerRecordSchema.parse({...source,revision:2,record:reading}));assert.throws(()=>partnerRecordSchema.parse({...source,sourceUrl:'https://example.org/file?token=secret',record:reading}));
 const specialist={...source,record:{kind:'SPECIALIST_ATTESTATION',subject:'PRIVACY',scopeRef:'P',decisionRef:'D',decision:'APPROVED',retainUntil:'2026-11-19'}};
 assert.throws(()=>customerObservationInput.parse({...generic,partnerRecord:specialist}));
 assert.match(partnerValidity(partnerRecordSchema.parse(specialist),Date.parse('2026-11-20T00:00:00Z')),/ended/);
});
test('portal mapping abstains on duplicates, ambiguous products, missing evidence and different wording',()=>{
 const q={reference:'Q1',question:'Which controls apply?',answer:'The reviewed answer.',evidence:[{filename:'proof.pdf',sha256:'a'.repeat(64)}]},capture=portalFields.parse({format:'regpilot-portal-fields-v1',origin:'https://buyer.example',pageHash:'b'.repeat(64),fields:[q.question,'Other question?']});
 assert.ok(mapPortalFields(capture,[q])[0].match);assert.equal(mapPortalFields(capture,[q])[1].match,null);
 for(const mapped of [mapPortalFields({...capture,fields:[q.question,q.question]},[q]),mapPortalFields(capture,[q,{...q,product:{id:'2',name:'Other'}}]),mapPortalFields(capture,[{...q,evidence:[]}])])assert.equal(mapped[0].match,null);
 assert.throws(()=>portalFields.parse({...capture,origin:'https://buyer.example/path'}));
});
test('grouped trials cover all 22 workbook criteria once and each NHS task includes a publisher source',()=>{
 const rows=Object.values(trialTracks).flatMap(t=>t.steps.map(s=>s.row)).sort((a,b)=>a-b);assert.deepEqual(rows,Array.from({length:22},(_,i)=>i+7));
 assert.equal(nhsProcurementPack.items.length,6);for(const item of nhsProcurementPack.items)assert.match(item.evidenceHint,/https:\/\/(digital\.nhs\.uk|www\.dsptoolkit\.nhs\.uk)\//);
});
