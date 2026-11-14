import {serviceReady,appOrigin} from "./config";
import {checkedJson,ProviderError} from "./http";
export function reminderText(taskId:string){if(!/^[a-f0-9-]{36}$/.test(taskId))throw new ProviderError("INVALID_TASK");return "You have an assigned RegPilot task requiring review. Sign in to view the details: "+appOrigin()+"/team\n\nThis reminder does not contain document content or a compliance determination.";}
export async function sendReminder(input:{jobId:string;taskId:string;recipient:string},fetcher:typeof fetch=fetch){
 if(!serviceReady("EMAIL"))throw new ProviderError("SERVICE_DISABLED");if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.recipient))throw new ProviderError("INVALID_RECIPIENT");
 const r=await fetcher("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"regpilot-reminder-"+input.jobId},body:JSON.stringify({from:process.env.REGPILOT_EMAIL_FROM,to:[input.recipient],subject:"Your RegPilot task needs review",text:reminderText(input.taskId)}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
 const data=await checkedJson(r,20000);if(typeof data.id!=="string"||data.id.length>120)throw new ProviderError("INVALID_RESPONSE");return {providerId:data.id,status:"ACCEPTED_BY_PROVIDER",limitation:"Provider acceptance does not confirm inbox delivery."};
}
