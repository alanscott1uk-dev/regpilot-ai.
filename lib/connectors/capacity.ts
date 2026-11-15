// Keep this order stable: the provider index identifies its database advisory lock.
export const PROVIDERS=['GITHUB','MICROSOFT365','GOOGLE_WORKSPACE','GITLAB','CLOUDFLARE','COMPANIES_HOUSE','VERCEL','SUPABASE'] as const;
export type ProviderLimits={maxConcurrent:number;perWorkspace:number};
/** Deployment configuration only. This neither enables a provider nor purchases capacity. */
export function providerLimits(provider:string,raw=process.env.REGPILOT_PROVIDER_LIMITS):ProviderLimits{
 if(!(PROVIDERS as readonly string[]).includes(provider))throw Error('Unsupported provider gate');
 const fallback={maxConcurrent:4,perWorkspace:2};
 if(raw===undefined)return fallback;
 if(raw.length>4096)throw Error('Invalid provider limits');
 let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('Invalid provider limits');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid provider limits');
 const limits=new Map<string,ProviderLimits>();
 for(const [name,entry] of Object.entries(value)){
  if(!(PROVIDERS as readonly string[]).includes(name)||!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Invalid provider limits');
  const row=entry as Record<string,unknown>;
  if(Object.keys(row).some(k=>k!=='maxConcurrent'&&k!=='perWorkspace'))throw Error('Invalid provider limits');
  const max=row.maxConcurrent,per=row.perWorkspace;
  if(typeof max!=='number'||!Number.isInteger(max)||max<1||max>16||typeof per!=='number'||!Number.isInteger(per)||per<1||per>max)throw Error('Invalid provider limits');
  limits.set(name,{maxConcurrent:max,perWorkspace:per});
 }
 return limits.get(provider)||fallback;
}
