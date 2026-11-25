import type {ConnectorCheck} from './github';

type RecordValue=Record<string,unknown>;
type Policy={id:string;label:string;nextStep:string;evaluate:(repo:RecordValue,now:number)=>boolean|null};
const record=(v:unknown):RecordValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:{};
function securitySetting(repo:RecordValue,name:string){
 const status=record(record(repo.security_and_analysis)[name]).status;
 return status==='enabled'?true:status==='disabled'?false:null;
}

// The archive, merge and scanning checks use the repository settings tested by the pinned cloud
// policy catalogue. The hosted read can omit restricted settings, so their absence is inconclusive.
const policies:Policy[]=[
 {id:'github-repository-enabled',label:'Repository access is enabled',nextStep:'Investigate repositories GitHub has disabled.',
  evaluate:r=>typeof r.disabled==='boolean'?!r.disabled:null},
 {id:'repository_inactive_not_archived',label:'Inactive repositories are archived after 180 days',nextStep:'Review inactive repositories and confirm which should be archived.',
  evaluate:(r,now)=>{
   if(r.archived===true)return true;
   const last=typeof r.pushed_at==='string'?Date.parse(r.pushed_at):NaN;
   return r.archived===false&&Number.isFinite(last)&&last<=now?now-last<180*86400000:null;
  }},
 {id:'repository_branch_delete_on_merge_enabled',label:'Merged branches are deleted automatically',nextStep:'Review the automatic branch deletion setting.',
  evaluate:r=>typeof r.delete_branch_on_merge==='boolean'?r.delete_branch_on_merge:null},
 {id:'repository_secret_scanning_enabled',label:'Secret scanning is enabled',nextStep:'Review secret scanning in the repository security settings.',
  evaluate:r=>securitySetting(r,'secret_scanning')},
 {id:'repository_secret_scanning_push_protection_enabled',label:'Secret scanning push protection is enabled',nextStep:'Review push protection in the repository security settings.',
  evaluate:r=>securitySetting(r,'secret_scanning_push_protection')}
];

export const githubInventoryRevision=2;
export const githubInventoryLabels=new Map(policies.map(p=>[p.id,p.label]));
export function githubInventoryChecks(rows:unknown[],now=Date.now()):ConnectorCheck[]{
 return policies.map(({id,label,nextStep,evaluate})=>{
  let passed=0,failed=0;
  for(const row of rows){
   const result=evaluate(record(row),now);
   if(result===true)passed++;else if(result===false)failed++;
  }
  const unknown=rows.length-passed-failed;
  const status=failed?'FAIL':unknown||!rows.length?'UNKNOWN':'PASS';
  return {id,label,status,observed:passed+' passed, '+failed+' failed, '+unknown+' unknown across '+rows.length+' repositories.',nextStep};
 });
}
