import identities from './managed-product-identities.json';
import {publicRegisters} from './register-targets';
import type {Observation} from './observation';

// Multiple authentication methods or control models for a product share one identity.
const managedProducts:Record<string,string> = {
 'pagerduty':'PAGERDUTY','airtable':'AIRTABLE','asana':'ASANA','bamboohr':'BAMBOOHR','box':'BOX','confluence':'CONFLUENCE',
 'github':'GITHUB','github-app':'GITHUB','gitlab':'GITLAB','google-drive':'GOOGLE_DRIVE','grafana':'GRAFANA',
 'hubspot':'HUBSPOT','jira':'JIRA','linear':'LINEAR','microsoft-teams':'MICROSOFT_TEAMS','monday':'MONDAY',
 'notion':'NOTION','okta':'OKTA','salesforce':'SALESFORCE','slack':'SLACK','trello':'TRELLO','workday':'WORKDAY','zendesk':'ZENDESK'
};
const registeredProducts=new Map<string,string>();
for(const [family,slugs] of Object.entries(identities.families)){
 const product=managedProducts[family]??family.replaceAll('-','_').toUpperCase();
 for(const slug of slugs)registeredProducts.set(slug,product);
}
for(const [slug,product] of Object.entries(managedProducts))registeredProducts.set(slug,product);
export const managedProductIdentityCount=new Set(registeredProducts.values()).size;
const directNames:Record<string,string> = {PAGERDUTY_SERVICE:'PAGERDUTY',HEALTHCHECKS_JOB:'HEALTHCHECKS_IO',OPENAI_PROJECT_MODEL:'OPENAI',KEYCLOAK_REALM:'KEYCLOAK',STATUSPAGE_COMPONENT:'STATUSPAGE',GITHUB_WORKFLOW:'GITHUB',GITHUB_SCIM:'GITHUB',AWS_ORGANIZATIONS:'AWS',
 SLACK_MEMBER:'SLACK',BOX_USER:'BOX',ASANA_TASK:'ASANA',ZENDESK_TICKET:'ZENDESK',GRAFANA_DASHBOARD:'GRAFANA',GITEA_REPOSITORY:'GITEA',PROMETHEUS_ALERT_RULE:'PROMETHEUS'};
export const publicMonitoringProducts=new Set<string>([...publicRegisters,'OPENSSF_SCORECARD','COMPANIES_HOUSE','GLEIF']);
const unassigned=new Set(['PRIVATE_AI_MODEL','WORKFORCE_LEAVER']);
export function monitoringProduct(provider:string,managedSlug?:string){
 if(provider==='NANGO_SYNC')return managedSlug?registeredProducts.get(managedSlug)??null:null;
 if(unassigned.has(provider)||publicMonitoringProducts.has(provider))return null;
 return Object.hasOwn(directNames,provider)?directNames[provider]:provider;
}

export function advancesUpstream(earlier:number|null|undefined,later:number|null|undefined){
 return typeof earlier==='number'&&typeof later==='number'&&Number.isFinite(earlier)&&Number.isFinite(later)&&later>earlier;
}

/** The exact policy model must have a completed upstream run and known, reconciled controls. */
export function completedManagedSync(observation:Observation):number|null{
 if(!observation.engine.startsWith('managed-control-')||
    !observation.checks.some(c=>c.id==='resource-population'&&c.status==='PASS')||
    !observation.checks.some(c=>c.id.startsWith('resource-')&&c.id!=='resource-population')||
    observation.checks.some(c=>c.status==='UNKNOWN'))return null;
 const sync=observation.checks.find(c=>c.id==='source-sync'&&c.status==='PASS');
 const prefix='FRESH · ';
 if(!sync?.observed.startsWith(prefix))return null;
 const timestamp=Date.parse(sync.observed.slice(prefix.length)),collected=Date.parse(observation.capturedAt);
 return Number.isFinite(timestamp)&&timestamp<=collected&&collected-timestamp<=86400000?timestamp:null;
}
