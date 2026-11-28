import {resourceFindingReport} from '../../../../../../../lib/server/customer-api-service';
import {context, fail, reply, validId} from '../../../../../../../lib/server/operations-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId');
    const ctx = await context(request, organizationId, true);
    return reply(await resourceFindingReport(ctx, validId((await params).id)));
  } catch (error) {
    return fail(error);
  }
}
