import {context, fail, readBody, reply} from '../../../../../lib/server/operations-http';
import {changeHorizonWatchlist} from '../../../../../lib/server/horizon-watchlists';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const orgs = new URL(request.url).searchParams.getAll('organizationId');
    if (orgs.length !== 1) return reply({error:'Choose one organisation.'}, 400);
    const ctx = await context(request, orgs[0], true);
    return reply(await changeHorizonWatchlist(ctx, await readBody(request, 6000)));
  } catch (error) {
    return fail(error);
  }
}
