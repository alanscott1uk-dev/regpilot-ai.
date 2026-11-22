import {sourceDefinition} from '../../../../lib/server/source-registry';
export const runtime='nodejs', dynamic='force-dynamic';

export async function GET(req:Request,ctx:{params:Promise<{id:string}>}) {
  const {id} = await ctx.params;
  const version = new URL(req.url).searchParams.get('version');
  try {
    const plan = await sourceDefinition(id);
    if (!plan) return Response.json({error:'Collection plan unavailable'},{status:404});
    if (version && version !== plan.version) return Response.json({error:'Source version changed. Refresh the catalogue.'},{status:409});
    return Response.json(plan,{headers:{'Content-Disposition':'attachment; filename="'+id+'.json"','Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'Source registry temporarily unavailable'},{status:503});
  }
}
