import {workUuid} from './work-hub.mjs';

/** Only identifiers travel in a handoff. Membership and the verified recipient
 * are checked by the application after sign-in; this link grants no access. */
export function teamHandoff(search=''){
 const params=new URLSearchParams(search),values={organizationId:'',invitationId:'',taskId:''};
 for(const key of Object.keys(values)){
  const entries=params.getAll(key);
  if(entries.length>1||entries.length===1&&!workUuid(entries[0]))return {...values,error:'This team link contains an invalid identifier. Ask the owner for a fresh invitation link.'};
  if(entries.length)values[key]=entries[0].toLowerCase();
 }
 if((values.invitationId||values.taskId)&&!values.organizationId)return {...values,error:'This team link is missing its organisation. Ask the owner for a fresh invitation link.'};
 return {...values,error:''};
}
export function teamInvitationHref(organizationId,invitationId,taskId=''){
 if(!workUuid(organizationId)||!workUuid(invitationId)||taskId&&!workUuid(taskId))return null;
 const params=new URLSearchParams({organizationId:organizationId.toLowerCase(),invitationId:invitationId.toLowerCase()});
 if(taskId)params.set('taskId',taskId.toLowerCase());
 return '/team/settings?'+params;
}
