import {z} from 'zod';
import {context, reply, fail} from '../../../../../lib/server/operations-http';
import {getConnectorHealth, exportConnectorHealth} from '../../../../../lib/server/connector-health-service';
import {workspaceConnectionFilters} from '../../../../../lib/connectors/health-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const querySchema = z.object({
  q: z.string().trim().max(160),
  filter: z.enum(workspaceConnectionFilters.map(option => option.value)),
  page: z.coerce.number().int().min(1).max(100000),
  format: z.enum(['json', 'csv']),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ctx = await context(request, params.get('organizationId'));
    const query = querySchema.parse({q: params.get('q') ?? '', filter: params.get('filter') ?? 'all',
      page: params.get('page') ?? 1, format: params.get('format') ?? 'json'});
    return reply(query.format === 'csv' ? await exportConnectorHealth(ctx, query) : await getConnectorHealth(ctx, query));
  } catch (error) {
    return fail(error);
  }
}
