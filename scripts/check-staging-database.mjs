// Opt-in, read-only deployment check. Never prints credentials or customer data.
import {PrismaClient} from '@prisma/client';
import {readFileSync} from 'node:fs';

if (process.env.REGPILOT_STAGING_PREFLIGHT !== 'true') process.exit(0);
if (!process.env.DATABASE_URL) throw new Error('Staging DATABASE_URL is missing');
const models = [...readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8').matchAll(/^model (\w+) \{/gm)].map(m => m[1]);
const db = new PrismaClient();
try {
  const role = await db.$queryRaw`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
  if (role.length !== 1 || Object.values(role[0]).some(Boolean)) throw new Error('Runtime role has excessive privileges');
  const tables = await db.$queryRaw`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`;
  for (const model of models) {
    if (!tables.some(t => t.tablename === model && t.rowsecurity)) throw new Error('Required private table or RLS missing');
    const checks = await db.$queryRaw`
      SELECT (has_table_privilege(current_user, format('public.%I', ${model}::text), 'SELECT')
        AND has_table_privilege(current_user, format('public.%I', ${model}::text), 'INSERT')
        AND has_table_privilege(current_user, format('public.%I', ${model}::text), 'UPDATE')
        AND has_table_privilege(current_user, format('public.%I', ${model}::text), 'DELETE')) AS runtime_access,
        has_table_privilege('anon', format('public.%I', ${model}::text), 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
        has_table_privilege('authenticated', format('public.%I', ${model}::text), 'SELECT,INSERT,UPDATE,DELETE') AS api_access`;
    if (!checks[0]?.runtime_access || checks[0].anon_access || checks[0].api_access) throw new Error('Private table grants are incorrect');
  }
  // Exercise actual generated Prisma mappings without returning stored data.
  await db.organization.findFirst({select:{id:true}});
  await db.dispatchLane.findFirst({select:{organizationId:true,kind:true,leaseUntil:true}});
  await db.workerRun.findFirst({select:{slot:true}});
  const dispatchTriggers=await db.$queryRaw`SELECT t.tgname,t.tgenabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal AND
      ((c.relname='WatchSchedule' AND t.tgname='regpilot_source_dispatch_lane') OR
       (c.relname='EvidenceConnector' AND t.tgname='regpilot_connector_dispatch_lane'))`;
  if(dispatchTriggers.length!==2||dispatchTriggers.some(t=>!['O','A'].includes(t.tgenabled)))throw new Error('Required dispatch trigger missing or disabled');
  const isolation = await db.$queryRaw`SELECT has_schema_privilege(current_user, 'auth', 'USAGE') AS auth_access,
    has_table_privilege(current_user, 'public.organizations', 'SELECT') AS legacy_access`;
  if (isolation[0].auth_access || isolation[0].legacy_access) throw new Error('Runtime role can read unrelated data');
  console.log(`Staging database verified: ${models.length} private tables, RLS and restricted runtime role.`);
} catch (error) {
  console.error('Staging database preflight failed. Check connectivity, schema and runtime grants.');
  console.error('Database error category:', error?.code || error?.constructor?.name || 'unknown');
  if (error?.meta?.code) console.error('SQL state:', error.meta.code);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
