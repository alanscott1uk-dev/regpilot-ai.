import {collectionManifest} from '../../../../lib/server/source-registry';
export const runtime='nodejs',dynamic='force-dynamic';

export async function GET() {
  try {
    const manifest=await collectionManifest();
    if (manifest) return Response.json(manifest,{headers:{'Cache-Control':'no-store',
      'Content-Disposition':'attachment; filename="regpilot-source-plans.json"'}});
  } catch { /* An unavailable registry must produce a retryable response. */ }
  return Response.json({error:'Collection manifest unavailable'},{status:503});
}
