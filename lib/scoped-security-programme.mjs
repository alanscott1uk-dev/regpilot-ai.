import {jointSecurityProgramme} from './joint-security-programme.mjs';

const sourceUrl='https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022';
const tests=[
  ['Availability','capacity','Compare capacity with service commitments',
    'Pick a peak period and a component with limited headroom. Compare the forecast, measured usage and service target. Trace an alert or threshold breach through to a capacity decision.',
    'Service target, capacity trend, alert threshold and dated action or review.','A1.1','A.8.6'],
  ['Availability','restore','Test service recovery against agreed objectives',
    'Follow a disruption scenario from its environmental and infrastructure dependencies through backups, failover and restoration. Compare observed recovery time and data loss with the service commitments. Record and retest any missed target.',
    'Dependency map, recovery objectives, backup and restore logs, timed exercise results and retest.','A1.2 A1.3','A.5.30 A.8.13 A.8.14'],
  ['Confidentiality','confidential-life','Follow a confidential record through disposal',
    'Choose a record covered by a confidentiality commitment. Trace its classification and permitted recipients through active use and retention. Inspect disposal evidence for a comparable expired record, including copies held by a supplier.',
    'Confidentiality term, classification label, access record, retention decision and disposal confirmation.','C1.1 C1.2','A.5.12 A.5.13 A.8.10'],
  ['Processing Integrity','process-input','Reconcile a source batch to accepted inputs',
    'Select a service output and its agreed specification. Reconcile the source population to the accepted input records, including a rejected or duplicate item. Trace how the input owner resolved the difference.',
    'Output specification, source totals, validation results and a resolved input exception.','PI1.1 PI1.2','A.8.26 A.8.29'],
  ['Processing Integrity','process-output','Reconcile processing and delivery',
    'Trace the accepted batch through transformations and any reruns. Reconcile output totals, recipients and delivery times to the specification. Sample an exception and confirm that the corrected output reached the intended recipient.',
    'Execution history, reconciliation totals, correction approval and delivery receipt.','PI1.3 PI1.4','A.8.26 A.8.29'],
  ['Processing Integrity','process-storage','Retrieve the stored input, processing record and output',
    'Retrieve a completed transaction from the audit period. Compare the archived input, intermediate record and delivered output with their recorded totals or digests. Verify retrieval meets the documented time and retention requirements.',
    'Archive inventory, retrieval timestamps and reconciled versions of the three records.','PI1.5','A.5.33 A.8.13'],
  ['Privacy','privacy-choice','Check the notice and choices offered at collection',
    'Select a collection channel and a change to its privacy notice. Verify which notice and choices a person saw, the consequences communicated and how the recorded preference reached the service.',
    'Dated notices, change communication, collection screen and a redacted preference record.','P1.1 P2.1','A.5.34'],
  ['Privacy','privacy-purpose','Trace collection and use to a stated purpose',
    'Sample information from a collection channel. Check each selected field against its stated purpose, the uses that followed and the record of prior explicit consent where required. Include a refusal or withdrawal where applicable.',
    'Data inventory, purpose and consent rules, dated collection record and access or use history.','P3.1 P3.2 P4.1','A.5.34'],
  ['Privacy','privacy-retention','Test retention, holds and erasure',
    'Select an expired record and one subject to a retention hold. Trace the first through deletion and the second through continued protection. Check downstream copies against the documented schedule and any exceptions.',
    'Retention schedule, hold decision, deletion log and verification of downstream copies.','P4.2 P4.3','A.5.33 A.8.10'],
  ['Privacy','privacy-rights','Trace access, correction and accuracy checks',
    'Follow a redacted access or correction request from identity verification to the response. Inspect the decision, any explanation for refusal, changes at the source and notification of affected recipients. Sample a routine record-quality check.',
    'Request timeline, verified response, correction history, recipient follow-up and quality review.','P5.1 P5.2 P7.1','A.5.34'],
  ['Privacy','privacy-disclosure','Reconcile an authorised disclosure with the disclosure record',
    'Select a transfer to a third party. Check prior authorisation and consent against the data and recipient, then reconcile the transfer to the disclosure log. Test whether the team can account for data held and shared when a person asks.',
    'Transfer authorisation, consent record, disclosure entry and a redacted accounting response.','P6.1 P6.2 P6.7','A.5.14 A.5.34'],
  ['Privacy','privacy-supplier','Test a supplier’s privacy commitments',
    'Inspect a supplier agreement for permitted use and notification duties. Follow a periodic supplier review and a reported or exercised disclosure through escalation and corrective follow-up.',
    'Signed privacy terms, supplier review, notification timeline and corrective work.','P6.4 P6.5','A.5.20 A.5.22'],
  ['Privacy','privacy-incident','Reconcile unauthorised disclosures to notification decisions',
    'Trace a reported or exercised unauthorised disclosure into the incident register. Reconcile the affected population, parties considered for notice, decision authority and actual communication dates. Verify outstanding actions.',
    'Incident entry, impact assessment, notification decisions, delivery records and action owners.','P6.3 P6.6','A.5.24 A.5.26 A.5.34'],
  ['Privacy','privacy-complaint','Review a privacy complaint and the resulting correction',
    'Trace an inquiry, complaint or dispute from receipt to resolution and communication. Check periodic monitoring for similar issues and verify any corrective action against a subsequent sample.',
    'Complaint log, response, monitoring report and dated effectiveness check.','P8.1','A.5.34 A.5.36']
];

export const scopedSecurityProgramme={
  id:'soc2-iso27001-scoped',version:1,title:'SOC 2 and ISO/IEC 27001 with selectable trust services categories',
  description:'Start with SOC 2 Security and ISO/IEC 27001:2022. Add Availability, Confidentiality, Processing Integrity or Privacy to match the buyer’s scope. The full plan covers 61 SOC 2 criteria, 93 Annex A controls and 30 management clause references.',
  items:[...jointSecurityProgramme.items,...tests.map(([scopeCategory,key,title,description,evidenceHint,soc,iso])=>({
    key,title,description,evidenceHint,scopeCategory,sourceUrl,suggestedDays:21,
    why:'The sample tests the service commitments selected for '+scopeCategory+' and identifies evidence that can also be reviewed for the listed ISO controls.',
    mappings:[...soc.split(' ').map(code=>'SOC 2 '+scopeCategory+' · '+code),...iso.split(' ').map(code=>'ISO/IEC 27001:2022 · '+code)]
  }))]
};
