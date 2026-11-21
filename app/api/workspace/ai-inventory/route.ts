import {context, fail, readBody, reply} from "../../../../lib/server/operations-http";
import {inventoryAction, inventoryWorkspace} from "../../../../lib/server/ai-inventory-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function company(request: Request) {
  const ids = new URL(request.url).searchParams.getAll("organizationId");
  return context(request, ids.length === 1 ? ids[0] : null);
}
export async function GET(request: Request) {
  try { return reply(await inventoryWorkspace(await company(request))); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const ctx = await company(request);
    return reply(await inventoryAction(ctx, await readBody(request, 256 * 1024)));
  } catch (error) { return fail(error); }
}
