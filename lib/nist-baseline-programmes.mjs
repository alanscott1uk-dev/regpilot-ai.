import {profiles,revision,controlTitles} from './nist-baseline-data.mjs';
const families={
 ac:['Review access restrictions','Trace an approved identity, privilege change and removal to the effective permissions.','Identity inventory, access approvals and dated entitlement review.'],
 at:['Test staff training and awareness','Select personnel with different duties. Trace assigned learning to completion and a role-specific assessment.','Role matrix, course versions and competence records.'],
 au:['Reconcile audit records','Reperform a sample of events across logging, storage, retention and independent review.','Time-stamped source events, retention settings and a completed review.'],
 ca:['Review assessment and authorisation','Trace an assessment finding through remediation, acceptance and subsequent monitoring.','Assessment plan, finding, action and approval records.'],
 cm:['Test configuration management','Select a deployed change and reconcile its approved baseline, implementation and detected drift.','Configuration history, inventory and a sampled change approval.'],
 cp:['Exercise contingency arrangements','Choose a critical process and trace a recovery exercise through restoration and verification of the service.','Contingency plan, observed recovery times and follow-up actions.'],
 ia:['Verify identity and authentication','Sample enrolment, authenticator renewal and deactivation for people and service accounts.','Credential lifecycle evidence and an access review.'],
 ir:['Exercise incident response','Trace a reported event from triage through containment, notification and lessons learned.','Incident log, incident exercise and decision records.'],
 ma:['Check maintenance records','Select maintenance work and verify the authorisation, tools, operator and return to service.','Maintenance requests, access grants and completion checks.'],
 mp:['Trace information media','Sample media from custody through transport or approved disposal and reconcile its identifier.','Asset register, custody log and sanitisation evidence.'],
 pe:['Test physical protection','Sample site and equipment access, environmental monitoring and response to a recorded exception.','Visitor and access logs, alarms and reviewed exceptions.'],
 pl:['Verify system security planning','Compare the plan with the current system boundary, roles, dependencies and architecture.','Approved system plan, boundary diagram and revision history.'],
 pm:['Review programme governance','Trace privacy and security policy decisions from governance review to resourcing and oversight.','Programme charter, decisions, ownership and management reporting.'],
 ps:['Check personnel safeguards','Sample onboarding, role transfer and departure against the duties assigned to the personnel team.','Authorised personnel records and dated access or duty changes.'],
 pt:['Test personal information processing','Trace one data flow through authority, stated purpose, notice and any required choices.','Documented processing purposes, notices and decision records.'],
 ra:['Assess system and privacy risks','Follow a material risk from identification and impact assessment through a dated treatment decision.','Risk register, assessment report and approved treatment.'],
 sa:['Sample acquisition and development','Trace supplier or software requirements from selection through acceptance and operation.','Requirements, test evidence and acquisition decisions.'],
 sc:['Verify system and communication protection','Trace a representative connection across its trust boundary and inspect the protection applied.','Service flow, boundary settings and test evidence.'],
 si:['Check system and information integrity','Trace a detected flaw, integrity warning or monitoring event to validation and correction.','Monitoring outputs, remediation and verification records.'],
 sr:['Review supply chain risk','Select a critical dependency and follow its risk decision through contract, monitoring and change.','Supplier risk assessment, contract controls and follow-up.']
};
const prefix='NIST SP 800-53 Rev. 5 · ';
const code=id=>id.toUpperCase().replace(/\.(\d+)$/,'($1)');
export function nistControlTitle(reference){
 if(!reference.startsWith(prefix))return '';
 const id=reference.slice(prefix.length).toLowerCase().replace(/\((\d+)\)$/,'.$1');
 return controlTitles[id]??'';
}
export const nistBaselineProgrammes=Object.entries(profiles).map(([name,profile])=>{
 const ids=profile.controls.split(' '),title=name[0]+name.slice(1).toLowerCase();
 const sourceUrl='https://github.com/usnistgov/oscal-content/blob/'+revision+'/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_'+name+'-baseline_profile.json';
 return {id:'nist-800-53b-'+name.toLowerCase(),version:1,title:'NIST SP 800-53B · '+title+' baseline',
  description:'Scope and assign the '+ids.length+' controls and enhancements in the '+title.toLowerCase()+' baseline, release 5.2.0. Record tailoring decisions and evidence for each reference.',
  items:Object.entries(families).flatMap(([key,[title,procedure,evidenceHint]])=>{
   const mappings=ids.filter(id=>id.startsWith(key+'-')).map(id=>prefix+code(id));
   return mappings.length?[{key,title,description:procedure+' Review the selected controls and enhancements individually in the statement of applicability.',why:'The baseline includes '+mappings.length+' references in this family. Record how each applies to the agreed system boundary.',evidenceHint,sourceUrl,mappings,suggestedDays:21}]:[];
  })};
});
