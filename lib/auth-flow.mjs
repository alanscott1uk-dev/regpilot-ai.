// Never display provider descriptions or accept a caller-supplied return URL.
const destinations=new Set(['/team','/team/settings','/ai','/auditor','/trust',...['setup','operations','audits','people','vendors','audit-requests','changes','access-reviews','answers','questionnaires','trust'].map(p=>'/team/'+p)]);
export const AUTH_PARAMETERS=['code','sb_flow_id','error','error_code','error_description','access_token','refresh_token','provider_token','provider_refresh_token','expires_in','expires_at','token_type','type'];
export function signInDestination(path){return destinations.has(path)?path:'/team';}
export function callbackInfo(search='',hash=''){
 const q=new URLSearchParams(search),h=new URLSearchParams(hash.replace(/^#/,''));
 const value=k=>q.get(k)||h.get(k);
 if(!['code','error','error_code','error_description','access_token','refresh_token'].some(k=>value(k)))return null;
 return {hasCode:!!value('code'),hasError:!!(value('error')||value('error_code')||value('error_description')),legacy:!!(value('access_token')||value('refresh_token')),errorCode:value('error_code')||'',recovery:value('type')==='recovery'};
}
export function cleanAuthUrl(href){
 const url=new URL(href),hash=new URLSearchParams(url.hash.slice(1));
 for(const key of AUTH_PARAMETERS){url.searchParams.delete(key);hash.delete(key);}
 if(callbackInfo('',url.hash))url.hash=hash.toString();
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
export async function resolveSignInReturn(info,path,auth,hasUnconsumedCode){
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
  return {ok:true,message:'Your sign-in link was verified.',destination};
 }catch(error){return fail(error);}
}
