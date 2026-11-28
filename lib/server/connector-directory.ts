import type {Prisma} from '@prisma/client';
import {failureStage} from '../connectors/collection-step';
import {connectorLabel} from '../connectors/observation';
import {csvEscape} from '../obligations.mjs';
import {workspaceConnectionFilters, type ConnectionFilter} from '../connectors/health-filters';

type DirectoryRow = {
  id: string; provider: string; repository: string; branch: string;
  owner: string; controlTitles: string[]; enabled: boolean; version: number;
  intervalHours: number; lastSuccessAt: Date | null;
  failureCode: string | null; configVersion: number | null; outcome: string | null;
  capturedAt: Date | null; runId: string | null;
};

// A retained error can belong to an earlier configuration. Only attach a diagnostic
// from the current version and error code, even when the operator has just retried.
export async function currentFailureStages(tx:Prisma.TransactionClient,org:string,targets:{id:string;failureCode:string|null}[]){
  const ids=targets.filter(target=>target.failureCode).map(target=>target.id);
  const stages=new Map<string,NonNullable<ReturnType<typeof failureStage>>>();
  if(!ids.length)return stages;
  const failures=await tx.$queryRaw<{id:string;step:string|null}[]>`
    SELECT c.id, failure.details->>'step' AS step FROM "EvidenceConnector" c
    JOIN LATERAL (
      SELECT a.details FROM "AuditEvent" a
      WHERE a."organizationId" = c."organizationId" AND a."entityType" = 'EvidenceConnector'
        AND a."entityId" = c.id::text AND a.action = 'connector.collection_failed'
        AND a.details->>'code' = c."failureCode" AND a.details->>'configVersion' = c.version::text
      ORDER BY a."createdAt" DESC, a.id DESC LIMIT 1
    ) failure ON true
    WHERE c."organizationId" = ${org}::uuid AND c.id = ANY(${ids}::uuid[])`;
  for(const row of failures){
    const stage=failureStage(row.step);
    if(stage)stages.set(row.id,stage);
  }
  return stages;
}

// Read only the latest run header for each target. Observation bodies and event
// histories are verified separately for the targets the operator actually opens.
export async function connectionDirectory(tx: Prisma.TransactionClient, org: string) {
  const rows = await tx.$queryRaw<DirectoryRow[]>`
    SELECT c.id, c.provider, c.repository, c.branch, c.enabled, c.version, c."failureCode", c."intervalHours", c."lastSuccessAt",
           u.email AS owner, r.id AS "runId", r."configVersion", r.outcome, r."capturedAt",
           ARRAY(SELECT DISTINCT name FROM (
             SELECT ctrl.title AS name WHERE ctrl.enabled
             UNION ALL
             SELECT mapped.title FROM "ConnectorControlLink" link
               JOIN "ManagedControl" mapped ON mapped.id = link."controlId" AND mapped."organizationId" = c."organizationId"
             WHERE link."connectorId" = c.id AND link."organizationId" = c."organizationId" AND mapped.enabled
           ) titles ORDER BY name) AS "controlTitles"
    FROM "EvidenceConnector" c
    JOIN "ManagedControl" ctrl ON ctrl.id = c."controlId" AND ctrl."organizationId" = c."organizationId"
    JOIN "User" u ON u.id = ctrl."ownerId"
    LEFT JOIN LATERAL (
      SELECT id, "configVersion", outcome, "capturedAt" FROM "ConnectorRun"
      WHERE "organizationId" = c."organizationId" AND "connectorId" = c.id
      ORDER BY "capturedAt" DESC, id DESC LIMIT 1
    ) r ON true
    WHERE c."organizationId" = ${org}::uuid
    ORDER BY c."createdAt" DESC, c.id ASC`;
  const stages=await currentFailureStages(tx,org,rows);
  return rows.map(row => ({
    ...row, failureStage:stages.get(row.id)??null, target: connectorLabel(row), scope: {repository: row.repository, branch: row.branch},
    controls: row.controlTitles.map(title => ({title})),
  }));
}

type Entry = Awaited<ReturnType<typeof connectionDirectory>>[number];

function matchesFilter(row: Entry, filter: ConnectionFilter, now: number) {
  switch (filter) {
    case 'all': return true;
    case 'collection-failed': return Boolean(row.failureCode);
    case 'overdue': return row.enabled && row.configVersion === row.version && row.lastSuccessAt !== null &&
      now - row.lastSuccessAt.getTime() >= row.intervalHours * 3600000;
    case 'awaiting-read': return row.configVersion !== row.version;
    case 'failed-checks': return row.configVersion === row.version && row.outcome === 'FOLLOW_UP';
    case 'incomplete': return row.configVersion === row.version && row.outcome === 'INCOMPLETE';
  }
}

export function filterDirectory(rows: Entry[], query: string, filter: ConnectionFilter) {
  const now = Date.now();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searched = rows.filter(row => {
    const text = [row.target, row.provider, row.repository, row.branch, row.owner, ...row.controlTitles].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const counts = Object.fromEntries(workspaceConnectionFilters.map(({value}) => [
    value, searched.filter(row => matchesFilter(row, value, now)).length,
  ])) as Record<ConnectionFilter, number>;
  return {matches: searched.filter(row => matchesFilter(row, filter, now)), counts};
}

export function directoryCsv(org: string, matches: Entry[]) {
  const columns = ['Connection ID', 'Provider', 'Target', 'Control owner', 'Active controls', 'Enabled',
    'Configuration version', 'Collection interval (hours)', 'Last successful collection UTC', 'Recorded collection error', 'Latest run ID', 'Run configuration version',
    'Recorded outcome', 'Collected UTC', 'Inspect connection', 'Failed collection step', 'Recovery guidance'];
  const rows = matches.map(row => [row.id, row.provider, row.target, row.owner, row.controlTitles.join(' | '),
    row.enabled, row.version, row.intervalHours, row.lastSuccessAt?.toISOString(), row.failureCode, row.runId, row.configVersion, row.outcome, row.capturedAt?.toISOString(),
    '/team/operations?' + new URLSearchParams({organizationId: org, view: 'connections', connectionId: row.id}), row.failureStage?.label, row.failureStage?.guidance]);
  return [columns, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
}
