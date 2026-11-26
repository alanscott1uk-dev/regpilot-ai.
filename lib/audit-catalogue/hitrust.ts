import {createHash} from 'node:crypto';
import type {AuditControl,Profile} from './catalogue';

export const hitrustTiers=['e1','i1','r2'] as const;
export type HitrustTier=typeof hitrustTiers[number];
export const myCsfSource='https://hitrustalliance.net/mycsf';
// These are RegPilot workpapers. Only an authorised subscriber's MyCSF assessment supplies its actual requirement identifiers and scope.
const workpapers=[
  ['boundary','Define the assessment boundary','Reconcile the systems, sites and services in scope with the customer’s inventory. Record the period and the accountable owner.','Dated inventory, boundary statement and approval'],
  ['identity','Sample access grants and removals','Trace a joiner and a leaver from authorisation to the access change. Compare the recorded dates and investigate exceptions.','Access approval, identity-provider history and leaver record'],
  ['privilege','Review privileged access','Select an administrative account and verify the business need, independent approval and most recent access review.','Privileged-role export, approval and review decision'],
  ['changes','Trace a production change','Select a deployed change and reconcile its review, test result and deployment time with the release record.','Change ticket, reviewed change and deployment receipt'],
  ['recovery','Demonstrate recovery','Select an in-scope system, recover a representative record from backup and compare it with the approved recovery objective.','Restore log, integrity check and signed test outcome'],
  ['incident','Follow an incident through closure','Trace a real incident or labelled exercise from detection through response, review and closure.','Event timeline, assigned actions and closure decision'],
  ['supplier','Review a supplier dependency','Select a supplier supporting the assessment boundary. Trace its agreed responsibilities to an oversight decision.','Supplier agreement, current assurance evidence and follow-up'],
  ['coverage','Check the evidence population','Reconcile the systems producing monitoring evidence to the inventory. Record exclusions and the owner of each uncovered system.','Inventory reconciliation, dated monitoring output and exceptions'],
  ['exceptions','Retest a corrective action','Take a recorded exception through remediation and independent retest. Identify the evidence that justified closure.','Original finding, corrective task and dated retest'],
  ['risk','Trace a risk decision','Select a risk accepted for an in-scope service. Check the decision maker, treatment deadline and evidence supporting the decision.','Risk register entry, decision authority and treatment progress'],
  ['policy','Trace approval and communication of policy','Select one policy used within the boundary. Verify the approved version, effective date and acknowledgement by affected staff.','Approved revision, effective date and acknowledgement sample'],
  ['procedure','Observe an operating procedure','Compare an approved procedure with a dated instance of its execution. Investigate any difference between the procedure and the record.','Procedure revision, execution record and review notes'],
  ['measurement','Reproduce a performance measure','Recalculate a reported control measure for a defined period from its source records. Record the denominator and exceptions.','Measurement definition, source population and recalculation'],
  ['management','Trace management action','Take a performance exception through management review, decision and subsequent verification of the action taken.','Review minutes, authorised action and follow-up result']
] as const;
const sizes={e1:6,i1:9,r2:14};
const digest=createHash('sha256').update(JSON.stringify({workpapers,sizes})).digest('hex');
export const hitrustProfiles:Profile[]=hitrustTiers.map(tier=>({
  id:'hitrust-'+tier,family:'hitrust',name:'HITRUST '+tier+' evidence preparation',label:'HITRUST '+tier,
  region:'International',publisher:'RegPilot workpapers',source:'preparation',url:myCsfSource,count:sizes[tier],digest
}));
export function preparationTier(id:string){return hitrustTiers.find(tier=>id==='hitrust-'+tier);}
export function preparationRows(profile:Profile){
  const tier=preparationTier(profile.id);
  return tier?workpapers.slice(0,sizes[tier]):[];
}
export function preparationControl(profile:Profile,id:string):AuditControl|undefined{
  const paper=preparationRows(profile).find(row=>id==='RP-'+row[0]);
  if(!paper)return;
  return {id,name:paper[1],domain:'Evidence preparation',description:paper[2],reference:'RegPilot workpaper '+id,
    url:'/audit-programmes/frameworks/'+profile.id+'?q='+id,objectives:[],evidence:[{id,name:paper[3],description:''}]};
}
