import {z} from "zod";
import {CollectionError,type ConnectorCheck} from "./github";
import {readBoundedJson} from "./bounded-http";
import {companiesHouseTarget} from "./companies-house";
import {resilientGet} from "./resilient-http";
import type {Observation} from "./observation";

const origin="https://api.gleif.org",records=origin+"/api/v1/lei-records";
const authorities=new Set(["RA000585","RA000586","RA000587"]);
const companyNumber=companiesHouseTarget.shape.companyNumber;
const uris=(lei:string)=>({api:records+"/"+lei,source:"https://search.gleif.org/#/record/"+lei});
export const gleifSource=(lei:string)=>uris(lei).source;
function validCheckDigits(value:string){
  let remainder=0;
  for(const c of value){
    const n=c>="A"?c.charCodeAt(0)-55:Number(c);
    remainder=(remainder*(n>=10?100:10)+n)%97;
  }
  return remainder===1;
}
export const leiCode=z.string().trim().toUpperCase().regex(/^[A-Z0-9]{18}\d{2}$/).refine(validCheckDigits,"Check the LEI check digits");
export const gleifTarget=z.object({companyNumber,lei:leiCode});
const name=z.string().trim().min(1).max(300);
const identity=z.object({type:z.literal("lei-records"),id:leiCode,attributes:z.object({lei:leiCode,
  entity:z.object({registeredAt:z.object({id:z.string().nullable()}),registeredAs:z.string().nullable(),legalName:z.object({name}),jurisdiction:z.string().nullable(),status:z.string().nullable().optional()}),
  registration:z.object({status:z.string().nullable().optional(),nextRenewalDate:z.string().nullable().optional(),
    corroborationLevel:z.string().nullish(),validatedAt:z.object({id:z.string().nullable()}).nullish(),validatedAs:z.string().nullish()})})});
type Identity=z.infer<typeof identity>;
// These Companies House number series fix the register even when GLEIF supplies only GB.
function expectedAuthority(number:string){
  if (/^(?:SC|SO|SL)/.test(number))return "RA000587";
  if (/^(?:NI|NC|NL)/.test(number))return "RA000586";
  if (/^(?:\d{8}|OC|LP)/.test(number))return "RA000585";
}
const jurisdictionAuthority:Record<string,string>={"GB-ENG":"RA000585","GB-WLS":"RA000585","GB-SCT":"RA000587","GB-NIR":"RA000586"};
function ukMatch(row:Identity,number:string){
  const entity=row.attributes.entity;
  const authority=entity.registeredAt.id??"",jurisdiction=entity.jurisdiction??"",expected=expectedAuthority(number);
  return row.id===row.attributes.lei && entity.registeredAs===number && authorities.has(authority) &&
    (jurisdiction==="GB"||jurisdictionAuthority[jurisdiction]===authority) && (!expected||expected===authority);
}
async function read(url:string,fetcher:typeof fetch){
  const res=await resilientGet(fetcher,origin,{Accept:"application/vnd.api+json"})(url);
  if(!res.ok){await res.body?.cancel();throw new CollectionError(res.status===404?"REGISTER_RECORD_MISSING":"PROVIDER_UNAVAILABLE");}
  return readBoundedJson(res,512000);
}
export async function findGleifCompany(number:string,fetcher:typeof fetch=fetch){
  const target=companyNumber.parse(number);
  const url=new URL(records);url.searchParams.set("filter[entity.registeredAs]",target);url.searchParams.set("page[size]","25");
  const result=await read(url.href,fetcher);
  const page=z.object({data:z.array(z.unknown()).max(25),meta:z.object({pagination:z.object({currentPage:z.literal(1),lastPage:z.number().int().nonnegative(),total:z.number().int().nonnegative()})})}).safeParse(result);
  if(!page.success)throw new CollectionError("INVALID_RESPONSE");
  const candidates:Array<{lei:string;name:string}>=[];
  const seen=new Set<string>();
  for(const item of page.data.data){
    const row=identity.safeParse(item);
    if(!row.success)throw new CollectionError("INVALID_RESPONSE");
    if(!ukMatch(row.data,target))continue;
    if(seen.has(row.data.id))throw new CollectionError("INVALID_RESPONSE");
    seen.add(row.data.id);candidates.push({lei:row.data.id,name:row.data.attributes.entity.legalName.name});
  }
  return {candidates,more:page.data.meta.pagination.lastPage>1||page.data.meta.pagination.total>page.data.data.length};
}
export async function collectGleif(input:z.input<typeof gleifTarget>,fetcher:typeof fetch=fetch,now=Date.now()):Promise<Observation>{
  const t=gleifTarget.parse(input),url=uris(t.lei);
  const result=await read(url.api,fetcher);
  const parsed=identity.safeParse(result?.data);
  if(!parsed.success)throw new CollectionError("INVALID_RESPONSE");
  const row=parsed.data;
  if(row.id!==t.lei||!ukMatch(row,t.companyNumber))throw new CollectionError("TARGET_MISMATCH");
  const {entity,registration}=row.attributes;
  const current=registration.status==="ISSUED",renewed=registration.nextRenewalDate;
  const validDate=renewed&&z.iso.datetime({offset:true}).safeParse(renewed).success?Date.parse(renewed):NaN;
  const follow="Inspect the LEI record and the exact Companies House company before the next supplier decision.";
  const status=(value:string|undefined|null,positive:string,negative:string[]):ConnectorCheck["status"]=>
    value===positive?"PASS":value&&negative.includes(value)?"FAIL":"UNKNOWN";
  const level=registration.corroborationLevel,exactValidation=registration.validatedAt?.id===entity.registeredAt.id&&registration.validatedAs===t.companyNumber;
  let corroboration:ConnectorCheck["status"]="UNKNOWN";
  if(level==="FULLY_CORROBORATED"&&exactValidation)corroboration="PASS";
  if(level==="PARTIALLY_CORROBORATED"||level==="ENTITY_SUPPLIED_ONLY")corroboration="FAIL";
  return {engine:"gleif-uk-identity-1.1.0",sourceUrl:url.source,capturedAt:new Date(now).toISOString(),checks:[
    {id:"uk-entity-match",label:"LEI record matches the UK company number",status:"PASS",observed:t.companyNumber,nextStep:follow},
    {id:"legal-entity-active",label:"GLEIF records the legal entity as active",status:status(entity.status,"ACTIVE",["INACTIVE"]),observed:entity.status??"Unreported",nextStep:follow},
    {id:"lei-issued",label:"LEI registration is issued",status:status(registration.status,"ISSUED",["LAPSED","RETIRED","MERGED","DUPLICATE","ANNULLED"]),observed:registration.status??"Unreported",nextStep:follow},
    {id:"lei-renewal",label:"An issued LEI has a future renewal date",status:!current||!Number.isFinite(validDate)?"UNKNOWN":validDate>now?"PASS":"FAIL",
     observed:Number.isFinite(validDate)?new Date(validDate).toISOString().slice(0,10):"Renewal date unavailable",nextStep:"Check renewal with the supplier when the reported date has passed or the registration is no longer issued."},
    {id:"registered-legal-name",label:"Registered legal name and registration authority",status:"PASS",observed:entity.legalName.name+" · "+entity.registeredAt.id,nextStep:follow},
    {id:"issuer-corroboration",label:"LEI issuer reports full corroboration using the same Companies House record",status:corroboration,
     observed:(level??"Unreported")+" · "+(exactValidation?"Primary validation authority and number match":"Primary validation authority or number unconfirmed"),
     nextStep:"Open the Companies House record and review the issuer’s validation basis before relying on this supplier identity."}
  ],limitations:["The match uses the registration authority and exact UK company number recorded by GLEIF. Addresses, officer data and personal contact details are excluded.",
    "An issued LEI identifies a legal entity. Financial health, beneficial ownership, trading permission and sanctions status require separate evidence."]};
}
