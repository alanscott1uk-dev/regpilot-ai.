import {brokerRole} from "../connectors/aws-target";
import {PROVIDERS} from "../connectors/capacity";
import {workspaceConfigured} from "./ai-auth";
export const connectorsEnabled=()=>workspaceConfigured()&&process.env.REGPILOT_CONNECTORS_ENABLED==="true"&&/^[a-f\d]{64}$/i.test(process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY||"");
export const microsoft365Enabled=()=>connectorsEnabled()&&process.env.REGPILOT_MICROSOFT365_ENABLED==="true";
export const googleWorkspaceEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED==="true";
export const gitlabEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_GITLAB_ENABLED==="true";
export const cloudflareEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_CLOUDFLARE_ENABLED==="true";
export const companiesHouseEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_COMPANIES_HOUSE_ENABLED==="true";
export const vercelEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_VERCEL_ENABLED==="true";
export const supabaseEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_SUPABASE_ENABLED==="true";
export const oktaEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_OKTA_ENABLED==="true"&&!!process.env.REGPILOT_NANGO_API_KEY;
export const intuneEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_INTUNE_ENABLED==="true";
export const scorecardEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_SCORECARD_ENABLED==="true";
export const gleifEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_GLEIF_ENABLED==="true";
export const awsEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_AWS_ENABLED==="true"&&brokerRole.safeParse(process.env.REGPILOT_AWS_BROKER_ROLE_ARN).success;
const providerGates=new Map<string,()=>boolean>(Object.entries({
 GITHUB:connectorsEnabled,MICROSOFT365:microsoft365Enabled,GOOGLE_WORKSPACE:googleWorkspaceEnabled,
 GITLAB:gitlabEnabled,CLOUDFLARE:cloudflareEnabled,COMPANIES_HOUSE:companiesHouseEnabled,
 VERCEL:vercelEnabled,SUPABASE:supabaseEnabled,OKTA:oktaEnabled,INTUNE:intuneEnabled,OPENSSF_SCORECARD:scorecardEnabled,AWS:awsEnabled,GLEIF:gleifEnabled
} satisfies Record<(typeof PROVIDERS)[number],()=>boolean>));
export function connectorProviderEnabled(provider:string){return providerGates.get(provider)?.()??false;}
