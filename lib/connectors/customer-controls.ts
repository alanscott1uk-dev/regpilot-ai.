import {z} from 'zod';
import {booleanCheck,providerReader} from './bounded-http';
import {CollectionError} from './collection-error';
import type {Observation} from './observation';

const slug=z.string().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/);
const identity=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const state=z.enum(['active','inactive']);
const componentStates=['operational','degraded_performance','partial_outage','major_outage','under_maintenance'] as const;
const ticketStates=['new','open','pending','hold','solved','closed'] as const;
const componentId=z.string().regex(/^[a-z0-9]{6,32}$/);
export const customerTargets={
 GITHUB_SCIM:z.object({scope:slug,record:identity,reference:state}),
 ATLASSIAN_SCIM:z.object({scope:z.uuid().toLowerCase(),record:identity,reference:state}),
 STATUSPAGE_COMPONENT:z.object({scope:componentId,record:componentId,reference:z.enum(componentStates)}),
 ZENDESK_TICKET:z.object({scope:slug,record:z.string().regex(/^[1-9]\d{0,14}$/),reference:z.enum(ticketStates)})
};
type Provider=keyof typeof customerTargets;
export async function collectCustomerControl(provider:Provider,target:{scope:string;record:string;reference:string},token:string,fetcher:typeof fetch):Promise<Observation>{
 const {scope,record,reference}=target;
 const sourceUrl=provider==='GITHUB_SCIM'?'https://api.github.com/scim/v2/organizations/'+scope+'/Users/'+record:
  provider==='ATLASSIAN_SCIM'?'https://api.atlassian.com/scim/directory/'+scope+'/Users/'+record:
  provider==='STATUSPAGE_COMPONENT'?'https://api.statuspage.io/v1/pages/'+scope+'/components/'+record:
  'https://'+scope+'.zendesk.com/api/v2/tickets/'+record+'.json';
 const headers:Record<string,string>={Authorization:(provider==='STATUSPAGE_COMPONENT'?'OAuth ':'Bearer ')+token};
 if(provider==='GITHUB_SCIM')headers['X-GitHub-Api-Version']='2022-11-28';
 const {body}= (await providerReader(fetcher,headers)(sourceUrl))!;
 const row=provider==='ZENDESK_TICKET'?body?.ticket:body;
 if(String(row?.id)!==record||(provider==='STATUSPAGE_COMPONENT'&&row.page_id!==scope))throw new CollectionError('TARGET_MISMATCH');
 const checks=[];let value:string|undefined;
 if(provider==='GITHUB_SCIM'||provider==='ATLASSIAN_SCIM'){
  if(row.meta?.location!==undefined&&row.meta.location!==sourceUrl)throw new CollectionError('TARGET_MISMATCH');
  if(!Array.isArray(row.schemas)||!row.schemas.includes('urn:ietf:params:scim:schemas:core:2.0:User'))throw new CollectionError('INVALID_RESPONSE');
  value=typeof row.active==='boolean'?(row.active?'active':'inactive'):undefined;
 }else if(provider==='ZENDESK_TICKET'){
  if(row.url!==undefined&&row.url!==sourceUrl)throw new CollectionError('TARGET_MISMATCH');
  value=ticketStates.some(v=>v===row.status)?row.status:undefined;
  checks.push(booleanCheck('ticket-assigned','Ticket has an assigned owner',row.assignee_id===null?false:Number.isSafeInteger(row.assignee_id)&&row.assignee_id>0?true:undefined,true,'Review the ticket assignment in this Zendesk account.'));
 }else{value=componentStates.some(v=>v===row.status)?row.status:undefined;}
 const policy=booleanCheck('expected-state','Source state matches the approved target',value===undefined?undefined:value===reference,true,'Review the source record and the approved state with its owner.');
 checks.unshift({...policy,observed:value??'Not established'});
 return {engine:provider.toLowerCase()+'-1.0.0',capturedAt:new Date().toISOString(),sourceUrl,checks,limitations:['This observation covers the configured record at collection time.']};
}
