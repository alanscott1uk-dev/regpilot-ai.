import {z} from 'zod';
import {providerReader,booleanCheck} from './bounded-http';
import {CollectionError} from './collection-error';
import {atStep} from './collection-step';
import type {Observation} from './observation';

const hostname=z.string().max(100).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/);
const giteaHost=hostname.refine(host=>host==='gitea.com'||host===process.env.REGPILOT_GITEA_HOST);
const grafanaHost=hostname.refine(host=>/^[a-z0-9-]+\.grafana\.net$/.test(host)||host===process.env.REGPILOT_GRAFANA_HOST);
export const applicationTargets={
 GITEA_REPOSITORY:z.object({scope:giteaHost,record:z.string().max(95).regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/),reference:z.string().max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/).refine(s=>!s.includes('..')&&!s.includes('//')&&!s.endsWith('/'))}),
 GRAFANA_DASHBOARD:z.object({scope:grafanaHost,record:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),reference:z.string().regex(/^[1-9]\d{0,12}\/[1-9]\d{0,9}$/)})
};
type Target={scope:string;record:string;reference:string};
export async function collectApplication(provider:keyof typeof applicationTargets,target:Target,token:string,fetcher:typeof fetch):Promise<Observation>{
 const {scope,record,reference}=applicationTargets[provider].parse(target);
 const origin='https://'+scope;
 const get=providerReader(fetcher,{Authorization:(provider==='GITEA_REPOSITORY'?'token ':'Bearer ')+token});
 if(provider==='GITEA_REPOSITORY'){
  const repo=origin+'/api/v1/repos/'+record;
  const row=(await atStep('repository',()=>get(repo)))!.body;
  if(typeof row?.full_name!=='string'||row.full_name.toLowerCase()!==record)throw new CollectionError('TARGET_MISMATCH',undefined,'repository');
  const branch=(await atStep('branch',()=>get(repo+'/branches/'+encodeURIComponent(reference))))!.body;
  if(branch?.name!==reference)throw new CollectionError('TARGET_MISMATCH',undefined,'branch');
  return {engine:'gitea-repository-1',sourceUrl:origin+'/'+record,capturedAt:new Date().toISOString(),
   checks:[booleanCheck('private','Repository access is private',row.private,true,'Review repository visibility.'),
    booleanCheck('default-branch','Approved branch is the default',typeof row.default_branch==='string'?row.default_branch===reference:undefined,true,'Check the default branch against the approved target.'),
    booleanCheck('protected','Approved branch is protected',branch.protected,true,'Review branch protection on the named branch.')],
   limitations:['Checks cover the named repository and branch at collection time.']};
 }
 const [organisation,approvedVersion]=reference.split('/');
 const org=(await atStep('grafana-org',()=>get(origin+'/api/org')))!.body;
 if(!Number.isSafeInteger(org?.id)||String(org.id)!==organisation)throw new CollectionError('TARGET_MISMATCH',undefined,'grafana-org');
 const dashboard=(await atStep('dashboard',()=>get(origin+'/api/dashboards/uid/'+record)))!.body?.dashboard;
 if(dashboard?.uid!==record)throw new CollectionError('TARGET_MISMATCH',undefined,'dashboard');
 const version=Number.isSafeInteger(dashboard.version)&&dashboard.version>0?String(dashboard.version):null;
 return {engine:'grafana-dashboard-1',sourceUrl:origin+'/d/'+record,capturedAt:new Date().toISOString(),
  checks:[{...booleanCheck('reviewed-version','Dashboard matches the approved version',version===null?undefined:version===approvedVersion,true,'Review the published dashboard revision against the approved monitoring configuration.'),observed:version??'Not established'}],
  limitations:['The revision check covers one monitoring dashboard in the selected organisation. Dashboard queries and panel data are excluded from the receipt.']};
}
