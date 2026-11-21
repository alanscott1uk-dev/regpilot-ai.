import {exportVendorReview} from "../../../../../../lib/server/vendor-service";
import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(request:Request,args:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);const r=reply(await exportVendorReview(ctx,validId((await args.params).id)));r.headers.set("Content-Disposition",'attachment; filename="regpilot-supplier-review.json"');return r;}catch(e){return fail(e);}}
