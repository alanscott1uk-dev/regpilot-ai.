import {z} from 'zod';
import {factsSchema,type Facts} from './applicability';

export const siteNations=['England','Scotland','Wales','Northern Ireland'] as const;
const corporate=new Set(['employeeCount','annualTurnoverGBP','vatRegistered','limitedCompany']);
const localFacts=factsSchema.omit({employeeCount:true,annualTurnoverGBP:true,vatRegistered:true,limitedCompany:true});
export const siteFactKeys=Object.keys(localFacts.shape) as (keyof z.infer<typeof localFacts>)[];
export const siteProfile=z.object({id:z.uuid(),name:z.string().trim().min(2).max(80),nation:z.enum(siteNations),facts:localFacts}).strict();
export type SiteProfile=z.infer<typeof siteProfile>;
export const siteProfiles=z.array(siteProfile).max(12).refine(sites=>new Set(sites.map(s=>s.id)).size===sites.length&&new Set(sites.map(s=>s.name.toLowerCase())).size===sites.length,'Choose distinct site names and references');
export function factsAtSite(business:Facts,site:SiteProfile):Facts{
 return {...Object.fromEntries(Object.entries(business).filter(([key])=>corporate.has(key))),...site.facts};
}
