export type WorkspaceTool = {
  label: string;
  href: string;
  terms: string;
  icon?: string;
};

export const dailyTools: WorkspaceTool[] = [
  {label:'Today', href:'/team/operations', icon:'today', terms:'home dashboard priorities next step'},
  {label:'Tasks', href:'/team/work', icon:'tasks', terms:'to do my work overdue assignments'},
  {label:'Regulatory updates', href:'/team/intelligence', icon:'updates', terms:'regulation changes legislation news'},
  {label:'Evidence', href:'/team/evidence', icon:'evidence', terms:'find upload file evidence vault documents review PDF'},
  {label:'Reports', href:'/team/briefing', icon:'reports', terms:'report download export inspection briefing'}
];

export const workspaceTools: WorkspaceTool[] = [
  {label:'Workspace setup', href:'/team/setup', icon:'setup', terms:'start onboarding business profile organisation company'},
  {label:'Connections', href:'/team/operations?view=connections', icon:'connections', terms:'connect link integration accounts configure monitor'},
  {label:'Regulator accounts', href:'/regulator-accounts', icon:'reports', terms:'MHRA Home Office licensing portal'},
  {label:'Accounting software', href:'/team/accounting', icon:'connections', terms:'finance accounts Xero QuickBooks'},
  {label:'Help Centre', href:'/help', icon:'help', terms:'help how to user instructions guide support'}
];

const procedures = {label:'SOP builder', href:'/sop-builder', terms:'write create draft standard operating procedures Word document temperature mapping template'};
const quality = {label:'Deviations & CAPA', href:'/team/quality', terms:'record report deviation incident nonconformance non conformance quality case temperature excursion cold chain investigation corrective preventive action stock count batch Excel reconciliation Outlook email'};
export const homeActions = [
  {tool:procedures, label:'Write an SOP', instruction:'Choose a template or start with the procedure you need.'},
  {tool:quality, label:'Record a deviation', instruction:'Choose New quality case to record what happened.'},
  {tool:dailyTools[3], label:'Find evidence', instruction:'Open the evidence library to find a file or check its review.'}
];

function tool(label:string, href:string, terms:string): WorkspaceTool { return {label, href, terms}; }

export const toolGroups = [
  {name:'Daily work', tools:dailyTools},
  {name:'Procedures & training', tools:[procedures, tool('People & policies','/team/people','staff policies assignments'),tool('Document effectivity','/team/effectivity','effective date revision signed procedure signatures'),tool('Training & competence','/team/training','staff learning competency')]},
  {name:'Quality, stock & risk', tools:[quality,tool('Risk register','/team/risks','assess risk mitigation treatment'),tool('Change response','/team/changes','manage change impact action'),tool('Suppliers','/team/vendors','vendor qualification'),tool('AI inventory','/team/ai-inventory','systems artificial intelligence')]},
  {name:'Audits & controls',tools:[tool('Audits','/team/audits','inspection pack audit room'),tool('Audit requests','/team/audit-requests','auditor evidence request'),tool('Evidence assessment','/team/assurance','assess sufficiency review evidence'),tool('Requirements','/team/library','obligation library applicability'),tool('Control library','/team/operations?view=controls','controls recurring reviews'),tool('Access reviews','/team/access-reviews','permissions access review'),tool('Recognition','/team/recognition','award qualification')]},
  {name:'Monitoring & integrations',tools:[workspaceTools[1],workspaceTools[2],workspaceTools[3],tool('Integration directory','/integration-directory','browse catalogue catalog integrations applications'),tool('Database integrations','/database-integrations','database catalogue SQL Airbyte sources'),tool('Source checks','/team/sources','check sources drift failure'),tool('Monitoring health','/team/coverage','coverage failed checks recovery'),tool('Horizon feed','/horizon','regulatory horizon scanning'),tool('Outbound integrations','/team/integrations','outgoing events webhooks'),tool('Developer API','/team/developers','developer key customer observations')]},
  {name:'Customer assurance',tools:[tool('Products & scope','/team/products','products claims scope'),tool('Company knowledge','/team/knowledge','search company documents knowledge'),tool('Quality evaluation','/team/evaluations','benchmark assess answers'),tool('Capability trials','/team/trials','timed usability trials assessor'),tool('Approved answers','/team/answers','answers assurance response'),tool('Questionnaires','/team/questionnaires','customer questionnaire answers'),tool('Trust centre','/team/trust','public trust assurance')]},
  {name:'Workspace & help',tools:[workspaceTools[0],workspaceTools[4],tool('Team & access','/team/settings','invite member permissions'),tool('Starter programmes','/team/programmes','templates programme plan'),tool('Import programme','/team/operations?view=programme','import compliance programme'),tool('Task administration','/team','administer tasks'),tool('Services & spending','/team/services','services spending budget costs'),tool('AI Studio','/ai','ask AI assistant research'),tool('Explore demo','/workbench','demo example workspace')]}
];

export function searchTools(query:string){
  const terms=query.toLowerCase().replace(/\bs\.o\.p\b/g,'sop').split(/[^a-z0-9]+/);
  const words=terms.filter(word=>word&&!['a','an','the','to','my','of','how','where','do','i','can'].includes(word));
  return toolGroups.map(group=>({...group,tools:group.tools.filter(item=>{
    const text=(item.label+' '+item.terms+' '+group.name).toLowerCase();
    return words.every(word=>text.includes(word));
  })})).filter(group=>group.tools.length);
}
