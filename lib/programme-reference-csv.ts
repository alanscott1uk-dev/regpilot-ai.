import {csvEscape} from './obligations.mjs';
import type {programmeReferenceStatement} from './server/programme-reference-review';
export type ReferenceStatement=Awaited<ReturnType<typeof programmeReferenceStatement>>;
export function referenceStatementCsv(s:ReferenceStatement){
 const header=['Programme','Reference','Area','Applicability','Reason','Reviewer ID','Reviewed UTC','Decision version','Linked task ID','Owner','Task status','Reviewed file IDs and SHA-256','Evidence scope','Programme SHA-256'];
 return [header,...s.rows.map(r=>[s.name,r.reference,r.area,r.decision,r.reason,r.reviewerId,r.reviewedAt,r.version,r.taskId,r.owner,r.taskStatus,r.reviewedFiles.join(' | '),s.evidenceLimited?'First 1000 reviewed files':'Reviewed file metadata',s.recordHash])].map(row=>row.map(v=>csvEscape(v??'')).join(',')).join('\r\n');
}

type Row=ReferenceStatement['rows'][number];
export const evidenceViews={
 scope:'Scope decision needed',unlinked:'Applicable with no linked task',missing:'Applicable with missing reviewed evidence',
 limited:'Applicable with incomplete evidence coverage',covered:'Reviewed evidence on each linked task',excluded:'Excluded from scope'
} as const;
export type EvidenceView=keyof typeof evidenceViews;

export function referenceEvidence(row:Row,limited:boolean):EvidenceView{
 if(row.decision==='EXCLUDED')return 'excluded';
 if(row.decision!=='APPLIES')return 'scope';
 if(!row.tasks.length)return 'unlinked';
 if(row.tasks.some(task=>!task.reviewedFiles.length))return limited?'limited':'missing';
 return 'covered';
}
export function referenceEvidenceCsv(statement:ReferenceStatement,rows:Row[]){
 const result=[['Programme','Reference','Scope decision','Evidence status','Task ID','Task','Owner','Task status','Reviewed file IDs and SHA-256','Programme SHA-256']];
 for(const row of rows){
  const status=evidenceViews[referenceEvidence(row,statement.evidenceLimited)];
  for(const task of row.tasks.length?row.tasks:[null])result.push([statement.name,row.reference,row.decision,status,task?.id??'',task?.title??'',task?.owner??'',task?.status??'',task?.reviewedFiles.join(' | ')??'',statement.recordHash]);
 }
 return result.map(line=>line.map(csvEscape).join(',')).join('\r\n');
}
