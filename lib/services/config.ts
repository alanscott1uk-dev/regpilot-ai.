import {SERVICE_DESCRIPTIONS} from "./catalogue";
export const SERVICE_KEYS=["AI","OCR","EMAIL","STRIPE","SSO"] as const;
export type ServiceKey=typeof SERVICE_KEYS[number];
export const paidMaster=()=>process.env.REGPILOT_PAID_SERVICES_ENABLED==="true"&&process.env.REGPILOT_PAID_SAFEGUARDS_VERIFIED==="true";
export function positiveInt(value:string|undefined,max=2_000_000_000){const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=max?n:0;}
export function appOrigin(){const u=new URL(process.env.REGPILOT_APP_ORIGIN||"https://invalid.invalid");if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash||u.hostname==="invalid.invalid")throw new Error("APP_ORIGIN_UNCONFIGURED");return u.origin;}
export function azureOrigin(){const u=new URL(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT||"https://invalid.invalid");if(u.protocol!=="https:"||!/^[-a-z0-9]+\.cognitiveservices\.azure\.com$/.test(u.hostname)||u.port||u.username||u.password||u.pathname!=="/"||u.search||u.hash)throw new Error("OCR_ENDPOINT_UNCONFIGURED");return u.origin;}
export function serviceReady(kind:ServiceKey){
 if(!paidMaster())return false;
 if(kind==="AI")return process.env.REGPILOT_AI_ENABLED==="true"&&process.env.REGPILOT_AI_SAFEGUARDS_VERIFIED==="true"&&!!process.env.REGPILOT_AI_MODEL&&!!(process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN);
 if(process.env["REGPILOT_"+kind+"_ENABLED"]!=="true")return false;
 try{appOrigin();if(kind==="OCR"){azureOrigin();return !!process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;}
 if(kind==="EMAIL")return !!process.env.RESEND_API_KEY&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(process.env.REGPILOT_EMAIL_FROM||"");
 if(kind==="STRIPE")return /^(sk|rk)_(test|live)_/.test(process.env.STRIPE_SECRET_KEY||"")&&/^price_[A-Za-z0-9]+$/.test(process.env.STRIPE_PRICE_ID||"")&&!!process.env.STRIPE_WEBHOOK_SECRET;
 return !!process.env.NEXT_PUBLIC_SUPABASE_URL&&!!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY&&!!process.env.REGPILOT_SSO_DOMAINS;
 }catch{return false;}
}
export function serviceCatalogue(){return SERVICE_DESCRIPTIONS.map(s=>({...s,active:serviceReady(s.id as ServiceKey)}));}
