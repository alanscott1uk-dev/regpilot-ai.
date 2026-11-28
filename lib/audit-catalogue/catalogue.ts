import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import scfIndex from '../../public/audit-catalogue/scf-index.json';
import regulatoryIndex from '../../public/audit-catalogue/regulatory-index.json';
import {hitrustProfiles,preparationRows,preparationControl} from './hitrust';

export type Profile = {
  id:string; family:string; label:string; name:string; region:string; publisher:string; url:string;
  count:number; source:'scf'|'uk'|'eu'|'preparation'; digest:string; sampleCount?:number; passageCount?:number;
};
export type AuditControl = {
  id:string; name:string; domain:string; description:string; reference:string; url:string;
  sourcePassage?:string; suggestedEvidence?:boolean;
  objectives:{id:string;text:string}[]; evidence:{id:string;name:string;description:string}[];
};
type ScfControl = Pick<AuditControl,'id'|'name'|'domain'|'description'|'objectives'> & {evidence:string|null};
type ScfContent = {controls:Record<string,ScfControl>;evidence:Record<string,AuditControl['evidence'][number]>;mappings:Record<string,Record<string,string>>};
type Instrument = {provisions:Record<string,string>;passages:Record<string,string>;anchors:Record<string,string>;samples:Record<string,[string,string]>};
const source = scfIndex.source;
export const scfAttribution = {publisher:'Secure Controls Framework Council, LLC',edition:source.edition,license:source.license,url:source.url,terms:source.terms};
export const release = '2026-11-26.1';
const profiles:Profile[] = [
  ...scfIndex.profiles.map(p=>({...p,source:'scf' as const,digest:source.sha256})),
  ...regulatoryIndex as Profile[],...hitrustProfiles
];
export const mappedProfileChoices=profiles.filter(p=>p.source==='scf').map(({id,label})=>({id,label})).sort((a,b)=>a.label.localeCompare(b.label,'en'));
const byId = new Map(profiles.map(p=>[p.id,p]));
const families = new Map<string,Profile[]>();
for (const p of profiles) {
  const variants=families.get(p.family)??[];
  variants.push(p);
  families.set(p.family,variants);
}
export const catalogueTotals = {
  families:families.size, profiles:profiles.length, mappedFamilies:new Set(profiles.filter(p=>p.source==='scf').map(p=>p.family)).size,
  uk:profiles.filter(p=>p.source==='uk').length, eu:profiles.filter(p=>p.source==='eu').length,
  preparationFamilies:new Set(hitrustProfiles.map(p=>p.family)).size
};
export function getProfile(id:string) { return byId.get(id); }
function readPublished<T>(filename:string):T {
  const bytes=readFileSync(join(process.cwd(),'public','audit-catalogue',filename));
  return JSON.parse(gunzipSync(bytes).toString('utf8')) as T;
}
let scf:ScfContent|undefined, instruments:Record<string,Instrument>|undefined;
const dictionary = () => scf??=readPublished<ScfContent>('scf-content.json.gz');
const provisions = () => instruments??=readPublished<Record<string,Instrument>>('regulatory-content.json.gz');
const terms=(query:string)=>query.toLocaleLowerCase('en-GB').trim().slice(0,150).split(/\s+/).filter(Boolean);
const contains=(words:string[],value:string)=>words.every(w=>value.toLowerCase().includes(w));
export function paginate<T>(rows:T[],requested:number,size=20){
  const pages=Math.max(1,Math.ceil(rows.length/size)),page=Math.max(1,Math.min(pages,Number.isSafeInteger(requested)?requested:1));
  return {rows:rows.slice((page-1)*size,page*size),page,pages,total:rows.length};
}
export function searchFrameworks(query:string,region:string,page:number) {
  const words=terms(query);
  const result=[...families.values()].map(variants=>variants.filter(p=>(!region||p.region===region)&&contains(words,[p.name,p.label,p.id,p.publisher,p.region,p.family].join(' ')))).filter(v=>v.length);
  result.sort((a,b)=>a[0].name.localeCompare(b[0].name,'en'));
  return paginate(result,page);
}
export const frameworkRegions=[...new Set(profiles.map(p=>p.region))].sort();
export function variantsOf(p:Profile){return families.get(p.family)??[];}
function coreRows(profile:Profile):Record<string,string> {
  if(profile.source==='preparation')return Object.fromEntries(preparationRows(profile).map(p=>['RP-'+p[0],p[1]]));
  return profile.source==='scf'?dictionary().mappings[profile.id]:provisions()[profile.id].provisions;
}
export function referenceFor(profile:Profile,id:string):string|undefined {
  const rows=coreRows(profile);
  return Object.hasOwn(rows,id)?rows[id]:undefined;
}
export function controlIds(profile:Profile){return Object.keys(coreRows(profile));}

// Suggestions are independent working papers based on the action in a source passage.
// The reviewer records whether the provision applies to the organisation and chooses the sample.
const evidenceByAction = [
  {action:/^(?:notify|report|inform|communicate|give notice)\b/i,request:'Select a triggering event. Compare the event record, the dated notice and proof of receipt against the source provision.'},
  {action:/^(?:keep|retain|record|document|maintain (?:a |the )?(?:record|register|list))\b/i,request:'Select a dated record for the activity. Check its contents, who maintained it and whether the responsible team can retrieve it.'},
  {action:/^(?:assess|evaluate|analyse|analyze)\b/i,request:'Select a completed assessment. Inspect the inputs, decision, reviewer and resulting actions.'},
  {action:/^(?:approve|authorise|authorize|obtain consent)\b/i,request:'Select a decision and inspect the approval, date, scope and evidence of the decision maker’s authority.'},
  {action:/^(?:inspect|verify|test|monitor|review)\b/i,request:'Select one completed check. Inspect its scope, dated results and the record of any follow-up.'},
  {action:/^(?:provide training|train)\b/i,request:'Select a person in scope. Inspect the dated training record, course content and evidence of completion.'},
] as const;
function suggestedRequest(text:string){
  const obligation=text.match(/\b(?:must|shall|is required to|are required to)\s+(?!not\b)([^.;:]{1,140})/i);
  if(!obligation)return;
  const action=obligation[1].replace(/^(?:promptly|immediately|regularly|without undue delay)\s+/i,'');
  return evidenceByAction.find(rule=>rule.action.test(action))?.request;
}
export function getAuditControl(profile:Profile,id:string):AuditControl|undefined {
  if(profile.source==='preparation')return preparationControl(profile,id);
  const reference=referenceFor(profile,id);
  if(reference===undefined)return;
  if(profile.source==='scf'){
    const data=dictionary(),c=data.controls[id];
    return {id,name:c.name,domain:c.domain,description:c.description,reference,url:profile.url,objectives:c.objectives,
      evidence:(c.evidence??'').split(/\r?\n/).filter(Boolean).map(key=>data.evidence[key])};
  }
  const instrument=provisions()[profile.id],sample=instrument.samples[id],sourcePassage=instrument.passages?.[id]??'';
  const ref=profile.source==='uk'?id.split('/').join(' '):'Article '+id;
  const suggested=sample?undefined:suggestedRequest(sourcePassage);
  const request=sample?.[1]??suggested,anchor=instrument.anchors?.[id];
  return {id,name:reference,domain:profile.name,description:sample?.[0]??'',reference:ref,
    url:profile.source==='uk'?profile.url+'/'+id:profile.url+(anchor?'#'+anchor:''),
    sourcePassage,suggestedEvidence:!!suggested,objectives:[],evidence:request?[{id:ref,name:request,description:''}]:[]};
}
export function frameworkPage(profile:Profile,query:string,page:number) {
  const words=terms(query),rows=coreRows(profile);
  const prioritised=profile.source==='eu'||profile.source==='uk'?Object.keys(provisions()[profile.id].samples):[];
  const ids=[...new Set([...prioritised,...Object.keys(rows)])].filter(id=>{
    if(!words.length)return true;
    const c=getAuditControl(profile,id)!;
    return contains(words,[id,c.name,c.reference,c.domain,c.description,c.sourcePassage].join(' '));
  });
  const result=paginate(ids,page,15);
  return {...result,rows:result.rows.map(id=>getAuditControl(profile,id)!)};
}
