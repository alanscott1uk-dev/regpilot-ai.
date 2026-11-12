import {z} from 'zod';
export const PUBLISHERS=[
 {id:'mhra',slug:'medicines-and-healthcare-products-regulatory-agency',name:'MHRA',topics:['medicines']},
 {id:'home-office',slug:'home-office',name:'Home Office',topics:['controlled-drugs','employing-staff']},
 {id:'hmrc',slug:'hm-revenue-customs',name:'HMRC',topics:['tax','limited-company','employing-staff']},
 {id:'companies-house',slug:'companies-house',name:'Companies House',topics:['limited-company']},
 {id:'business-trade',slug:'department-for-business-and-trade',name:'Department for Business and Trade',topics:['consumer-sales','employing-staff','limited-company']},
 {id:'cma',slug:'competition-and-markets-authority',name:'Competition and Markets Authority',topics:['consumer-sales']},
 {id:'environment-agency',slug:'environment-agency',name:'Environment Agency',topics:['commercial-waste','premises']},
 {id:'defra',slug:'department-for-environment-food-rural-affairs',name:'Defra',topics:['food-business','commercial-waste']},
 {id:'dwp',slug:'department-for-work-pensions',name:'Department for Work and Pensions',topics:['employing-staff']},
 {id:'product-safety',slug:'office-for-product-safety-and-standards',name:'Office for Product Safety and Standards',topics:['consumer-sales','premises']},
 {id:'dsit',slug:'department-for-science-innovation-and-technology',name:'Department for Science, Innovation and Technology',topics:['personal-data','ai']},
 {id:'dhsc',slug:'department-of-health-and-social-care',name:'Department of Health and Social Care',topics:['medicines','healthcare']}
] as const;
export const PUBLIC_HORIZON_URL='https://raw.githubusercontent.com/alanscott1uk-dev/regpilot-ai./regpilot-public-feed/horizon.json';
export const horizonPath=z.string().max(450).regex(/^\/[a-z0-9][a-z0-9\/-]*$/).refine(s=>!s.includes('//')&&!s.endsWith('/')&&!s.startsWith('/api/'));
const hash=z.string().regex(/^[a-f0-9]{32}$/),date=z.iso.datetime();
export const itemSchema=z.object({id:hash,revision:hash,path:horizonPath,url:z.string().url(),title:z.string().min(1).max(240),summary:z.string().max(360),documentType:z.string().max(100),kind:z.enum(['Safety alert','Consultation','Regulation or decision','Guidance','Policy','News','Other publication']),publisherIds:z.array(z.string()).min(1).max(PUBLISHERS.length),updatedAt:date,firstSeenAt:date,observedAt:date,discovery:z.enum(['BASELINE','FIRST_SEEN','METADATA_UPDATED','UNCHANGED'])}).strict();
export const feedSchema=z.object({id:z.string(),state:z.enum(['available','limited','unavailable']),checkedAt:date,total:z.number().int().nonnegative().nullable(),retrieved:z.number().int().min(0).max(100),reason:z.string().max(100).nullable()}).strict();
export const reportSchema=z.object({format:z.literal('regpilot-horizon-v1'),generatedAt:date,windowStart:date,codeCommit:z.string().regex(/^[a-f0-9]{40}$/).nullable(),runId:z.string().regex(/^\d+$/).nullable(),previousAvailable:z.boolean(),feeds:z.array(feedSchema).length(PUBLISHERS.length),items:z.array(itemSchema).max(1500),limitations:z.array(z.string().max(400)).max(8)}).strict();
export type HorizonItem=z.infer<typeof itemSchema>;
export type HorizonReport=z.infer<typeof reportSchema>;
export function validateReport(raw:unknown,now=Date.now()):HorizonReport{
 const r=reportSchema.parse(raw),ids=new Set(PUBLISHERS.map(p=>p.id)),seen=new Set<string>();
 if(Date.parse(r.generatedAt)>now+300000||Date.parse(r.windowStart)>Date.parse(r.generatedAt))throw Error('Invalid report time');
 if(new Set(r.feeds.map(f=>f.id)).size!==PUBLISHERS.length||r.feeds.some(f=>!ids.has(f.id as any)||Date.parse(f.checkedAt)>Date.parse(r.generatedAt)))throw Error('Invalid publisher manifest');
 for(const i of r.items){if(seen.has(i.id)||i.url!=='https://www.gov.uk'+i.path||i.publisherIds.some(id=>!ids.has(id as any))||new Set(i.publisherIds).size!==i.publisherIds.length||Date.parse(i.updatedAt)>now+300000||Date.parse(i.observedAt)>Date.parse(r.generatedAt)||Date.parse(i.firstSeenAt)>Date.parse(i.observedAt))throw Error('Invalid publication identity');seen.add(i.id);}
 return r;
}
export function reportState(r:HorizonReport,now=Date.now()){return now-Date.parse(r.generatedAt)>12*3600000?'stale':r.feeds.some(f=>f.state==='unavailable')?'degraded':r.feeds.some(f=>f.state==='limited')?'limited':'current';}
export function rankItem(item:HorizonItem,topics:string[]=[]){
 const weights={'Safety alert':100,Consultation:80,'Regulation or decision':70,Guidance:60,Policy:40,News:20,'Other publication':10};
 const matched=PUBLISHERS.filter(p=>item.publisherIds.includes(p.id)&&p.topics.some(t=>topics.includes(t)));
 return {score:weights[item.kind]+(matched.length?25:0),reasons:[item.kind+' category',...matched.map(p=>p.name+' matches a selected activity')],suggested:matched.length>0};
}
