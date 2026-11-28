import {registryFilters,sourceCatalogue,planPath} from '../../../lib/server/source-registry';
export const runtime='nodejs', dynamic='force-dynamic';
export async function GET(req:Request) {
  try {
    const data=await sourceCatalogue(registryFilters(new URL(req.url).searchParams));
    if (data) return Response.json({...data,entries:data.entries.map(row=>({...row,plan:row.artifact_verified?planPath(row.id,row.version):null}))},
      {headers:{'Cache-Control':'no-store'}});
  } catch { /* Return a retryable status for a missing staging registry. */ }
  return Response.json({error:'Source registry unavailable'},{status:503});
}
