import type {exportQualityCase} from './server/capa-service';

type CaseExport = Awaited<ReturnType<typeof exportQualityCase>>;

function timestamp(value: Date | string | null) {
 return value ? new Date(value).toISOString() : 'Unrecorded';
}

export function qualityInspectionText(record: CaseExport) {
 const row = record.case;
 if (!row) throw new Error('A saved quality case is required');
 const lines = [
  'RegPilot quality case inspection summary', row.title,
  `Case ${row.id} · Organisation ${record.organizationId}`,
  `Exported ${record.exportedAt} · Case version ${row.version} · Cycle ${row.cycle}`,
  `Status: ${row.status} · Classification: ${row.classification} · Current owner: ${row.ownerName}`,
  '', 'Occurrence and containment', `Occurrence date: ${timestamp(row.occurredAt).slice(0,10)}`,
  row.description, `Impact: ${row.impact}`, `Containment: ${row.containment}`,
  '', 'Handover', row.handoverRecipientId
   ? `Awaiting acceptance by ${row.handoverRecipientId}. Outstanding checks: ${row.handoverNotes}`
   : 'No pending handover.',
  '', 'Investigation', row.investigationNotes || 'Findings pending.',
  `Root cause: ${row.rootCause || 'Pending'}`, `Effectiveness criteria: ${row.effectivenessCriteria || 'Pending'}`,
  '', 'Actions'
 ];
 for (const action of [...(record.previousActions ?? []), ...(record.actions ?? [])]) {
  lines.push(`Cycle ${action.cycle} · ${action.kind} · ${action.task.title} · ${action.task.status}`,
   `Task ${action.task.id} · Owner: ${action.task.ownerName}`, action.purpose);
 }
 if (!record.previousActions?.length && !record.actions?.length) lines.push('No recorded actions.');
 lines.push('', 'Effectiveness reviews');
 for (const review of record.reviews ?? []) {
  lines.push(`Cycle ${review.cycle} · ${review.status} · Observed ${timestamp(review.observedAt).slice(0,10)} · Author ${review.authorId}`,
   review.notes, `Assessment at export: ${review.reason}`);
  if (review.reviewerId) lines.push(`Reviewer ${review.reviewerId} · ${timestamp(review.reviewedAt)}`, review.reviewNotes);
  for (const file of review.evidence) lines.push(`Evidence: ${file.filename} · ${file.id} · SHA-256 ${file.sha256}`);
 }
 if (!record.reviews?.length) lines.push('No effectiveness assessment recorded.');
 if (record.reviewsLimited) lines.push('Only the latest 40 reviews are included.');
 if (record.blockers?.length) lines.push('', 'Outstanding effectiveness checks', ...record.blockers);
 lines.push('', 'Recorded chronology (UTC)');
 for (const item of record.history ?? []) {
  lines.push(`${timestamp(item.createdAt)} · ${item.action} · Actor ${item.actorId ?? 'unrecorded'}`);
  const details = item.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) continue;
  for (const [key,label] of [['previousOwnerId','Previous owner'],['recipientId','Recipient'],['outstandingChecks','Outstanding checks'],['purpose','Purpose'],['decision','Decision'],['reason','Reason'],['notes','Notes']]) {
   const value=details[key];
   if (typeof value==='string' && value && !(key==='notes' && value===details.outstandingChecks)) lines.push(`  ${label}: ${value}`);
  }
 }
 if (record.historyLimited) lines.push('Only the first 1,000 recorded events are included.');
 lines.push('',record.scope);
 return lines.join('\n')+'\n';
}
