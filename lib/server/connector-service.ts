import {taskIncludesRun} from './connector-task-observations';
import {benchlingClient,benchlingCredential} from '../connectors/benchling-auth';
import {connectorScopeHash,credentialChanged} from './connector-verification';
import {applyLoggerCalibration,loggerReadingCurrent} from './logger-calibration';
import {tanddCredentials} from '../connectors/tandd';
import {isTemperatureLogger,isRecordProvider} from "../connectors/record-catalogue";
import {collectOperationalRecord,readRecordKeys,recordKeys,recordTargets} from "../connectors/operational-records";
import {workforceTarget,workforceCredentials,workforceKeys,readWorkforceKeys} from "../connectors/workforce-target";
import {collectWorkforce} from "../connectors/workforce";
import {collectIntune} from "../connectors/intune";
import {collectScorecard,scorecardTarget} from "../connectors/scorecard";
import {collectOkta,oktaTarget,oktaConnections,nangoConfig} from "../connectors/nango-okta";
import {registerProviders} from "./vendor-signals";
import {awsTarget,awsOrganizationTarget} from "../connectors/aws-target";
import {collectGleif,gleifTarget} from "../connectors/gleif";
import {PROVIDERS,requiresStoredSecret,maxWorkspaceConnectorTargets} from "../connectors/capacity";
import {verifiedObservation} from './connector-observation';
import {enqueueConnectorObservationDelivery,enqueueConnectorFailureDelivery} from './integration-delivery-events';
import {supportsHourlyMonitoring} from '../connectors/hourly-schedule.mjs';
import {connectorRecovery} from "../connectors/recovery";
import {maxConnectorLanes,claimFairConnectors,claimFairConnector,claimManualConnectorLane,releaseDispatchLease} from "./fair-dispatch";
import {acquireProviderPermit,settleProviderPermit} from "./provider-gate";
import type {ProviderPermit} from "@prisma/client";
import {collectVercel,collectSupabase,vercelTarget,supabaseTarget} from "../connectors/infrastructure";
import {enqueueConnectorEvent,processConnectorEvent} from "./automation-queue";
import {Prisma,type EvidenceConnector} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import {connectorsEnabled,microsoft365Enabled,googleWorkspaceEnabled,gitlabEnabled,cloudflareEnabled,companiesHouseEnabled,vercelEnabled,supabaseEnabled,connectorProviderEnabled} from "./connector-flags";
export {connectorsEnabled,microsoft365Enabled,googleWorkspaceEnabled,gitlabEnabled,cloudflareEnabled,companiesHouseEnabled,vercelEnabled,supabaseEnabled,oktaEnabled,intuneEnabled,scorecardEnabled,awsEnabled,gleifEnabled,workforceEnabled,awsOrganizationEnabled} from "./connector-flags";
import {collectGitlab,gitlabTarget} from "../connectors/gitlab";
import {collectCloudflare,cloudflareTarget} from "../connectors/cloudflare";
import {collectCompaniesHouse,companiesHouseTarget} from "../connectors/companies-house";
import {validCredential} from "../connectors/bounded-http";
import type {AuthorizedContext} from "./authorization";
import {DatabaseContention,IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {encryptConnectorSecret,decryptConnectorSecret} from "./connector-secret";
import {collectGithub,githubTarget,CollectionError} from "../connectors/github";
import {collectGoogleWorkspace,googleTarget,googleCredentials} from "../connectors/google-workspace";
import {collectMicrosoft365,microsoftTarget} from "../connectors/microsoft365";
import {observationSchema,observationOutcome,observationCurrent,signalChanges,reconcileObservation,type Observation} from "../connectors/observation";
import {hashValue} from "../regulatory/intelligence";
const j=(v:unknown)=>v as Prisma.InputJsonValue;

const collectionInterval=z.union([z.literal(1),z.literal(24),z.literal(168)]);
const schema=githubTarget.extend({provider:z.literal("GITHUB").default("GITHUB"),controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),token:z.string().regex(/^github_pat_[A-Za-z0-9_]{20,240}$/).optional(),enabled:z.boolean(),intervalHours:collectionInterval});


const googleSchema=googleTarget.extend({provider:z.literal("GOOGLE_WORKSPACE"),controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),clientSecret:googleCredentials.shape.clientSecret.optional(),refreshToken:googleCredentials.shape.refreshToken.optional(),enabled:z.boolean(),intervalHours:collectionInterval,consent:z.literal(true)}).refine(v=>!!v.clientSecret===!!v.refreshToken,"Rotate both Google credentials together");
const microsoftSchema=microsoftTarget.extend({provider:z.enum(["MICROSOFT365","INTUNE"]),controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),clientSecret:z.string().min(16).max(512).regex(/^[^\r\n\0]+$/).optional(),enabled:z.boolean(),intervalHours:collectionInterval,consent:z.literal(true)});
const extraFields={controlId:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(0),token:z.string().refine(validCredential).optional(),enabled:z.boolean(),intervalHours:collectionInterval,consent:z.literal(true)};
const extraSchema=z.discriminatedUnion("provider",[
 recordTargets.PAGERDUTY_SERVICE.extend({...extraFields,provider:z.literal("PAGERDUTY_SERVICE")}).strict(),
 recordTargets.HEALTHCHECKS_JOB.extend({...extraFields,provider:z.literal("HEALTHCHECKS_JOB")}).strict(),
 recordTargets.PROMETHEUS_ALERT_RULE.extend({...extraFields,provider:z.literal("PROMETHEUS_ALERT_RULE"),token:z.string().refine(validCredential).regex(/^[^:\s]+:.+$/).optional()}).strict(),
 recordTargets.GITEA_REPOSITORY.extend({...extraFields,provider:z.literal("GITEA_REPOSITORY")}).strict(),
 recordTargets.GRAFANA_DASHBOARD.extend({...extraFields,provider:z.literal("GRAFANA_DASHBOARD")}).strict(),
 recordTargets.SLACK_MEMBER.extend({...extraFields,provider:z.literal("SLACK_MEMBER")}).strict(),
 recordTargets.BOX_USER.extend({...extraFields,provider:z.literal("BOX_USER")}).strict(),
 recordTargets.ASANA_TASK.extend({...extraFields,provider:z.literal("ASANA_TASK")}).strict(),
 recordTargets.GITHUB_SCIM.extend({...extraFields,provider:z.literal("GITHUB_SCIM")}).strict(),
 recordTargets.ATLASSIAN_SCIM.extend({...extraFields,provider:z.literal("ATLASSIAN_SCIM")}).strict(),
 recordTargets.STATUSPAGE_COMPONENT.extend({...extraFields,provider:z.literal("STATUSPAGE_COMPONENT")}).strict(),
 recordTargets.ZENDESK_TICKET.extend({...extraFields,provider:z.literal("ZENDESK_TICKET")}).strict(),
 recordTargets.NHSBSA_MAPPING.extend({...extraFields,provider:z.literal("NHSBSA_MAPPING")}).omit({token:true}).strict(),
 recordTargets.CLINICALTRIALS_GOV.extend({...extraFields,provider:z.literal("CLINICALTRIALS_GOV")}).omit({token:true}).strict(),
 recordTargets.OPENFDA_RECALL.extend({...extraFields,provider:z.literal("OPENFDA_RECALL")}).omit({token:true}).strict(),
 recordTargets.DAILYMED_LABEL.extend({...extraFields,provider:z.literal("DAILYMED_LABEL")}).omit({token:true}).strict(),
 recordTargets.EUROPE_PMC.extend({...extraFields,provider:z.literal("EUROPE_PMC")}).omit({token:true}).strict(),
 recordTargets.MHRA_GUIDANCE.extend({...extraFields,provider:z.literal("MHRA_GUIDANCE")}).omit({token:true}).strict(),
 recordTargets.OPENAI_PROJECT_MODEL.extend({...extraFields,provider:z.literal("OPENAI_PROJECT_MODEL")}).strict(),
 recordTargets.PRIVATE_AI_MODEL.extend({...extraFields,provider:z.literal("PRIVATE_AI_MODEL")}).strict(),
 recordTargets.KEYCLOAK_REALM.extend({...extraFields,provider:z.literal("KEYCLOAK_REALM")}).strict(),
 recordTargets.GITHUB_WORKFLOW.extend({...extraFields,provider:z.literal("GITHUB_WORKFLOW")}).strict(),
 recordTargets.PIPEDREAM_READ.extend({...extraFields,provider:z.literal("PIPEDREAM_READ")}).omit({token:true}).strict(),
 recordTargets.NANGO_SYNC.extend({...extraFields,provider:z.literal("NANGO_SYNC")}).omit({token:true}).strict(),
 recordTargets.UBIBOT.extend({...extraFields,provider:z.literal("UBIBOT")}).strict(),
 recordTargets.TANDD_WEBSTORAGE.extend({...extraFields,provider:z.literal("TANDD_WEBSTORAGE"),credentials:tanddCredentials.optional()}).omit({token:true}).strict(),
 recordTargets.BENCHLING.extend({...extraFields,provider:z.literal("BENCHLING"),clientId:benchlingClient.optional()}).strict(),
 recordTargets.JIRA.extend({...extraFields,provider:z.literal("JIRA")}).strict(),
 recordTargets.SERVICENOW.extend({...extraFields,provider:z.literal("SERVICENOW")}).strict(),
 recordTargets.AZURE_DEVOPS.extend({...extraFields,provider:z.literal("AZURE_DEVOPS")}).strict(),
 recordTargets.CONFLUENCE.extend({...extraFields,provider:z.literal("CONFLUENCE")}).strict(),
 recordTargets.SAFETYCULTURE.extend({...extraFields,provider:z.literal("SAFETYCULTURE")}).strict(),
 workforceTarget.extend({...extraFields,provider:z.literal("WORKFORCE_LEAVER"),credentials:workforceCredentials.optional()}).omit({token:true}).strict(),
 awsOrganizationTarget.extend({...extraFields,provider:z.literal("AWS_ORGANIZATIONS")}).omit({token:true}).strict(),
 awsTarget.extend({...extraFields,provider:z.literal("AWS")}).omit({token:true}).strict(),
 gleifTarget.extend({...extraFields,provider:z.literal("GLEIF")}).omit({token:true}).strict(),
 scorecardTarget.extend({...extraFields,provider:z.literal("OPENSSF_SCORECARD")}).omit({token:true}).strict(),
 oktaTarget.extend({...extraFields,provider:z.literal("OKTA")}).omit({token:true}),
 vercelTarget.extend({...extraFields,provider:z.literal("VERCEL")}),
 supabaseTarget.extend({...extraFields,provider:z.literal("SUPABASE")}),
 gitlabTarget.extend({...extraFields,provider:z.literal("GITLAB")}),
 cloudflareTarget.extend({...extraFields,provider:z.literal("CLOUDFLARE")}),
 companiesHouseTarget.extend({...extraFields,provider:z.literal("COMPANIES_HOUSE")})
]);
type ConnectorSettings=z.infer<typeof schema>|z.infer<typeof googleSchema>|z.infer<typeof microsoftSchema>|z.infer<typeof extraSchema>;
function storedTarget(settings:ConnectorSettings):{repository:string;branch:string;token?:string}{
 switch(settings.provider){
  case "TANDD_WEBSTORAGE":return {...recordKeys(settings.provider,settings),token:settings.credentials?JSON.stringify(settings.credentials):undefined};
  case "BENCHLING":{
   if(settings.clientId&&!settings.token)throw new IntelligenceError("Enter the app secret with its client ID");
   return {...recordKeys(settings.provider,settings),token:settings.clientId&&settings.token?benchlingCredential(settings.clientId,settings.token):settings.token};
  }
  case "NHSBSA_MAPPING":case "CLINICALTRIALS_GOV":case "OPENFDA_RECALL":case "DAILYMED_LABEL":case "EUROPE_PMC":case "MHRA_GUIDANCE":
  case "PIPEDREAM_READ":case "NANGO_SYNC":return recordKeys(settings.provider,settings);
  case "OPENAI_PROJECT_MODEL":case "PRIVATE_AI_MODEL":
  case "SLACK_MEMBER":case "BOX_USER":case "ASANA_TASK":
  case "GITHUB_SCIM":case "ATLASSIAN_SCIM":case "STATUSPAGE_COMPONENT":case "ZENDESK_TICKET":
  case "PAGERDUTY_SERVICE":case "HEALTHCHECKS_JOB":
  case "PROMETHEUS_ALERT_RULE":case "GITEA_REPOSITORY":case "GRAFANA_DASHBOARD":
  case "KEYCLOAK_REALM":
  case "GITHUB_WORKFLOW":
  case "UBIBOT":
  case "JIRA":
  case "SERVICENOW":
  case "AZURE_DEVOPS":
  case "CONFLUENCE":
  case "SAFETYCULTURE":
   return {...recordKeys(settings.provider,settings),token:settings.token};
  case "GITHUB":return {repository:settings.repository.toLowerCase(),branch:settings.branch,token:settings.token};
  case "MICROSOFT365":
  case "INTUNE":return {repository:(settings.provider==="INTUNE"?"intune:":"microsoft365:")+settings.tenantId.toLowerCase(),
    branch:settings.clientId.toLowerCase(),token:settings.clientSecret};
  case "GOOGLE_WORKSPACE":return {repository:"googleworkspace:"+settings.customerId,branch:settings.clientId,
    token:settings.clientSecret?JSON.stringify({clientSecret:settings.clientSecret,refreshToken:settings.refreshToken}):undefined};
  case "GITLAB":return {repository:"gitlab:"+settings.projectPath.toLowerCase(),branch:settings.branch,token:settings.token};
  case "CLOUDFLARE":return {repository:"cloudflare:"+settings.zoneId.toLowerCase(),branch:settings.accountId.toLowerCase(),token:settings.token};
  case "COMPANIES_HOUSE":return {repository:"companieshouse:"+settings.companyNumber,branch:"profile",token:settings.token};
  case "VERCEL":return {repository:"vercel:"+settings.projectId,branch:settings.teamId,token:settings.token};
  case "SUPABASE":return {repository:"supabase:"+settings.projectRef.toLowerCase(),branch:settings.providerOrganizationId,token:settings.token};
  case "OKTA":return {repository:"okta:"+settings.connectionId,branch:[settings.groupId,settings.removedUserId].filter(Boolean).join(":"),token:settings.connectionId};
  case "WORKFORCE_LEAVER":return {...workforceKeys(settings),token:settings.credentials?JSON.stringify(settings.credentials):undefined};
  case "AWS_ORGANIZATIONS":return {repository:"awsorg:"+settings.awsOrganizationId+":"+settings.accountId,branch:settings.region};
  case "AWS":return {repository:"aws:"+settings.accountId,branch:settings.region};
  case "GLEIF":return {repository:"gleif:"+settings.lei,branch:settings.companyNumber};
  case "OPENSSF_SCORECARD":return {repository:"scorecard:"+settings.repository,branch:settings.deployedCommit??"published"};
 }
}
type Collector=(target:{provider?:string;organizationId?:string;intervalHours?:number;repository:string;branch:string},secret:string)=>Promise<Observation>;
export const collectConfiguredConnector:Collector=async(target,secret)=>{
 if(!connectorProviderEnabled(target.provider||"GITHUB"))throw new CollectionError("PROVIDER_DISABLED");
 if(isRecordProvider(target.provider)){
  const configured=readRecordKeys(target.provider,target.repository,target.branch);
  if(target.provider==="PIPEDREAM_READ"){
   if(!target.organizationId)throw new CollectionError("WORKSPACE_REQUIRED");
   return (await import("./product-monitor-service")).collectProductMonitor(target.organizationId,configured);
  }
  if(target.provider==="NANGO_SYNC"){
   if(!target.organizationId)throw new CollectionError("WORKSPACE_REQUIRED");
   const {managedSyncObservation}=await import("../connectors/marketplace");
   const [provider,policyId]=configured.reference!.split('/');
   const [integration,connectionId]=configured.scope.split('/');
   const policy=policyId?await (await import('./managed-control-policy')).readManagedPolicy(target.organizationId,policyId,{integration,connectionId,provider,model:configured.record}):undefined;
   return managedSyncObservation(target.organizationId,{...configured,reference:provider},fetch,policy,target.intervalHours===1?1:24);
  }
  return collectOperationalRecord(target.provider,configured,secret);
 }
 if(target.provider==="WORKFORCE_LEAVER"){
  const scope=readWorkforceKeys(target.repository,target.branch);
  if(!scope)throw new CollectionError("INVALID_TARGET");
  return collectWorkforce(scope,JSON.parse(secret));
 }
 if(target.provider==="INTUNE" && target.repository.startsWith("intune:")){
  return collectIntune({tenantId:target.repository.slice(7),clientId:target.branch},secret);
 }
 if(target.provider==="AWS_ORGANIZATIONS"&&target.organizationId&&target.repository.startsWith("awsorg:")){
  const [,awsOrganizationId,accountId]=target.repository.split(":");
  const {collectAwsOrganization}=await import("../connectors/aws-organization");
  return collectAwsOrganization(awsOrganizationTarget.parse({awsOrganizationId,accountId,region:target.branch}),target.organizationId);
 }
 if(target.provider==="AWS"&&target.repository.startsWith("aws:")&&target.organizationId){
  const {collectAws}=await import("../connectors/aws");
  return collectAws({accountId:target.repository.slice(4),region:target.branch},target.organizationId);
 }
 if(target.provider==="GLEIF"&&target.repository.startsWith("gleif:"))return collectGleif({lei:target.repository.slice(6),companyNumber:target.branch});
 if(target.provider==="OPENSSF_SCORECARD" && target.repository.startsWith("scorecard:") ){
  return collectScorecard({repository:target.repository.slice(10),deployedCommit:target.branch==="published"?undefined:target.branch});
 }
 if(target.provider==="OKTA"){
  const [groupId,removedUserId,...excess]=target.branch.split(":");
  if(!target.organizationId||excess.length||target.repository!=="okta:"+secret)throw new CollectionError("INVALID_TARGET");
  return collectOkta({connectionId:secret,groupId,removedUserId},target.organizationId,nangoConfig());
 }
 if(target.provider==="VERCEL"&&target.repository.startsWith("vercel:"))return collectVercel({projectId:target.repository.slice(7),teamId:target.branch},secret);
 if(target.provider==="SUPABASE"&&target.repository.startsWith("supabase:"))return collectSupabase({projectRef:target.repository.slice(9),providerOrganizationId:target.branch},secret);
 if(target.provider==="GITHUB"||target.provider===undefined)return collectGithub(target,secret);
 if(target.provider==="GITLAB"&&target.repository.startsWith("gitlab:"))return collectGitlab({projectPath:target.repository.slice(7),branch:target.branch},secret);
 if(target.provider==="CLOUDFLARE"&&target.repository.startsWith("cloudflare:"))return collectCloudflare({zoneId:target.repository.slice(11),accountId:target.branch},secret);
 if(target.provider==="COMPANIES_HOUSE"&&target.repository.startsWith("companieshouse:"))return collectCompaniesHouse({companyNumber:target.repository.slice(15)},secret);
 if(target.provider==="MICROSOFT365"){
  if(!microsoft365Enabled())throw new CollectionError("PROVIDER_DISABLED");
  if(!target.repository.startsWith("microsoft365:"))throw new CollectionError("INVALID_TARGET");
  return collectMicrosoft365({tenantId:target.repository.slice(13),clientId:target.branch},secret);
 }
 if(target.provider==="GOOGLE_WORKSPACE"){
  if(!googleWorkspaceEnabled())throw new CollectionError("PROVIDER_DISABLED");
  if(!target.repository.startsWith("googleworkspace:"))throw new CollectionError("INVALID_TARGET");
  return collectGoogleWorkspace({customerId:target.repository.slice(16),clientId:target.branch},secret);
 }
 throw new CollectionError("PROVIDER_UNSUPPORTED");
};
export async function saveConnector(ctx:AuthorizedContext,input:unknown){
 if(!connectorsEnabled())throw new IntelligenceError("Evidence connectors await activation",503);
 const provider=(input as {provider?:string})?.provider,microsoft=provider==="MICROSOFT365"||provider==="INTUNE",google=provider==="GOOGLE_WORKSPACE",extra=isRecordProvider(provider)||["GITLAB","CLOUDFLARE","COMPANIES_HOUSE","VERCEL","SUPABASE","OKTA","OPENSSF_SCORECARD","AWS","GLEIF","WORKFORCE_LEAVER","AWS_ORGANIZATIONS"].includes(provider||"");
 const parsed=(extra?extraSchema:google?googleSchema:microsoft?microsoftSchema:schema).safeParse(input);if(!parsed.success)throw new IntelligenceError("Check the provider, target, credentials, control and version");
 if(microsoft&&!connectorProviderEnabled(provider!))throw new IntelligenceError("This Microsoft provider awaits activation",503);
 if(google&&!googleWorkspaceEnabled())throw new IntelligenceError("Google Workspace collection awaits activation",503);
 if(extra&&!connectorProviderEnabled(provider!))throw new IntelligenceError("This provider awaits activation",503);
 const raw=parsed.data;
 if(raw.intervalHours===1&&!supportsHourlyMonitoring(raw.provider))throw new IntelligenceError("This source supports daily or weekly monitoring");
 if(raw.provider==="COMPANIES_HOUSE"&&raw.token?.includes(":"))throw new IntelligenceError("Use a valid Companies House API key");
 if(raw.provider==='PIPEDREAM_READ'){
  await transaction(ctx,tx=>requireMember(tx,ctx,ADMIN));
  await (await import('./product-monitor-service')).productBinding(ctx.organizationId,raw,raw.controlId);
 }
 if(raw.provider==='NANGO_SYNC'&&raw.reference.includes('/')){
  await transaction(ctx,tx=>requireMember(tx,ctx,ADMIN));
  const [integration,connectionId]=raw.scope.split('/'),[provider,policy]=raw.reference.split('/');
  await (await import('./managed-control-policy')).readManagedPolicy(ctx.organizationId,policy,{integration,connectionId,provider,model:raw.record});
 }
 if(raw.provider==="OKTA"){
  await transaction(ctx,tx=>requireMember(tx,ctx,ADMIN));
  const matches=await oktaConnections(ctx.organizationId,nangoConfig(),fetch,raw.connectionId);
  if(matches.length!==1)throw new IntelligenceError("Choose an authorised Okta directory for this workspace",409);
 }
 const credentialRequired=requiresStoredSecret(raw.provider);
 const v={...raw,...storedTarget(raw)},repository=v.repository;
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);
  const control=await tx.managedControl.findFirst({where:{id:v.controlId,organizationId:ctx.organizationId,enabled:true}});if(!control)throw new IntelligenceError("Choose an active control from this organisation",404);
  const old=v.id?await tx.evidenceConnector.findFirst({where:{id:v.id,organizationId:ctx.organizationId}}):null;
  if(v.id&&!old)throw new IntelligenceError("Connector not found",404);
  if(old&&old.provider!==v.provider)throw new IntelligenceError("Create a separate connection when changing provider",409);
  if((old?.version||0)!==v.version)throw new IntelligenceError("Connector settings changed",409);
  if(credentialRequired&&!v.token&&!old?.encryptedSecret)throw new IntelligenceError("A restricted provider credential is required");
  const targetChanged=old&&(old.repository!==repository||old.branch!==v.branch);
  if(old&&v.provider==="PIPEDREAM_READ"&&(targetChanged||old.controlId!==v.controlId||old.failureCode==="CREDENTIAL_REJECTED"&&v.enabled))
   throw new IntelligenceError("Approve a fresh monitor for a changed scope, or renew its rejected grant in Company integrations.",409);
  const addingBambooCompany=old&&raw.provider==="WORKFORCE_LEAVER"&&raw.bambooCompanyId&&old.branch===v.branch&&repository===old.repository+":"+raw.bambooCompanyId&&!readWorkforceKeys(old.repository,old.branch)?.bambooCompanyId;
  if(targetChanged&&v.provider==="WORKFORCE_LEAVER"&&!addingBambooCompany)throw new IntelligenceError("Create a separate connection for a different leaver, ticket or directory identity",409);
  if(targetChanged&&registerProviders.includes(v.provider)&&await tx.vendor.findFirst({where:{organizationId:ctx.organizationId,signalConnectorId:old.id},select:{id:true}}))throw new IntelligenceError("This register is linked to a supplier. Create a connection for the new legal entity and select it in the supplier review.",409);
  if(targetChanged&&credentialRequired&&!v.token)throw new IntelligenceError("Supply a newly scoped credential when changing target");
  const id=old?.id||randomUUID();const data={provider:v.provider,controlId:v.controlId,repository,branch:v.branch,configuredById:ctx.userId,enabled:v.enabled,intervalHours:v.intervalHours,encryptedSecret:v.token?encryptConnectorSecret(v.token,ctx.organizationId,id):old?.encryptedSecret??null,encryptedWebhookSecret:old&&old.repository===repository&&old.branch===v.branch?old.encryptedWebhookSecret:null,webhookVersion:old?(old.repository===repository&&old.branch===v.branch?old.webhookVersion:old.webhookVersion+1):0,nextRunAt:new Date(),leaseToken:null,leaseUntil:null,attempts:0,failureCode:null};
  if(!old){
   const existing=await tx.evidenceConnector.findUnique({where:{organizationId_repository_branch:{organizationId:ctx.organizationId,repository:data.repository,branch:data.branch}}});
   if(existing){
    if((v.provider==='NANGO_SYNC'||v.provider==='PIPEDREAM_READ')&&existing.provider===v.provider&&existing.controlId===data.controlId&&existing.intervalHours===data.intervalHours&&existing.enabled&&data.enabled&&!existing.failureCode)
     return {id:existing.id,version:existing.version};
    throw new IntelligenceError("This target already has a connector",409);
   }
   if(await tx.evidenceConnector.count({where:{organizationId:ctx.organizationId}})>=maxWorkspaceConnectorTargets)throw new IntelligenceError("The workspace has reached its "+maxWorkspaceConnectorTargets+" saved connection limit",429);
  }
  const saved=old?await tx.evidenceConnector.update({where:{id},data:{...data,version:{increment:1}}}):await tx.evidenceConnector.create({data:{id,organizationId:ctx.organizationId,...data}});
  await tx.connectorControlLink.deleteMany({where:{connectorId:id,organizationId:ctx.organizationId,controlId:v.controlId}});
  const scopeHash=connectorScopeHash(saved);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.configured",entityType:"EvidenceConnector",entityId:id,details:{version:saved.version,controlId:v.controlId,enabled:v.enabled,credentialRotated:!!v.token,scopeHash,previousVersion:old?.version??null,credentialReplaced:credentialChanged(old,v.token,scopeHash)}}});return {id,version:saved.version};
 });
}
export async function disconnectConnector(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const changed=await tx.evidenceConnector.updateMany({where:{id,organizationId:ctx.organizationId,version},data:{enabled:false,failureCode:null,encryptedSecret:null,encryptedWebhookSecret:null,webhookVersion:{increment:1},leaseToken:null,leaseUntil:null,version:{increment:1}}});if(!changed.count)throw new IntelligenceError("Connector changed",409);await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.disconnected",entityType:"EvidenceConnector",entityId:id,details:{}}});return {id};});}
export async function requestConnectorRun(ctx:AuthorizedContext,id:string,version:number){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version,enabled:true}});if(!row)throw new IntelligenceError("Active connector not found or changed",409);if(row.failureCode==="RATE_LIMITED"&&row.nextRunAt>new Date())throw new IntelligenceError("The provider requested a cooldown. Collection can resume after the scheduled retry time.",429);if(row.leaseUntil&&row.leaseUntil>new Date())throw new IntelligenceError("A collection is already running",409);if(row.lastSuccessAt&&Date.now()-row.lastSuccessAt.getTime()<300000)throw new IntelligenceError("Wait five minutes between successful collections",429);const due=new Date();await tx.evidenceConnector.update({where:{id},data:{nextRunAt:due}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'EvidenceConnector',entityId:id,action:'connector.manual_due',details:{version,due:due.toISOString()}}});return {id};});}
/** Re-arm one failed paused connector without rotating secrets or erasing its incident. */
export async function retryConnector(ctx:AuthorizedContext,id:string,version:number){
 if(!connectorsEnabled())throw new IntelligenceError("Evidence collectors await activation",503);
 if(!z.uuid().safeParse(id).success||!Number.isInteger(version)||version<1)throw new IntelligenceError("Invalid connector selection");
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const row=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version}});
  if(!row)throw new IntelligenceError("Connection not found or settings changed",409);
  if(row.enabled||!row.failureCode)throw new IntelligenceError("Only a paused failed connection can be recovered",409);
  if(!connectorProviderEnabled(row.provider)||(requiresStoredSecret(row.provider)&&!row.encryptedSecret))throw new IntelligenceError("An enabled provider and stored credential are required",409);
  const recovery=connectorRecovery(row.failureCode);
  if(!recovery.retryable)throw new IntelligenceError(recovery.message,409);
  const now=new Date();
  if(row.leaseUntil&&row.leaseUntil>now)throw new IntelligenceError("A collection is already running",409);
  if(row.nextRunAt>now)throw new IntelligenceError("Wait until the scheduled retry time before another recovery attempt",429);
  const control=await tx.managedControl.findFirst({where:{id:row.controlId,organizationId:ctx.organizationId,enabled:true}});
  if(!control)throw new IntelligenceError("Enable the responsible control before recovering this connection",409);
  await requireMember(tx,{organizationId:ctx.organizationId,userId:control.ownerId,role:"EDITOR"},["OWNER","ADMIN","EDITOR"]);
  const changed=await tx.evidenceConnector.updateMany({where:{id,organizationId:ctx.organizationId,version,enabled:false,failureCode:row.failureCode,OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{enabled:true,configuredById:ctx.userId,attempts:2,nextRunAt:now,leaseToken:null,leaseUntil:null,version:{increment:1}}});
  if(changed.count!==1)throw new IntelligenceError("Connection changed; refresh before retrying",409);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"connector.recovery_requested",entityType:"EvidenceConnector",entityId:id,details:{previousFailureCode:row.failureCode,previousVersion:version,version:version+1,maxAdditionalAttempts:1}}});
  return {id,version:version+1};
 });
}
/**
 * Read-only, operator-triggered LIVE provider verification.
 * Claims only the exact organisation-scoped connection, never an unrelated queued job.
 * Reuses the normal encrypted-secret collector, lease fencing, evidence and audit path.
 * A successful observation verifies connectivity/target at that moment, not compliance.
 */
export async function verifyConnectorNow(ctx:AuthorizedContext,id:string,version:number,collector:Collector=collectConfiguredConnector){
 if(!connectorsEnabled())throw new IntelligenceError("Evidence collectors await activation",503);
 if(!z.uuid().safeParse(id).success||!Number.isInteger(version)||version<1)throw new IntelligenceError("Invalid connector selection");
 const now=new Date(),token=randomUUID();
 const job=await transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const record=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version}});
  if(!record)throw new IntelligenceError("Connection not found or settings changed",404);
  if(!record.enabled||!connectorProviderEnabled(record.provider)||(requiresStoredSecret(record.provider)&&!record.encryptedSecret))throw new IntelligenceError("Active provider and credential required",409);
  if(record.failureCode==="RATE_LIMITED"&&record.nextRunAt>now)throw new IntelligenceError("The provider requested a cooldown. Collection can resume after the scheduled retry time.",429);
  if(record.lastSuccessAt&&now.getTime()-record.lastSuccessAt.getTime()<300000)throw new IntelligenceError("Wait five minutes before another successful verification",429);
  if(!await claimManualConnectorLane(tx,ctx.organizationId,token))throw new IntelligenceError("Another connection in this workspace is being checked. Retry after it finishes.",409);
  const claim=await tx.evidenceConnector.updateMany({where:{
   id,organizationId:ctx.organizationId,version,enabled:true,...(requiresStoredSecret(record.provider)?{encryptedSecret:{not:null}}:{}),
   OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]
  },data:{leaseToken:token,leaseUntil:new Date(now.getTime()+90000),attempts:{increment:1},nextRunAt:now}});
  if(claim.count!==1)throw new IntelligenceError("This connection is already being verified or was changed",409);
  return tx.evidenceConnector.findUniqueOrThrow({where:{id}});
 });
 const outcome=await executeConnector(job,collector,{manual:true});
 return {connectorId:id,version,observed:outcome==="OBSERVED"||outcome==="FOLLOW_UP"||outcome==="INCOMPLETE",
  outcome,verifiedAt:new Date().toISOString(),
  note:"Read-only observation only. Inspect the saved signals, collection limits, and required human review."};
}
export async function claimConnector():Promise<EvidenceConnector|null>{
 if(!connectorsEnabled())return null;
 const providers=PROVIDERS.filter(connectorProviderEnabled);
 return claimFairConnector(providers);
}
class Superseded extends Error{}
async function assertJob(tx:Prisma.TransactionClient,job:EvidenceConnector){
 if(!connectorProviderEnabled(job.provider))throw new Superseded();
 const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "EvidenceConnector" WHERE id=${job.id}::uuid AND "organizationId"=${job.organizationId}::uuid AND enabled=true AND version=${job.version} AND "leaseToken"=${job.leaseToken}::uuid AND "leaseUntil">NOW() FOR UPDATE`;
 if(!rows.length)throw new Superseded();
 await requireMember(tx,{organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"},ADMIN);
 const [control]=await tx.$queryRaw<{ownerId:string}[]>`SELECT "ownerId" FROM "ManagedControl"
  WHERE id=${job.controlId}::uuid AND "organizationId"=${job.organizationId}::uuid AND enabled=true FOR SHARE`;
 if(!control)throw new IntelligenceError("Control is paused",403);
 const [owner]=await tx.$queryRaw<{role:string}[]>`SELECT role::text AS role FROM "Membership"
  WHERE "organizationId"=${job.organizationId}::uuid AND "userId"=${control.ownerId}::uuid FOR SHARE`;
 if(!owner||owner.role==="VIEWER")throw new IntelligenceError("Control ownership needs review",403);
}
type WriteQueue=<T>(write:()=>Promise<T>)=>Promise<T>;
// Use the same UTC minute every hour, regardless of how long an upstream read took.
export function nextHostedHour(createdAt:Date,completedAt:Date){
 const next=new Date(completedAt);
 next.setUTCHours(next.getUTCHours()+1,createdAt.getUTCMinutes(),0,0);
 return next;
}
async function collectConnectorJob(job:EvidenceConnector,collector:Collector,manual:boolean,queueWrite?:WriteQueue){
 const ctx:AuthorizedContext={organizationId:job.organizationId,userId:job.configuredById,role:"ADMIN"};
 let permit:ProviderPermit|undefined,providerOutcome='NEUTRAL';
 try{
  await transaction(ctx,tx=>assertJob(tx,job),8,'leased-connector');if(job.attempts>3)throw new CollectionError("INTERRUPTED_REPEATEDLY");
  if(requiresStoredSecret(job.provider)&&!job.encryptedSecret)throw new CollectionError("CREDENTIAL_UNAVAILABLE");
  const admission=await acquireProviderPermit(job.provider,job.organizationId);
  if(!admission.allowed){
   const deferred=await db.evidenceConnector.updateMany({where:{id:job.id,organizationId:job.organizationId,version:job.version,enabled:true,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{leaseToken:null,leaseUntil:null,attempts:Math.max(0,job.attempts-1),failureCode:admission.reason,nextRunAt:admission.retryAt}});
   return deferred.count?'PROVIDER_DEFERRED':'SUPERSEDED';
  }
  permit=admission.permit;
  const secret=job.encryptedSecret?decryptConnectorSecret(job.encryptedSecret,job.organizationId,job.id):"";
  const result=await collector({provider:job.provider,organizationId:job.organizationId,intervalHours:job.intervalHours,repository:job.repository,branch:job.branch},secret).then(result=>reconcileObservation(result,null)).then(result=>{providerOutcome='SUCCESS';return result;},error=>{providerOutcome=error instanceof CollectionError?error.code:'NEUTRAL';throw error;});
  const save=()=>transaction(ctx,async tx=>{await assertJob(tx,job);
   const due=job.nextRunAt.toISOString();
   const requested=manual?true:!!await tx.auditEvent.findFirst({where:{organizationId:job.organizationId,entityType:'EvidenceConnector',entityId:job.id,action:'connector.manual_due',details:{path:['due'],equals:due}},select:{id:true}});
   const hourlyHosted=job.provider==='PIPEDREAM_READ'&&job.intervalHours===1;
   const onHostedSchedule=hourlyHosted&&job.lastSuccessAt&&job.nextRunAt.getTime()===nextHostedHour(job.createdAt,job.lastSuccessAt).getTime();
   const collectionMode=requested?'MANUAL':job.eventRevision>job.collectedEventRevision?'EVENT':job.failureCode||job.attempts>1?'RETRY':
    (onHostedSchedule||job.lastSuccessAt&&job.nextRunAt.getTime()>=job.lastSuccessAt.getTime()+job.intervalHours*3600000-1000)?'SCHEDULED':'INITIAL';
   const previous=await tx.connectorRun.findFirst({where:{organizationId:job.organizationId,connectorId:job.id},orderBy:[{capturedAt:"desc"},{id:"desc"}]});
   const trustedPrevious=previous?.configVersion===job.version?verifiedObservation(previous):null;
   const checked=isTemperatureLogger(job.provider)?await applyLoggerCalibration(tx,job,result):
    job.provider==='NANGO_SYNC'?await (await import('./managed-renewal')).checkSyncAfterRenewal(tx,job,result):result;
   const reconciled=reconcileObservation(checked,trustedPrevious);
   const outcome=observationOutcome(reconciled),signalHash=hashValue({engine:reconciled.engine,checks:reconciled.checks});
   const changes=signalChanges(reconciled,trustedPrevious);
   const run=await tx.connectorRun.create({data:{organizationId:job.organizationId,connectorId:job.id,leaseToken:job.leaseToken!,configVersion:job.version,result:j(reconciled),resultHash:hashValue(reconciled),signalHash,outcome}});
   if(previous&&trustedPrevious&&changes.length){
    await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:'connector.compared',entityType:'ConnectorRun',entityId:run.id,
     details:{connectorId:job.id,baselineId:previous.id,baselineHash:previous.resultHash,resultHash:run.resultHash,
      checks:changes.map(({id,label,before,after})=>({id,label,before,after}))}}});
   }
   await enqueueConnectorEvent(tx,job,{kind:'CONNECTOR_OBSERVED',runId:run.id,fingerprint:signalHash,changed:changes.length>0});
   await enqueueConnectorObservationDelivery(tx,job,run);
   const current=await tx.evidenceConnector.findUniqueOrThrow({where:{id:job.id},select:{eventRevision:true}});
   const completedAt=new Date();
   const regularDue=hourlyHosted?nextHostedHour(job.createdAt,completedAt):new Date(completedAt.getTime()+job.intervalHours*3600000);
   const nextRunAt=current.eventRevision>job.eventRevision?new Date(completedAt.getTime()+60000):regularDue;
   await tx.evidenceConnector.update({where:{id:job.id},data:{leaseToken:null,leaseUntil:null,attempts:0,lastSuccessAt:completedAt,failureCode:null,collectedEventRevision:job.eventRevision,nextRunAt}});
   await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:"connector.evidence_collected",entityType:"EvidenceConnector",entityId:job.id,details:{runId:run.id,collectionMode,intervalHours:job.intervalHours,scopeHash:connectorScopeHash(job),outcome,resultHash:run.resultHash,configVersion:job.version,changedChecks:changes.map(c=>c.id)}}});return outcome;
  },8,'leased-connector');
  return await (queueWrite?queueWrite(save):save());
 }catch(error){
  if(error instanceof Superseded||!connectorProviderEnabled(job.provider))return "SUPERSEDED";
  if(error instanceof DatabaseContention){
   const putBack=await db.evidenceConnector.updateMany({where:{id:job.id,organizationId:job.organizationId,version:job.version,enabled:true,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},
    data:{leaseToken:null,leaseUntil:null,attempts:Math.max(0,job.attempts-1),nextRunAt:new Date(Date.now()+15000)}});
   return putBack.count?'DATABASE_BUSY':'SUPERSEDED';
  }
  const code=error instanceof CollectionError?error.code:error instanceof IntelligenceError&&error.status===403?"PERMISSION_REVOKED":"COLLECTION_FAILED";
  const throttled=code==="RATE_LIMITED",retryAfter=error instanceof CollectionError?error.retryAfterSeconds:undefined;
  const paused=!throttled&&job.attempts>=3||code==="PERMISSION_REVOKED"||code==="AWS_TRUST_UNSCOPED"||code==="CREDENTIAL_REJECTED"||code==="RETRY_REQUIRES_REVIEW";
  return await transaction(ctx,async tx=>{const changed=await tx.evidenceConnector.updateMany({where:{id:job.id,organizationId:job.organizationId,enabled:true,version:job.version,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{leaseToken:null,leaseUntil:null,failureCode:code,enabled:!paused,...(throttled?{attempts:Math.max(0,job.attempts-1)}:{}),nextRunAt:new Date(Date.now()+(throttled?Math.max(60,Math.min(7*86400,retryAfter||60))*1000:(job.attempts===1?5:30)*60000))}});if(!changed.count)return "SUPERSEDED";
   await enqueueConnectorEvent(tx,job,{kind:'CONNECTOR_FAILED',fingerprint:hashValue(code),reasonCode:code});
   const audit=await tx.auditEvent.create({data:{organizationId:job.organizationId,actorId:job.configuredById,action:"connector.collection_failed",entityType:"EvidenceConnector",entityId:job.id,details:{code,paused,...(error instanceof CollectionError&&error.step?{step:error.step}:{}),configVersion:job.version,scopeHash:connectorScopeHash(job)}}});await enqueueConnectorFailureDelivery(tx,job,audit.id,code,audit.createdAt);return paused?"ATTENTION":"RETRY_SCHEDULED";
  });
 }finally{try{if(permit)await settleProviderPermit(permit,providerOutcome);}finally{await releaseDispatchLease("CONNECTOR",job);}}
}
/** Evidence is committed before automation. A failed reaction remains durable for
 * another worker and must never turn a completed provider read into a failed read. */
export async function executeConnector(job:EvidenceConnector,collector:Collector=collectConfiguredConnector,options:{deferAutomation?:boolean;manual?:boolean;queueWrite?:WriteQueue}={}){
 const outcome=await collectConnectorJob(job,collector,options.manual===true,options.queueWrite);
 if(!options.deferAutomation)await processConnectorEvent(job).catch(()=>{});
 return outcome;
}
export const maxConnectorReadsPerTick=512;
export async function runConnectorBatch(limit=maxConnectorReadsPerTick,parallelism=4,admissionDeadline=Date.now()+20000,scope:'all'|'hosted-hourly'='all'){
 if(!connectorsEnabled())throw new IntelligenceError("Connectors await activation",503);
 if(!Number.isInteger(limit)||limit<1||limit>maxConnectorReadsPerTick||!Number.isInteger(parallelism)||parallelism<1||parallelism>maxConnectorLanes||!Number.isFinite(admissionDeadline))
  throw new IntelligenceError("Connector worker bounds invalid",400);
 const started=Date.now(),deadline=Math.min(admissionDeadline,started+20000),outcomes:string[]=[];
 const active=new Set<Promise<void>>();
 let claimed=0,dispatches=0,peakInFlight=0,maxQueueLagMs=0;
 const failures:unknown[]=[];
 // Keep the provider reads concurrent and commit each completed response in arrival order.
 // The database lease and config version are checked again when the write reaches the front.
 let lastWrite:Promise<void>=Promise.resolve();
 const queueWrite:WriteQueue=write=>{
  const result=lastWrite.then(write);
  lastWrite=result.then(()=>{},()=>{});
  return result;
 };
 function start(job:EvidenceConnector){
  const index=claimed++;
  maxQueueLagMs=Math.max(maxQueueLagMs,Date.now()-job.nextRunAt.getTime());
  const work=executeConnector(job,collectConfiguredConnector,{queueWrite,deferAutomation:true})
   .then(outcome=>{outcomes[index]=outcome;},error=>{failures.push(error);})
   .finally(()=>active.delete(work));
  active.add(work);peakInFlight=Math.max(peakInFlight,active.size);
 }
 try{
  while(!failures.length&&connectorsEnabled()&&claimed<limit&&Date.now()<deadline){
   const available=Math.min(parallelism-active.size,limit-claimed);
   if(available){
    const providers=scope==='hosted-hourly'?(['PIPEDREAM_READ'] as const):PROVIDERS;
    const jobs=await claimFairConnectors(providers.filter(connectorProviderEnabled),available,scope==='hosted-hourly');
    dispatches++;
    for(const job of jobs)start(job);
    if(!jobs.length&&!active.size)break;
    if(jobs.length===available&&active.size<parallelism)continue;
   }
   if(active.size){
    await Promise.race(active);
    // Amortise claims when several reads finish together without waiting for a slow tenant.
    if(active.size>Math.floor(parallelism/2)&&claimed<limit&&Date.now()<deadline){
     let timer:ReturnType<typeof setTimeout>|undefined;
     const window=new Promise<void>(resolve=>{timer=setTimeout(resolve,6);});
     try{await Promise.race([...active,window]);}finally{clearTimeout(timer);}
    }
   }
  }
 }finally{
  // Finish or release every lease already admitted, including if the next claim fails.
  await Promise.all(active);
 }
 if(failures.length)throw failures[0];
 return {processed:outcomes.length,outcomes,dispatches,peakInFlight,maxQueueLagMs,elapsedMs:Date.now()-started,limitReached:claimed===limit,budgetExhausted:Date.now()>=deadline};
}
export async function exportConnectorRun(ctx:AuthorizedContext,id:string,taskId?:string){
 return transaction(ctx,async tx=>{const actor=await requireMember(tx,ctx);const row=await tx.connectorRun.findFirst({where:{id,organizationId:ctx.organizationId},include:{connector:{select:{id:true,organizationId:true,repository:true,branch:true,controlId:true,configuredById:true,provider:true,version:true,enabled:true,lastSuccessAt:true,failureCode:true,intervalHours:true}}}});if(!row)throw new IntelligenceError("Observation not found",404);
  if(taskId){
   const task=await tx.obligation.findFirst({where:{id:taskId,organizationId:ctx.organizationId,connectorId:row.connectorId,
    category:'Automated evidence follow-up',...(ADMIN.includes(actor.role)?{}:{assigneeId:ctx.userId})},select:{controlId:true}});
   if(!task?.controlId||!await taskIncludesRun(tx,{organizationId:ctx.organizationId,id:taskId,connectorId:row.connectorId,controlId:task.controlId},row))
    throw new IntelligenceError('Linked source reading not found',404);
  }
  const latest=await tx.connectorRun.findFirst({where:{organizationId:ctx.organizationId,connectorId:row.connectorId},orderBy:[{capturedAt:"desc"},{id:"desc"}],select:{id:true}});
  const trusted=verifiedObservation(row);
  // Historical exports retain an intact, schema-checked payload for investigation.
  // A task receipt also requires a verified interpretation of its checks and outcome.
  const parsed=trusted?null:observationSchema.safeParse(row.result);
  const observation=trusted??(parsed?.success?parsed.data:null);
  if(!observation||hashValue(row.result)!==row.resultHash||hashValue(observation)!==row.resultHash||(taskId&&!trusted))
   throw new IntelligenceError("Observation integrity check failed",409);
  let current=!!trusted&&connectorProviderEnabled(row.connector.provider)&&observationCurrent(row,row.connector,latest?.id===row.id);
  if(current&&isTemperatureLogger(row.connector.provider)){
   current=await loggerReadingCurrent(tx,row.connector,observation);
  }
  if(taskId)await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'Obligation',entityId:taskId,
   action:'connector.reading_exported',details:{runId:row.id,resultHash:row.resultHash}}});
  return {format:"regpilot-connector-observation-v1",id:row.id,capturedAt:row.capturedAt,result:observation,resultHash:row.resultHash,signalIntegrity:trusted?"VERIFIED":"UNVERIFIED",currentAtExport:!!current,limitation:"Integrity hash is not a digital signature. A point-in-time observation does not establish compliance."};
 });
}
