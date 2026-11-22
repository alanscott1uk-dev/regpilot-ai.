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

test('reviewed effective dates handle both boundaries and a missing date rule preserves earlier records',async()=>{
 const {evaluateDatedRule}=await import('../lib/library/applicability');
 const rule={kind:'fact' as const,field:'jurisdictions' as const,operator:'includes' as const,value:'Scotland'};
 const effective={from:'2026-03-01',through:'2026-10-31'};
 for(const day of ['2026-02-28','2026-11-01'])assert.equal(evaluateDatedRule(rule,{},['Scotland'],day,effective).state,'NO_MATCH');
 for(const day of [effective.from,effective.through])assert.equal(evaluateDatedRule(rule,{},['Scotland'],day,effective).state,'MATCH');
 assert.equal(evaluateDatedRule(rule,{},['Northern Ireland'],'2026-06-01',effective).state,'NO_MATCH');
 assert.equal(evaluateDatedRule(rule,{},[],'2026-06-01').state,'UNKNOWN');
});

test('logger CSV windows retain the input digest and cannot hide excursions, gaps or uncalibrated periods',async()=>{
 const {loggerEnvelope}=await import('../public/examples/logger-csv.mjs');
 const {assessLoggerWindow}=await import('../lib/logger-window');
 const {createHash}=await import('node:crypto');
 const config={...source,controlId:generic.controlId,siteRef:'storage',sensorRef:'s1',calibrationRef:'cert1',
   calibratedAt:'2026-11-01T00:00:00Z',calibrationDue:'2027-01-01T00:00:00Z',unit:'CELSIUS',minimum:2,maximum:8,maxGapSeconds:300,
   windowStart:'2026-11-19T10:00:00Z',windowEnd:'2026-11-19T10:10:00Z',validUntil:'2026-11-21T10:00:00Z'};
 const first='2026-11-19T11:00:00+01:00,2', middle='2026-11-19T10:05:00Z,5', last='2026-11-19T10:10:00Z,8';
 const input=(rows:string[],settings={})=>{
   const bytes=Buffer.from(['timestamp,value',...rows].join('\r\n')+'\r\n');
   const observation=customerObservationInput.parse(loggerEnvelope(bytes,{...config,...settings}).observation);
   const record=observation.partnerRecord!.record;
   if(record.kind!=='LOGGER_WINDOW')throw Error('Logger window missing');
   assert.equal(record.rawFileSha256,createHash('sha256').update(bytes).digest('hex'));
   return {observation,record,assessment:assessLoggerWindow(record),outcome:reportedObservationOutcome(observation)};
 };
 const complete=input([first,middle,last]);assert.equal(complete.outcome,'REPORTED_PASS');
 assert.deepEqual([complete.assessment.samples,complete.assessment.gaps,complete.assessment.excursions],[3,0,0]);
 const missing=input([first,last]);assert.equal(missing.outcome,'REPORTED_UNKNOWN');assert.equal(missing.assessment.longestGapSeconds,600);
 assert.equal(input([first,middle,last],{calibrationDue:config.windowEnd}).outcome,'REPORTED_UNKNOWN');
 assert.equal(input([]).outcome,'REPORTED_UNKNOWN');
 const excursion=input([first,last.replace(',8',',9')]);assert.equal(excursion.outcome,'REPORTED_FAILURE');assert.equal(excursion.assessment.gaps,1);assert.equal(excursion.assessment.firstExcursion,'2026-11-19T10:10:00.000Z');
 assert.throws(()=>input([first,middle,middle,last]));assert.throws(()=>input([last,first]));
 assert.throws(()=>input([first,'2026-11-19T10:05:00Z,',last]));
 assert.throws(()=>input(['2026-02-30T10:00:00Z,3']));
 assert.throws(()=>input([first,'2026-11-19T10:05:00,3',last]));
 assert.throws(()=>customerObservationInput.parse({...complete.observation,observedAt:config.validUntil}));
 const withRecord=(record:unknown)=>customerObservationInput.parse({...complete.observation,partnerRecord:{...complete.observation.partnerRecord,record}});
 assert.throws(()=>withRecord({...complete.record,samples:[complete.record.samples[1],complete.record.samples[0]]}));
 assert.throws(()=>withRecord({...complete.record,rawFileSha256:'absent'}));
});
