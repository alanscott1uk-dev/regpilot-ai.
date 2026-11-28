import {z} from "zod";
import type {AccountingId} from "../accounting-software";
import {brokerId,brokerOrigin,hostedConnectSession,type NangoConfig} from "./hosted-oauth";
import {providerReader,validCredential} from "./bounded-http";
import {CollectionError} from "./collection-error";

export function accountingConfig(provider:AccountingId):NangoConfig|null {
  const key=process.env.REGPILOT_NANGO_API_KEY||"";
  const integration=process.env["REGPILOT_NANGO_"+provider.toUpperCase()+"_INTEGRATION"]||"";
  return process.env.REGPILOT_ACCOUNTING_ENABLED==="true" && validCredential(key) && brokerId.safeParse(integration).success ? {key,integration} : null;
}
export type AccountingGrant={id:string;state:"authorised"|"needs_attention"};
export function startAccountingConsent(org:string,actor:string,provider:AccountingId,config:NangoConfig,fetcher:typeof fetch=fetch) {
  return hostedConnectSession(org,actor,config,fetcher,{regpilot_accounting_provider:provider});
}
export async function accountingGrants(org:string,provider:AccountingId,config:NangoConfig,fetcher:typeof fetch=fetch,exact?:string) {
  const params=new URLSearchParams({"tags[organization_id]":z.uuid().parse(org),"tags[regpilot_accounting_provider]":provider,limit:"100"});
  if(exact)params.set("connectionId",brokerId.parse(exact));
  const read=providerReader(fetcher,{Authorization:"Bearer "+config.key},8000);
  const grants:AccountingGrant[]=[],seen=new Set<string>();
  let firstPage="";
  for(let page=0;page<=5;page++){
    if(page)params.set("page",String(page));
    const rows=(await read(brokerOrigin+"/connections?"+params))?.body?.connections;
    if(!Array.isArray(rows)||rows.length>100)throw new CollectionError("INVALID_RESPONSE");
    const signature=JSON.stringify(rows.map(row=>[row?.provider_config_key,row?.connection_id]));
    if(page===0)firstPage=signature;
    if(page===1 && signature===firstPage && rows.length===100)continue;
    for(const row of rows) {
      if(row?.tags?.organization_id!==org||row.tags.regpilot_accounting_provider!==provider||
         row.provider!==provider||row.provider_config_key!==config.integration||(exact && row.connection_id!==exact))continue;
      const id=brokerId.safeParse(row.connection_id);
      if(!id.success||!Array.isArray(row.errors)||seen.has(id.data))throw new CollectionError("INVALID_RESPONSE");
      seen.add(id.data);
      grants.push({id:id.data,state:row.errors.length?"needs_attention":"authorised"});
    }
    if(rows.length<100)return grants;
  }
  throw new CollectionError("SCOPE_LIMIT");
}

const referenceFormat:Record<AccountingId,z.ZodString>={
  xero:z.string().uuid(),quickbooks:z.string().regex(/^\d{1,30}$/),
  sage:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
  freeagent:z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
};
export async function checkAccountingBusiness(org:string,provider:AccountingId,id:string,reference:string,config:NangoConfig,fetcher:typeof fetch=fetch) {
  const ref=referenceFormat[provider].parse(reference.trim());
  const grants=await accountingGrants(org,provider,config,fetcher,id);
  if(grants.length!==1||grants[0].state!=="authorised")throw new CollectionError("TARGET_MISMATCH");
  const paths={xero:"/connections",quickbooks:"/v3/company/"+ref+"/companyinfo/"+ref,sage:"/v3.1/businesses/"+ref,freeagent:"/v2/company"};
  const read=providerReader(fetcher,{Authorization:"Bearer "+config.key,"Provider-Config-Key":config.integration,"Connection-Id":id,
    Retries:"0",Accept:"application/json"},10000);
  const body=(await read(brokerOrigin+"/proxy"+paths[provider]))?.body;
  let name:unknown;
  switch(provider){
    case "xero":{
      if(!Array.isArray(body))throw new CollectionError("INVALID_RESPONSE");
      const matches=body.filter(row=>row?.tenantType==="ORGANISATION"&&row.tenantId?.toLowerCase()===ref.toLowerCase());
      if(matches.length===1)name=matches[0].tenantName;
      break;
    }
    case "quickbooks":
      // Intuit authorises the realm in the path. CompanyInfo.Id identifies the profile inside that realm.
      if(typeof body?.CompanyInfo?.Id==="string")name=body.CompanyInfo.CompanyName;
      break;
    case "sage":
      if(body?.id===ref)name=body.name||body.displayed_as;
      break;
    case "freeagent":
      if(body?.company?.subdomain===ref)name=body.company.name;
      break;
  }
  if(typeof name!=="string"||!name.trim()||name.length>250||/[\x00-\x1f\x7f]/.test(name))throw new CollectionError("TARGET_MISMATCH");
  return {name:name.trim(),reference:ref};
}
export async function disconnectAccountingGrant(org:string,provider:AccountingId,id:string,config:NangoConfig,fetcher:typeof fetch=fetch) {
  const matches=await accountingGrants(org,provider,config,fetcher,id);
  if(!matches.length)return false;
  const query=new URLSearchParams({provider_config_key:config.integration});
  const response=await fetcher(brokerOrigin+"/connections/"+encodeURIComponent(id)+"?"+query,{
    method:"DELETE",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(6000),headers:{Authorization:"Bearer "+config.key}});
  await response.body?.cancel();
  if(!response.ok && response.status!==404)throw new CollectionError("PROVIDER_UNAVAILABLE");
  return response.ok;
}

export type SupplierLedger="xero"|"quickbooks";
async function readLedgerRecord(org:string,provider:SupplierLedger,id:string,business:string,externalId:string,config:NangoConfig,fetcher:typeof fetch,kind:"supplier"|"bill"){
  const key=referenceFormat[provider].parse(externalId);
  const account=await checkAccountingBusiness(org,provider,id,business,config,fetcher);
  const headers:Record<string,string>={Authorization:"Bearer "+config.key,"Provider-Config-Key":config.integration,
    "Connection-Id":id,Retries:"0","Nango-Proxy-Accept":"application/json"};
  if(provider==="xero")headers["Nango-Proxy-Xero-Tenant-Id"]=account.reference;
  const resource=kind==="bill"?["Invoices","bill"]:["Contacts","vendor"];
  const path=provider==="xero"?"/api.xro/2.0/"+resource[0]+"/"+key:"/v3/company/"+account.reference+"/"+resource[1]+"/"+key;
  return {key,body:(await providerReader(fetcher,headers,10000)(brokerOrigin+"/proxy"+path))?.body};
}
export async function readAccountingSupplier(org:string,provider:SupplierLedger,id:string,business:string,externalId:string,config:NangoConfig,fetcher:typeof fetch=fetch){
  const {key,body}=await readLedgerRecord(org,provider,id,business,externalId,config,fetcher,"supplier");
  const label=z.string().trim().min(1).max(250).regex(/^[^\u0000-\u001f\u007f]+$/u);
  if(provider==="xero"){
    const schema=z.object({ContactID:z.uuid(),Name:label,ContactStatus:z.enum(["ACTIVE","ARCHIVED","GDPRREQUEST"]),IsSupplier:z.boolean()});
    const data=z.object({Contacts:z.array(schema).length(1)}).safeParse(body);
    if(!data.success)throw new CollectionError("INVALID_RESPONSE");
    const contact=data.data.Contacts[0];
    if(contact.ContactID.toLowerCase()!==key.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
    return {externalId:contact.ContactID,name:contact.Name,active:contact.ContactStatus==="ACTIVE",supplier:contact.IsSupplier};
  }
  const data=z.object({Vendor:z.object({Id:z.string(),DisplayName:label,Active:z.boolean()})}).safeParse(body);
  if(!data.success)throw new CollectionError("INVALID_RESPONSE");
  if(data.data.Vendor.Id!==key)throw new CollectionError("TARGET_MISMATCH");
  return {externalId:key,name:data.data.Vendor.DisplayName,active:data.data.Vendor.Active,supplier:true};
}

export type BillObservation={issuedOn:string;grossPence:number}|{reason:string};

function xeroBillDate(value:unknown):string|undefined {
  if(typeof value!=="string")return;
  const iso=/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z?)?$/.exec(value);
  if(iso)return iso[1];
  const legacy=/^\/Date\((\d{1,13})(?:\+0000)?\)\/$/.exec(value);
  if(legacy)return new Date(Number(legacy[1])).toISOString().slice(0,10);
}

export async function readAccountingBill(org:string,provider:SupplierLedger,id:string,business:string,externalId:string,config:NangoConfig,fetcher:typeof fetch=fetch):Promise<BillObservation>{
  const {key,body}=await readLedgerRecord(org,provider,id,business,externalId,config,fetcher,"bill");
  let date:unknown,currency:unknown,amount:unknown;
  if(provider==="xero"){
    const item=Array.isArray(body?.Invoices)&&body.Invoices.length===1?body.Invoices[0]:null;
    if(typeof item?.InvoiceID!=="string"||item.InvoiceID.toLowerCase()!==key.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
    if(item.Type!=="ACCPAY"||!["AUTHORISED","PAID"].includes(item.Status))return {reason:"Xero did not report an authorised or paid purchase bill"};
    date=xeroBillDate(item.DateString??item.Date);currency=item.CurrencyCode;amount=item.Total;
  }else{
    const item=body?.Bill;
    if(item?.Id!==key)throw new CollectionError("TARGET_MISMATCH");
    date=item.TxnDate;currency=item.CurrencyRef?.value;amount=item.TotalAmt;
  }
  if(currency!=="GBP")return {reason:"An explicit GBP bill currency is required"};
  if(!z.iso.date().safeParse(date).success||typeof date!=="string")return {reason:"The bill date could not be confirmed"};
  const decimal=(typeof amount==="number"||typeof amount==="string")&&/^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(amount));
  if(!decimal)return {reason:"The gross bill total could not be verified in pence"};
  const grossPence=Number(decimal[1])*100+Number((decimal[2]??"").padEnd(2,"0"));
  return grossPence>0?{issuedOn:date,grossPence}:{reason:"The bill has no positive gross amount"};
}
