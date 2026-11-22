import {db} from './db';
import {registerStagingEnabled} from './public-register-history';

export const sourceKinds = ['database', 'api', 'file'] as const;
type SourceSummary = {id:string; name:string; kind:string; version:string; plan_available:boolean; artifact_verified:boolean};
type Definition = SourceSummary & {image:string; documentation:string|null; license:string|null; artifact_digest:string; artifact_checked_at:Date; fields:string[]; required_fields:string[]};
export type DatabaseAcceptance = {id:string; name:string; version:string; run:string; job:string; completed_at:Date; before_matched:number; before_different:number; after_matched:number};
type Counts = {total:number; plans:number; databases:number; matches:number; refreshed:Date|null};

export function registryFilters(params:URLSearchParams) {
  const kind = params.get('kind') || '';
  const page = Number(params.get('page'));
  return {
    term:(params.get('q') || '').trim().slice(0,120),
    kind:sourceKinds.some(value => value === kind) ? kind : '',
    tested:params.get('tested')==='1',
    page:Number.isSafeInteger(page) && page > 0 ? page : 1
  };
}

export async function sourceCatalogue(filters:ReturnType<typeof registryFilters>) {
  if (!registerStagingEnabled()) return null;
  const {term,kind,tested} = filters;
  const size = 25;
  return db.$transaction(async tx => {
    const [counts] = await tx.$queryRaw<Counts[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE plan_available AND artifact_verified)::int AS plans,
        count(*) FILTER (WHERE kind='database')::int AS databases, max(refreshed_at) AS refreshed,
        count(*) FILTER (WHERE (${kind}='' OR kind=${kind}) AND strpos(lower(name),lower(${term}))>0
          AND (NOT ${tested} OR EXISTS (SELECT 1 FROM regpilot_verification.tested_database_sources a WHERE a.id=p.id)))::int AS matches
      FROM regpilot_verification.source_collection_plans p`;
    const pages = Math.max(1,Math.ceil(counts.matches/size));
    const page = Math.min(filters.page,pages);
    const entries = await tx.$queryRaw<SourceSummary[]>`
      SELECT id,name,kind,version,plan_available,artifact_verified FROM regpilot_verification.source_collection_plans p
      WHERE (${kind}='' OR kind=${kind}) AND strpos(lower(name),lower(${term}))>0
        AND (NOT ${tested} OR EXISTS (SELECT 1 FROM regpilot_verification.tested_database_sources a WHERE a.id=p.id))
      ORDER BY lower(name),id LIMIT ${size} OFFSET ${(page-1)*size}`;
    const acceptance=await tx.$queryRaw<DatabaseAcceptance[]>`
      SELECT id,name,version,run,job,completed_at,before_matched,before_different,after_matched
      FROM regpilot_verification.tested_database_sources ORDER BY lower(name),id`;
    const testedIds=new Set(acceptance.map(a=>a.id));
    return {counts,entries:entries.map(row=>({...row,workspace_tested:testedIds.has(row.id)})),page,pages,acceptance};
  },{isolationLevel:'RepeatableRead'});
}

export async function sourceDefinition(id:string) {
  if (!registerStagingEnabled() || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await db.$queryRaw<Definition[]>`
    SELECT id,name,kind,image,version,documentation,license,fields,required_fields,plan_available,artifact_digest,artifact_checked_at,artifact_verified
    FROM regpilot_verification.source_collection_plans WHERE id=${id}::uuid AND plan_available AND artifact_verified`;
  if (!row) return null;
  return asPlan(row);
}

function asPlan(row:Definition) {
  return {format:'regpilot-airbyte-source-v1',definitionId:row.id,name:row.name,kind:row.kind,
    image:row.image,version:row.version,artifactDigest:row.artifact_digest,artifactCheckedAt:row.artifact_checked_at.toISOString(),documentation:row.documentation,license:row.license,
    configFields:row.fields,requiredFields:row.required_fields};
}

export async function collectionManifest() {
  if (!registerStagingEnabled()) return null;
  const rows=await db.$queryRaw<Definition[]>`
    SELECT id,name,kind,image,version,documentation,license,fields,required_fields,plan_available,artifact_digest,artifact_checked_at,artifact_verified
    FROM regpilot_verification.source_collection_plans WHERE plan_available AND artifact_verified ORDER BY lower(name),id`;
  return {format:'regpilot-airbyte-manifest-v1',exportedAt:new Date().toISOString(),count:rows.length,plans:rows.map(asPlan)};
}

export const planPath = (id:string,version:string) => '/api/database-integrations/'+id+'?'+new URLSearchParams({version});
