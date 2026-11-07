import {workspaceConfigured} from "./ai-auth";
export const connectorsEnabled=()=>workspaceConfigured()&&process.env.REGPILOT_CONNECTORS_ENABLED==="true"&&/^[a-f\d]{64}$/i.test(process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY||"");
export const microsoft365Enabled=()=>connectorsEnabled()&&process.env.REGPILOT_MICROSOFT365_ENABLED==="true";
export const googleWorkspaceEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_GOOGLE_WORKSPACE_ENABLED==="true";
export const gitlabEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_GITLAB_ENABLED==="true";
export const cloudflareEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_CLOUDFLARE_ENABLED==="true";
export const companiesHouseEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_COMPANIES_HOUSE_ENABLED==="true";
export function connectorProviderEnabled(provider:string){return provider==="GITHUB"?connectorsEnabled():provider==="MICROSOFT365"?microsoft365Enabled():provider==="GOOGLE_WORKSPACE"?googleWorkspaceEnabled():provider==="GITLAB"?gitlabEnabled():provider==="CLOUDFLARE"?cloudflareEnabled():provider==="COMPANIES_HOUSE"?companiesHouseEnabled():false;}
