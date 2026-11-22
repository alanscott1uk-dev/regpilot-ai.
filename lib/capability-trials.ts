import {benchmarkProductById} from './benchmark-products';
import {z} from 'zod';
export type TrialStep={id:string;title:string;row:number};
type Track={title:string;steps:TrialStep[]};
const step=(row:number,id:string,title:string)=>({row,id,title});
export const trialTracks:Record<string,Track>={
 systems:{title:'Cloud, workforce and connector recovery',steps:[
  step(7,'inventory','Compare two sandbox account inventories, omissions, two scheduled cycles and a revoked then restored grant.'),
  step(8,'leaver','Follow an authorised test leaver and aliases from HR through identity to the ticket. Verify revocation against fresh source data.'),
  step(9,'replay','Change a source record revision, replay its delivery and rotate its credential. Inspect the receiving tenant and distinct receipt count.')]},
 research:{title:'Territorial applicability, operator research and SOP drafting',steps:[
  step(11,'territory','Score unseen cases by activity, nation, effective date and exact source version. Record false alerts and missed changes, including GB and NI.'),
  step(12,'answer','Independently score SOPs, temperature mappping, a leaver and a food or manufacturing question against withheld references. Record unsupported claims and appropriate abstentions.'),
  step(13,'draft','Time an unfamiliar operating question through the first usable SOP. Record unsupported statements and required reviewer edits.')]},
 quality:{title:'Controlled release, retraining, effectiveness and audit',steps:[
  step(14,'release','Trace the agreed intended use and requirements through exact-version signatures, superseded copies and access recovery.'),
  step(15,'retrain','Change an SOP, confirm the retraining population, and reopen CAPA after an independent failed effectiveness check.'),
  step(10,'audit','Have the named auditor sample one shared control in two scopes. Trace an accepted and a rejected evidence item to its version.')]},
 suppliers:{title:'Supplier identity, consent and external recordkeeping',steps:[
  step(16,'licence','Compare matched and wrong premises, similar names and a changed or missing authorisation. Check the activity, date and reviewer.'),
  step(17,'tiers','Exercise an authorised supplier assessment and consented tier-two relationship. Test expiry, dispute and withdrawal before disclosure.'),
  step(21,'model','Observe a real model inventory and a changed vendor model. Trace the earlier decision and evidence that requires reassessment.'),
  step(22,'specialist','Import approved specialist scope and dates. Verify restricted access and deletion at the retention boundary.')]},
 assurance:{title:'Buyer assurance, portals and NHS procurement',steps:[
  step(18,'trust','Discover a published claim and request named access. Check expiry, revised wording and revocation of the underlying disclosure.'),
  step(19,'portal','Complete an authorised buyer portal round trip. Check field matches, citation, product, abstention and final human submission.'),
  step(23,'nhs','Have a supplier and sector reviewer check the current English NHS pack, source and accountable owner and review date per answer.')]},
 operations:{title:'Product releases and field records',steps:[
  step(24,'product','Trace an authorised batch release, device change or registration event to its external identifier, source version and responsible decision maker.'),
  step(25,'field','Trace a calibrated reading and excursion through signed follow-up, or a food hazard through verified corrective action.')]},
 business:{title:'Group finance, onboarding and support',steps:[
  step(20,'group','Have a finance owner review assumptions and treatment costs, add a local exception and leave a missing entity unknown.'),
  step(26,'onboard','Time the first evidence from a new operator. Inspect the subscription scope, allowances, and measured representative tenant cost.'),
  step(28,'help','Time unaided recovery from a failed connection or missing source, including the point of escalation and the responsible guide owner.')]},
 hosted:{title:'Hosted recovery and isolation',steps:[
  step(27,'hosted','Exercise two isolated companies, upload and scan real test evidence, restore and rollback, provider alerts, revocation and hand-off to an independent auditor. Record owners and timings.')]},
};
export const trialEnvironments=['FIXTURE','PARTNER_SANDBOX','PROTECTED_PILOT'] as const;
export const trialStart=z.object({action:z.literal('START'),requestKey:z.uuid(),track:z.string().refine(k=>Object.hasOwn(trialTracks,k)),steps:z.array(z.string().max(30)).min(1).max(6),release:z.string().regex(/^[a-f0-9]{40}$/),environment:z.enum(trialEnvironments),intendedUse:z.string().trim().min(15).max(360),ukExternal:z.boolean()}).strict();
export const trialResult=z.object({step:z.string().max(30),outcome:z.enum(['PASS','FAIL','UNOBSERVED']),evidenceId:z.uuid().nullable(),notes:z.string().trim().min(10).max(600),unsupported:z.number().int().min(0).max(1000),edits:z.number().int().min(0).max(1000),assisted:z.boolean()}).strict();
const comparison=z.object({
 productId:z.string().refine(id=>benchmarkProductById.has(id),'Choose a workbook comparator').optional(),
 method:z.string().trim().min(3).max(120),elapsedSeconds:z.number().int().min(1).max(2592000),
 edits:z.number().int().min(0).max(6000),evidenceId:z.uuid(),sameTasks:z.literal(true)
}).strict();
export const trialFinish=z.object({comparison:comparison.optional(),action:z.literal('FINISH'),id:z.uuid(),results:z.array(trialResult).min(1).max(6)}).strict();
export const trialReview=z.object({action:z.literal('REVIEW'),id:z.uuid(),decision:z.enum(['ACCEPT','REJECT']),notes:z.string().trim().min(20).max(800)}).strict();
export const trialStop=z.object({action:z.literal('STOP'),id:z.uuid()}).strict();
export const trialAction=z.discriminatedUnion('action',[trialStart,trialStop,trialFinish,trialReview]);
