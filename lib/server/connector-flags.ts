import {pdConfig} from '../connectors/pipedream-client';
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
export const workforceEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_WORKFORCE_ENABLED==="true";
export const gleifEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_GLEIF_ENABLED==="true";
export const awsEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_AWS_ENABLED==="true"&&brokerRole.safeParse(process.env.REGPILOT_AWS_BROKER_ROLE_ARN).success;
export const awsOrganizationEnabled=()=>awsEnabled()&&process.env.REGPILOT_AWS_ORGANIZATIONS_ENABLED==="true";
const providerGates=new Map<string,()=>boolean>(Object.entries({
 PAGERDUTY_SERVICE:()=>connectorsEnabled()&&process.env.REGPILOT_PAGERDUTY_SERVICE_ENABLED!=="false",
 HEALTHCHECKS_JOB:()=>connectorsEnabled()&&process.env.REGPILOT_HEALTHCHECKS_JOB_ENABLED!=="false",
 PROMETHEUS_ALERT_RULE:()=>connectorsEnabled()&&!!process.env.REGPILOT_PROMETHEUS_HOST,
 GRAFANA_DASHBOARD:connectorsEnabled,GITEA_REPOSITORY:connectorsEnabled,
 SLACK_MEMBER:()=>connectorsEnabled()&&process.env.REGPILOT_SLACK_MEMBER_ENABLED!=="false",
 BOX_USER:()=>connectorsEnabled()&&process.env.REGPILOT_BOX_USER_ENABLED!=="false",
 ASANA_TASK:()=>connectorsEnabled()&&process.env.REGPILOT_ASANA_TASK_ENABLED!=="false",
 GITHUB_SCIM:()=>connectorsEnabled()&&process.env.REGPILOT_GITHUB_SCIM_ENABLED!=="false",
 ATLASSIAN_SCIM:()=>connectorsEnabled()&&process.env.REGPILOT_ATLASSIAN_SCIM_ENABLED!=="false",
 STATUSPAGE_COMPONENT:()=>connectorsEnabled()&&process.env.REGPILOT_STATUSPAGE_COMPONENT_ENABLED!=="false",
 ZENDESK_TICKET:()=>connectorsEnabled()&&process.env.REGPILOT_ZENDESK_TICKET_ENABLED!=="false",
 NHSBSA_MAPPING:connectorsEnabled,CLINICALTRIALS_GOV:connectorsEnabled,OPENFDA_RECALL:connectorsEnabled,DAILYMED_LABEL:connectorsEnabled,EUROPE_PMC:connectorsEnabled,MHRA_GUIDANCE:connectorsEnabled,
 OPENAI_PROJECT_MODEL:()=>connectorsEnabled(),
 PRIVATE_AI_MODEL:()=>connectorsEnabled()&&!!process.env.REGPILOT_PRIVATE_MODEL_HOST,
 KEYCLOAK_REALM:()=>connectorsEnabled()&&!!process.env.REGPILOT_KEYCLOAK_HOST,
 GITHUB_WORKFLOW:()=>connectorsEnabled(),
 PIPEDREAM_READ:()=>connectorsEnabled()&&!!pdConfig(),
 NANGO_SYNC:()=>connectorsEnabled()&&process.env.REGPILOT_MARKETPLACE_ENABLED==="true"&&!!process.env.REGPILOT_NANGO_API_KEY,
 TANDD_WEBSTORAGE:()=>connectorsEnabled()&&process.env.REGPILOT_TANDD_ENABLED!=="false",
 UBIBOT:()=>connectorsEnabled()&&process.env.REGPILOT_UBIBOT_ENABLED==="true",
 BENCHLING:()=>connectorsEnabled()&&process.env.REGPILOT_BENCHLING_ENABLED==="true",
 JIRA:()=>connectorsEnabled()&&process.env.REGPILOT_JIRA_ENABLED==="true",
 SERVICENOW:()=>connectorsEnabled()&&process.env.REGPILOT_SERVICENOW_ENABLED==="true",
 AZURE_DEVOPS:()=>connectorsEnabled()&&process.env.REGPILOT_AZURE_DEVOPS_ENABLED==="true",
 CONFLUENCE:()=>connectorsEnabled()&&process.env.REGPILOT_CONFLUENCE_ENABLED==="true",
 SAFETYCULTURE:()=>connectorsEnabled()&&process.env.REGPILOT_SAFETYCULTURE_ENABLED==="true",
 GITHUB:connectorsEnabled,MICROSOFT365:microsoft365Enabled,GOOGLE_WORKSPACE:googleWorkspaceEnabled,
 GITLAB:gitlabEnabled,CLOUDFLARE:cloudflareEnabled,COMPANIES_HOUSE:companiesHouseEnabled,
 VERCEL:vercelEnabled,SUPABASE:supabaseEnabled,OKTA:oktaEnabled,INTUNE:intuneEnabled,OPENSSF_SCORECARD:scorecardEnabled,AWS:awsEnabled,GLEIF:gleifEnabled,WORKFORCE_LEAVER:workforceEnabled,AWS_ORGANIZATIONS:awsOrganizationEnabled
} satisfies Record<(typeof PROVIDERS)[number],()=>boolean>));
export function connectorProviderEnabled(provider:string){return providerGates.get(provider)?.()??false;}
