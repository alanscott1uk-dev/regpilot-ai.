import {workUuid} from '../work-hub.mjs';

/** A navigation request only. It never creates an assessment or grants access. */
export function evidenceReuseHandoff(search) {
 const params=new URLSearchParams(search);
 if(!params.has('evidenceId'))return null;
 const invalid=()=>({organizationId:'',taskId:'',evidenceId:'',error:'This evidence link is incomplete or invalid. Open the file from the Evidence Library again.'});
 if(['organizationId','taskId','evidenceId','assessmentId'].some(key=>params.getAll(key).length>1)||params.has('assessmentId'))return invalid();
 const organizationId=params.get('organizationId'),taskId=params.get('taskId'),evidenceId=params.get('evidenceId');
 if(!workUuid(organizationId)||!workUuid(taskId)||!workUuid(evidenceId))return invalid();
 return {organizationId:organizationId.toLowerCase(),taskId:taskId.toLowerCase(),evidenceId:evidenceId.toLowerCase(),error:''};
}

export function resolveEvidenceReuse(handoff,organizationId,taskId,evidence) {
 if(!handoff)return {evidenceId:'',filename:'',error:''};
 if(handoff.error)return {evidenceId:'',filename:'',error:handoff.error};
 if(handoff.organizationId!==organizationId||handoff.taskId!==taskId)return {evidenceId:'',filename:'',error:'The evidence link does not match the selected company and task. Open the file from the Evidence Library again.'};
 const file=Array.isArray(evidence)?evidence.find(row=>row.id===handoff.evidenceId):null;
 if(!file||file.scanStatus!=='CLEAN')return {evidenceId:'',filename:'',error:'The file selected in the Evidence Library is unavailable for reuse. No replacement file has been selected.'};
 return {evidenceId:file.id,filename:file.filename,error:''};
}
