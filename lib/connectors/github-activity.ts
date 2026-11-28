import type {ConnectorCheck} from './github';

type Page={body:unknown;more:boolean};
type Read=(path:string,optional:true)=>Promise<Page|null>;
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const validId=(id:unknown):id is number=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0;
const timestamp=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;

async function mergedReview(read:Read,repository:string,branch:string):Promise<ConnectorCheck>{
 const check:ConnectorCheck={id:'sampled-merge-review',label:'Sampled merge had an independent approval for its final head',
  status:'UNKNOWN',observed:'No assessable merged pull request in the five most recently updated closed pull requests for this branch.',
  nextStep:'Review pull request access, the sampled merge and its review history in GitHub.'};
 const query=new URLSearchParams({state:'closed',base:branch,sort:'updated',direction:'desc',per_page:'5'});
 const pulls=await read('/pulls?'+query,true);
 if(!Array.isArray(pulls?.body)||pulls.body.length>5)return check;
 for(const raw of pulls.body){
  const pull=object(raw),base=object(pull.base),name=object(base.repo).full_name;
  if(typeof name!=='string'||name.toLowerCase()!==repository.toLowerCase()||base.ref!==branch)return check;
  if(pull.merged_at===null)continue;
  const merged=timestamp(pull.merged_at),author=object(pull.user).id,sha=object(pull.head).sha;
  if(!validId(pull.number)||!Number.isFinite(merged)||!validId(author)||typeof sha!=='string'||!/^[a-f0-9]{40}$/i.test(sha))return check;
  check.observed='The review history could not establish an approval for the sampled merge.';
  const reviews=await read('/pulls/'+pull.number+'/reviews?per_page=50',true);
  if(!Array.isArray(reviews?.body)||reviews.body.length>50)return check;
  let complete=!reviews.more;
  for(const item of reviews.body){
   const review=object(item);
   if(!['APPROVED','DISMISSED','CHANGES_REQUESTED','COMMENTED','PENDING'].includes(String(review.state))){complete=false;continue;}
   // GitHub can replace a prior approval with DISMISSED without exposing its original state.
   if(review.state==='DISMISSED'){complete=false;continue;}
   if(review.state!=='APPROVED')continue;
   const reviewer=object(review.user).id,submitted=timestamp(review.submitted_at);
   if(!validId(reviewer)||!Number.isFinite(submitted)||typeof review.commit_id!=='string'||!/^[a-f0-9]{40}$/i.test(review.commit_id)){complete=false;continue;}
   if(reviewer!==author&&submitted<=merged&&review.commit_id.toLowerCase()===sha.toLowerCase())
    return {...check,status:'PASS',observed:'An independent approval was recorded for the final head at or before merge.'};
  }
  return complete?{...check,status:'FAIL',observed:'The returned review history contained no independent approval for the final head at or before merge.'}:check;
 }
 return check;
}

export async function githubActivityChecks(read:Read,repository:string,branch:string):Promise<ConnectorCheck[]>{
 const review=await mergedReview(read,repository,branch);
 const alerts=await read('/dependabot/alerts?state=open&severity=high,critical&per_page=1',true);
 const check:ConnectorCheck={id:'dependabot-open-high-critical',label:'No open high or critical Dependabot alerts returned',
  status:'UNKNOWN',observed:'The filtered alert list was unavailable or inconclusive.',nextStep:'Review Dependabot alerts and the account’s read access for this repository.'};
 if(Array.isArray(alerts?.body)){
  if(!alerts.more&&alerts.body.length===0){
   check.status='PASS';check.observed='GitHub returned an empty list for this repository and severity filter.';
  }else if(alerts.body.length===1){
   const alert=object(alerts.body[0]),name=object(alert.repository).full_name;
   const severity=object(alert.security_vulnerability).severity;
   if((alert.repository===undefined||typeof name==='string'&&name.toLowerCase()===repository.toLowerCase())&&
      alert.state==='open'&&['high','critical'].includes(String(severity))){
    check.status='FAIL';check.observed='GitHub returned at least one open high or critical alert.';
   }
  }
 }
 return [review,check];
}
