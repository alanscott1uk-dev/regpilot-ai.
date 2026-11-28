import {isoAnnexProgramme} from './iso-annex-programme.mjs';
import {socSecurityProgramme} from './soc2-security-programme.mjs';

const isoSource='https://www.iso.org/standard/27001';
const management=[
 ['scope','Set the boundaries of the audit','Identify the service, sites, dependencies and interested parties. Record relevant internal and external issues, including whether climate change is relevant, and agree the scope with management.','Scope, service description, interested-party register and approved boundaries.','4.1 4.2 4.3 4.4'],
 ['governance','Test accountability and communication','Verify the security policy, management commitment, authority and reporting routes. Sample a decision made under the policy and trace it to the people affected.','Approved policy, responsibility assignments, meeting record and communication.','5.1 5.2 5.3 7.4'],
 ['risk-plan','Trace risks, objectives and treatment','Select a risk scenario and a planned change. Trace the assessment, treatment decision, objectives and activities through to their execution. Reconcile selected controls and justified exclusions against the site statement of applicability.','Risk assessment, treatment plan, statement of applicability, objectives and change records.','6.1.1 6.1.2 6.1.3 6.2 6.3 8.1 8.2 8.3'],
 ['support','Test staffing and controlled information','Trace the resources and competence needed to operate the system. Check awareness, approval, version history and availability of a current instruction at its point of use.','Resource review, competence sample, approved instruction, revision and withdrawal history.','7.1 7.2 7.3 7.5.1 7.5.2 7.5.3'],
 ['oversight','Trace audit findings to corrective action','Sample performance measures, the internal audit programme and management review. Trace an exception to its cause, action, effectiveness check and improvement decision.','Audit plan and results, review inputs and minutes, corrective action and retest.','9.1 9.2.1 9.2.2 9.3.1 9.3.2 9.3.3 10.1 10.2']
];
const jointActivities={
 governance:['ethics','communications'], 'risk-plan':['risk','design'], oversight:['assessment'],
 'annex-6-1':['people'], 'annex-5-15':['identity'], 'annex-7-1':['physical'],
 'annex-8-19':['boundary'], 'annex-8-15':['monitor'], 'annex-5-24':['respond'],
 'annex-8-30':['change'], 'annex-5-29':['continuity']
};
const tests=new Map(socSecurityProgramme.items.map(activity=>[activity.key,activity]));
const base=[
 ...management.map(([key,title,description,evidenceHint,clauses])=>({
  key,title,description,evidenceHint,why:'Trace the management system requirement to its owner, operating sample and review decision.',
  sourceUrl:isoSource,suggestedDays:21,mappings:clauses.split(' ').map(code=>'ISO/IEC 27001:2022 · Clause '+code)
 })),
 ...isoAnnexProgramme.items
];

export const jointSecurityProgramme={
 id:'soc2-iso27001-joint',version:1,title:'Joint SOC 2 Security and ISO/IEC 27001 audit',
 description:'Run one evidence plan for 33 SOC 2 common criteria, ISO/IEC 27001 management requirements and all 93 Annex A controls. Each reference has its own scope decision. Review the samples against your auditor’s criteria and licensed standard.',
 items:base.map(item=>{
  const shared=(jointActivities[item.key]??[]).map(key=>tests.get(key));
  if(!shared.length)return {...item,mappings:[...item.mappings]};
  return {...item,description:[item.description,...shared.map(activity=>activity.description)].join(' '),
   evidenceHint:[item.evidenceHint,...shared.map(activity=>activity.evidenceHint)].join(' '),
   mappings:[...item.mappings,...shared.flatMap(activity=>activity.mappings.filter(ref=>ref.startsWith('SOC 2 Security · ')))]};
 })
};
