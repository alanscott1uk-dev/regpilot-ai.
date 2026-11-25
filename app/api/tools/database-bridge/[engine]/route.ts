import plans from '../../../../../public/database-bridge/native-plans.json';

export async function GET(_request: Request, context: {params: Promise<{engine: string}>}) {
  const {engine} = await context.params;
  if (!Object.hasOwn(plans, engine)) return new Response('Unknown SQL collector', {status: 404});
  const plan = plans[engine as keyof typeof plans];
  return Response.json(plan, {headers: {'Content-Disposition': `attachment; filename="regpilot-${engine}-plan.json"`}});
}
