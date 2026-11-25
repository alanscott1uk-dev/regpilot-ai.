// These customer monitors read an explicitly selected resource with bounded requests.
const providers=new Set([
 'UBIBOT','TANDD_WEBSTORAGE','PAGERDUTY_SERVICE','HEALTHCHECKS_JOB','PROMETHEUS_ALERT_RULE',
 'GRAFANA_DASHBOARD','GITEA_REPOSITORY','GITHUB_WORKFLOW','GITHUB_SCIM','ATLASSIAN_SCIM',
 'STATUSPAGE_COMPONENT','ZENDESK_TICKET','SLACK_MEMBER','BOX_USER','ASANA_TASK','JIRA','SERVICENOW',
 'AZURE_DEVOPS','CONFLUENCE','SAFETYCULTURE','BENCHLING'
]);
export const supportsHourlyMonitoring=provider=>providers.has(provider);
