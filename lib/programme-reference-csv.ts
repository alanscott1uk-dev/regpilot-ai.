import {csvEscape} from './obligations.mjs';
import type {programmeReferenceStatement} from './server/programme-reference-review';
export type ReferenceStatement=Awaited<ReturnType<typeof programmeReferenceStatement>>;
export function referenceStatementCsv(s:ReferenceStatement){
 const header=['Programme','Reference','Area','Applicability','Reason','Reviewer ID','Reviewed UTC','Decision version','Linked task ID','Owner','Task status','Reviewed file IDs and SHA-256','Evidence scope','Programme SHA-256'];
 return [header,...s.rows.map(r=>[s.name,r.reference,r.area,r.decision,r.reason,r.reviewerId,r.reviewedAt,r.version,r.taskId,r.owner,r.taskStatus,r.reviewedFiles.join(' | '),s.evidenceLimited?'First 1000 reviewed files':'Reviewed file metadata',s.recordHash])].map(row=>row.map(v=>csvEscape(v??'')).join(',')).join('\r\n');
}
