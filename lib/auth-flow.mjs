import {workUuid} from './work-hub.mjs';
// Never display provider descriptions or accept a caller-supplied return URL.
const destinations=new Set(['/sop-builder','/team','/team/settings','/team/work/reviews','/ai','/auditor','/trust','/trust/directory','/regulator-accounts','/team/accounting','/team/risks/group','/team/trials','/team/services/costs','/team/evaluations/territories',...['setup','ai-inventory','programmes','risks','products','knowledge','quality','training','developers','effectivity','integrations','evaluations','operations','work','sources','coverage','intelligence','evidence','assurance','briefing','audits','people','vendors','audit-requests','changes','access-reviews','answers','questionnaires','trust'].map(p=>'/team/'+p)]);
export const AUTH_PARAMETERS=['code','sb_flow_id','error','error_code','error_description','access_token','refresh_token','provider_token','provider_refresh_token','expires_in','expires_at','token_type','type'];
export function signInDestination(path){
 if(typeof path==='string'&&path.startsWith('/trust/directory?id=')&&workUuid(path.slice('/trust/directory?id='.length)))return path;
 return destinations.has(path)?path:'/team';
}
// Keep task identifiers on this device. The email provider receives the existing work callback only.
export const WORK_RETURN_KEY = 'regpilot.task-return.v1';
export function taskReturnIntent(path, search, email, now = Date.now()) {
 const params = new URLSearchParams(search);
 const organizationId = params.get('organizationId'), taskId = params.get('taskId');
 if (!['/team/work', '/team/evidence'].includes(path) || !workUuid(organizationId) || !workUuid(taskId)) return null;
 return {path, organizationId, taskId, email:email.trim().toLowerCase(), createdAt:now};
}
export function taskReturnPath(value, email, now = Date.now()) {
 if (!value || typeof email !== 'string' || email.toLowerCase() !== value.email ||
     !Number.isFinite(value.createdAt) || now < value.createdAt || now - value.createdAt > 3600000) return null;
 if (!['/team/work', '/team/evidence'].includes(value.path) || !workUuid(value.organizationId) || !workUuid(value.taskId)) return null;
 return value.path+'?'+new URLSearchParams({organizationId:value.organizationId,taskId:value.taskId});
}
// Keep the selected organisation on this device; the email callback contains no
// tenant identifier, task details, arbitrary URL, token or source text.
export function workspaceReturnIntent(path,search,email,now=Date.now()){
 if(!destinations.has(path)||!path.startsWith('/team/')||typeof email!=='string')return null;
 const params=new URLSearchParams(search),organizationId=params.get('organizationId');
 if(path==='/team/programmes'&&params.has('starter')){
  const starter=params.get('starter');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(starter)||starter.length>64||params.getAll('starter').length!==1||params.has('programmeId')||params.getAll('organizationId').length>1||organizationId!==null&&!workUuid(organizationId))return null;
  return {kind:'workspace',path,values:{starter,...(organizationId?{organizationId}:{})},email:email.trim().toLowerCase(),createdAt:now};
 }
 if(path==='/team/trials'&&params.has('participant')){
  const participant=params.get('participant'),release=params.get('release');
  if(!['operator','assessor'].includes(participant)||!release||!/^[a-f0-9]{40}$/.test(release)||
    ['participant','release','organizationId'].some(key=>params.getAll(key).length>1)||(organizationId!==null&&!workUuid(organizationId)))return null;
  return {kind:'workspace',path,values:{participant,release,...(organizationId?{organizationId}:{})},email:email.trim().toLowerCase(),createdAt:now};
 }
 if(['organizationId','taskId','sourceId',...(path==='/team/settings'?['invitationId']:[]),...(path==='/team/assurance'?['assessmentId']:[]),...(path==='/team/programmes'?['programmeId']:[]),...(path==='/team/risks'?['riskId']:[]),...(path==='/team/ai-inventory'?['systemId']:[]),...(path==='/team/quality'?['caseId']:[]),...(path==='/team/training'?['curriculumId','trainingId']:[]),...(path==='/team/developers'?['credentialId','observationId','monitor']:[]),...(path==='/team/effectivity'?['policyId','releaseId','challengeId']:[]),...(path==='/team/integrations'?['endpointId','deliveryId']:[]),...(path==='/team/evaluations'?['caseId','runId']:[]),...(['/team/products','/team/knowledge'].includes(path)?['productId']:[]),...(path==='/team/knowledge'?['evidenceId']:[]),...(['/team/evidence','/team/assurance'].includes(path)?['evidenceId']:[]),...(['/team/questionnaires','/team/answers','/team/trust'].includes(path)?['questionnaireId']:[]),...(['/team/questionnaires','/team/answers'].includes(path)?['questionId','answerId']:[])].some(key=>params.getAll(key).length>1))return null;
 if(!workUuid(organizationId))return null;
 const values={organizationId};
 for(const [key,target] of [['programmeId','/team/programmes'],['riskId','/team/risks'],['systemId','/team/ai-inventory'],['caseId','/team/quality'],['curriculumId','/team/training'],['trainingId','/team/training'],['credentialId','/team/developers'],['observationId','/team/developers'],['monitor','/team/developers'],['policyId','/team/effectivity'],['releaseId','/team/effectivity'],['challengeId','/team/effectivity'],['endpointId','/team/integrations'],['deliveryId','/team/integrations'],['caseId','/team/evaluations'],['runId','/team/evaluations'],['productId','/team/products'],['productId','/team/knowledge']]){if(path===target&&params.has(key)){const id=params.get(key);if(!workUuid(id))return null;values[key]=id;}}
 if(['/team/questionnaires','/team/answers','/team/trust'].includes(path)&&params.has('questionnaireId')){const id=params.get('questionnaireId');if(!workUuid(id))return null;values.questionnaireId=id;}
 if(['/team/questionnaires','/team/answers'].includes(path)&&params.has('questionId')){const id=params.get('questionId');if(!workUuid(id)||!values.questionnaireId)return null;values.questionId=id;}
 if(['/team/questionnaires','/team/answers'].includes(path)&&params.has('answerId')){const id=params.get('answerId');if(!workUuid(id)||path==='/team/questionnaires'&&!values.questionnaireId)return null;values.answerId=id;}
 const invitationId=params.get('invitationId');
 if(invitationId&&path==='/team/settings'){if(!workUuid(invitationId))return null;values.invitationId=invitationId;}
 const taskId=params.get('taskId'),sourceId=params.get('sourceId');
 if(taskId){if(!workUuid(taskId))return null;values.taskId=taskId;}
 const assessmentId=params.get('assessmentId');
 if(assessmentId&&path==='/team/assurance'){if(!workUuid(assessmentId)||!workUuid(taskId))return null;values.assessmentId=assessmentId;}
 const evidenceId=params.get('evidenceId');
 if(params.has('evidenceId')&&['/team/evidence','/team/assurance','/team/knowledge'].includes(path)){
  if(!workUuid(evidenceId)||path==='/team/assurance'&&(!workUuid(taskId)||params.has('assessmentId')))return null;
  values.evidenceId=evidenceId;
 }
 if(sourceId){if(!/^[a-z0-9][a-z0-9.-]{0,119}$/i.test(sourceId))return null;values.sourceId=sourceId;}
 const view=params.get('view');if(path==='/team/operations'&&['today','programme','controls','connections'].includes(view))values.view=view;
 return {kind:'workspace',path,values,email:email.trim().toLowerCase(),createdAt:now};
}
export function workspaceReturnPath(value,email,now=Date.now()){
 if(!value||value.kind!=='workspace'||typeof email!=='string'||email.toLowerCase()!==value.email||!Number.isFinite(value.createdAt)||now<value.createdAt||now-value.createdAt>3600000)return null;
 if(!value.values||typeof value.values!=='object')return null;
 const checked=workspaceReturnIntent(value.path,new URLSearchParams(value.values).toString(),email,value.createdAt);
 return checked?checked.path+'?'+new URLSearchParams(checked.values):null;
}
export function callbackInfo(search='',hash=''){
 const q=new URLSearchParams(search),h=new URLSearchParams(hash.replace(/^#/,''));
 const value=k=>q.get(k)||h.get(k);
 if(!['code','error','error_code','error_description','access_token','refresh_token'].some(k=>value(k)))return null;
 return {hasCode:!!value('code'),hasError:!!(value('error')||value('error_code')||value('error_description')),legacy:!!(value('access_token')||value('refresh_token')),errorCode:value('error_code')||'',recovery:value('type')==='recovery'};
}
export function cleanAuthUrl(href){
 const url=new URL(href),hash=new URLSearchParams(url.hash.slice(1));
 // Remember whether the fragment contained credentials before deleting them.
 // Otherwise callbackInfo() sees an already-clean fragment and leaves secrets in the address bar.
 const hasAuthFragment=AUTH_PARAMETERS.some(key=>hash.has(key));
 for(const key of AUTH_PARAMETERS){url.searchParams.delete(key);hash.delete(key);}
 // Preserve ordinary hash anchors exactly; only rewrite auth-related fragments.
 if(hasAuthFragment)url.hash=hash.toString();
 return url.pathname+url.search+url.hash;
}
export function authProblem(error){
 const code=error&&typeof error==='object'?error.code:undefined;
 const status=error&&typeof error==='object'?error.status:undefined;
 if(code==='over_email_send_rate_limit')return {kind:'email_limit',seconds:3600,message:'Sign-in emails are temporarily limited for this workspace. Check your inbox and junk folder for the latest link already requested. If none arrived, wait before requesting another. Your administrator may need to configure the email service.'};
 if(code==='over_request_rate_limit'||status===429)return {kind:'request_limit',seconds:60,message:'Too many sign-in requests. Please wait before trying again.'};
 if(['otp_expired','flow_state_expired','flow_state_not_found'].includes(code))return {kind:'expired',seconds:0,message:'This sign-in link has expired or was already used. Request a fresh link and open it in the browser where you requested it.'};
 if(['bad_code_verifier','flow_state_not_found_browser','pkce_verifier_missing'].includes(code))return {kind:'browser',seconds:0,message:'This link could not be matched to this browser. Open it on the same device, browser and RegPilot site where you requested it. If it still fails, ask your administrator to check the sign-in redirect settings.'};
 return {kind:'unavailable',seconds:0,message:'Sign-in could not be completed. Use your approved pilot email and try again. If this continues, ask your administrator to check email delivery and redirect settings.'};
}
export function cooldownSeconds(until,now=Date.now()){
 return Number.isFinite(until)?Math.max(0,Math.min(3600,Math.ceil((until-now)/1000))):0;
}
// Preserve a PKCE return through the server-side home redirect; never forward tokens or arbitrary destinations.
export function homeDestination(params={}){
 const query=new URLSearchParams();
 for(const key of ['code','sb_flow_id','error','error_code']){
  const value=params[key];if(typeof value==='string'&&value.length<=2048)query.set(key,value);
 }
 return query.has('code')||query.has('error')||query.has('error_code')?'/team?'+query.toString():'/team/operations';
}
export async function resolveSignInReturn(info,path,auth,hasUnconsumedCode,resumeForEmail = (/** @type {string} */ _email) => /** @type {string|null} */ (null)){
 const destination=signInDestination(path);
 const fail=error=>({ok:false,message:authProblem(error).message,destination});
 try{
  const initialized=await auth.initialize();
  if(info.hasError||initialized.error)return fail(initialized.error||{code:info.errorCode});
  if(info.legacy||info.recovery)return {ok:false,message:'This link is not a supported workspace sign-in link. Request a new sign-in link from your private workspace.',destination};
  if(info.hasCode&&hasUnconsumedCode())return fail({code:'pkce_verifier_missing'});
  const {data,error}=await auth.getSession();
  if(error||!data.session)return fail(error||{code:'pkce_verifier_missing'});
  const verified=await auth.getUser();
  if(verified.error||!verified.data.user)return fail(verified.error);
  const resumed = destination.startsWith('/team') ? resumeForEmail(verified.data.user.email) : null;
  return {ok:true,message:'Your sign-in link was verified.',destination:resumed || destination};
 }catch(error){return fail(error);}
}
