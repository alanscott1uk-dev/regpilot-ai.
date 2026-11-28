import {publicIndexComparison} from '../../../../lib/server/horizon-index-comparison';
import {reply} from '../../../../lib/server/intelligence-http';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=120;
export async function GET(){try{return reply(await publicIndexComparison());}catch{return reply({error:'The official index comparison is unavailable.'},503);}}
