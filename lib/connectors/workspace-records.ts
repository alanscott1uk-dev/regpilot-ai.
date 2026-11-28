import {z} from 'zod';
import {CollectionError} from './collection-error';
import {atStep} from './collection-step';
import {providerReader,booleanCheck} from './bounded-http';
import type {Observation} from './observation';

const number=z.string().regex(/^[1-9]\d{0,23}$/);
const boxStates=['active','inactive','cannot_delete_edit','cannot_delete_edit_upload'] as const;
export const workspaceRecordTargets={
 SLACK_MEMBER:z.object({scope:z.string().regex(/^T[A-Z0-9]{7,20}$/),record:z.string().regex(/^[UW][A-Z0-9]{7,20}$/),reference:z.enum(['active','inactive'])}),
 BOX_USER:z.object({scope:number,record:number,reference:z.enum(boxStates)}),
 ASANA_TASK:z.object({scope:number,record:number,reference:z.enum(['complete','open'])})
};
type Provider=keyof typeof workspaceRecordTargets;
export async function collectWorkspaceRecord(provider:Provider,target:{scope:string;record:string;reference:string},token:string,fetcher:typeof fetch):Promise<Observation>{
 const {scope,record,reference}=workspaceRecordTargets[provider].parse(target);
 const read=providerReader(fetcher,{Authorization:'Bearer '+token});
 const sourceUrl=provider==='SLACK_MEMBER'?'https://slack.com/api/users.info?user='+record:provider==='BOX_USER'?'https://api.box.com/2.0/users/'+record+'?fields=id,type,enterprise,status':'https://app.asana.com/api/1.0/tasks/'+record+'?opt_fields=gid,workspace.gid,completed,assignee.gid';
 const {body}= (await atStep('record',()=>read(sourceUrl)))!;
 const fail=()=>new CollectionError('TARGET_MISMATCH',undefined,'record');
 let actual:string|undefined;
 const checks=[];
 switch(provider){
  case 'SLACK_MEMBER':{
   if(body?.ok!==true){
    const code=body?.error;
    throw new CollectionError(['invalid_auth','token_revoked','account_inactive','not_authed','token_expired'].includes(code)?'CREDENTIAL_REJECTED':code==='missing_scope'?'PERMISSION_REVOKED':code==='user_not_found'?'TARGET_MISMATCH':'INVALID_RESPONSE',undefined,'record');
   }
   if(body.user?.id!==record||body.user.team_id!==scope)throw fail();
   actual=typeof body.user.deleted==='boolean'?(body.user.deleted?'inactive':'active'):undefined;
   break;
  }
  case 'BOX_USER':{
   if(body?.type!=='user'||body.id!==record||body.enterprise?.id!==scope)throw fail();
   actual=boxStates.find(s=>body.status===s);
   break;
  }
  case 'ASANA_TASK':{
   const row=body?.data;
   if(row?.gid!==record||row.workspace?.gid!==scope)throw fail();
   actual=typeof row.completed==='boolean'?(row.completed?'complete':'open'):undefined;
   const assigned=row.assignee===null?false:number.safeParse(row.assignee?.gid).success?true:undefined;
   checks.push(booleanCheck('task-owner','Task has an assigned owner',assigned,true,'Check task ownership in the approved workspace.'));
   break;
  }
 }
 checks.unshift({...booleanCheck('expected-state','Record matches the approved state',actual===undefined?undefined:actual===reference,true,'Compare the configured state with the source owner’s decision.'),observed:actual??'Not established'});
 return {engine:provider.toLowerCase()+'-1',sourceUrl,capturedAt:new Date().toISOString(),checks,limitations:['The observed record was matched to the configured workspace or enterprise. Other accounts and records require their own checks.']};
}
