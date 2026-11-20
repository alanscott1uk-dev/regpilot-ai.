import {z} from "zod";
import {Prisma} from "@prisma/client";
import {accountingIds,type AccountingId} from "../accounting-software";
import {accountingConfig,accountingGrants,checkAccountingBusiness,disconnectAccountingGrant,startAccountingConsent} from "../connectors/accounting-oauth";
import {brokerId} from "../connectors/hosted-oauth";
import {CollectionError} from "../connectors/collection-error";
import type {AuthorizedContext} from "./authorization";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {saveWorkspaceShortcut,workspaceAccountShortcuts} from "./workspace-account-shortcuts";

const provider=z.enum(accountingIds);
const action=z.discriminatedUnion("action",[
  z.object({action:z.enum(["ADD","REMOVE","AUTHORISE","CHECK"]),provider}).strict(),
  z.object({action:z.literal("VERIFY"),provider,connectionId:brokerId,reference:z.string().trim().min(1).max(100)}).strict(),
  z.object({action:z.literal("DISCONNECT"),provider,connectionId:brokerId,confirm:z.literal(true)}).strict()
]);
export async function accountingWorkspace(ctx:AuthorizedContext) {
  const shortcuts=await workspaceAccountShortcuts(ctx,"accounting");
  return {...shortcuts,available:accountingIds.filter(id=>accountingConfig(id)!==null)};
}
const businessReceipt=z.object({name:z.string().min(1).max(250),reference:z.string().min(1).max(100),checkedAt:z.iso.datetime()});
async function requireAdded(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:AccountingId) {
    await requireMember(tx,ctx,ADMIN);
    const org=await tx.organization.findUniqueOrThrow({where:{id:ctx.organizationId},select:{accountShortcuts:true}});
    if(!org.accountShortcuts.includes(id))throw new IntelligenceError("Add this accounting package to the workspace first.",409);
}
export async function accountingAction(ctx:AuthorizedContext,input:unknown,fetcher:typeof fetch=fetch) {
  const d=action.parse(input),id=d.provider;
  if(d.action==="ADD"||d.action==="REMOVE") {
    await saveWorkspaceShortcut(ctx,"accounting",{serviceId:id,pinned:d.action==="ADD"});
    return {type:"workspace" as const,workspace:await accountingWorkspace(ctx)};
  }
  const recheck=()=>transaction(ctx,tx=>requireAdded(tx,ctx,id));
  await recheck();
  const config=accountingConfig(id);
  if(!config)throw new IntelligenceError("Provider authorisation is awaiting configuration for this package.",503);
  try {
    if(d.action==="AUTHORISE") {
      const session=await startAccountingConsent(ctx.organizationId,ctx.userId,id,config,fetcher);
      await recheck();
      return {type:"consent" as const,organizationId:ctx.organizationId,provider:id,...session};
    }
    if(d.action==="VERIFY") {
      const business=await checkAccountingBusiness(ctx.organizationId,id,d.connectionId,d.reference,config,fetcher);
      const checkedAt=new Date().toISOString();
      await transaction(ctx,async tx=>{
        await requireAdded(tx,ctx,id);
        await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"workspace.accounting_business_checked",
          entityType:"AccountingConnection",entityId:id+":"+d.connectionId,details:{...business,checkedAt}}});
      });
      return {type:"business" as const,organizationId:ctx.organizationId,provider:id,connectionId:d.connectionId,...business,checkedAt};
    }
    if(d.action==="DISCONNECT" && await disconnectAccountingGrant(ctx.organizationId,id,d.connectionId,config,fetcher)){
      await transaction(ctx,async tx=>{
        await requireAdded(tx,ctx,id);
        const entityId=id+":"+d.connectionId;
        await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
          action:"workspace.accounting_disconnected",entityType:"AccountingConnection",entityId,details:{provider:id}}});
      });
    }
    const grants=await accountingGrants(ctx.organizationId,id,config,fetcher);
    const records=await transaction(ctx,async tx=>{
      await requireAdded(tx,ctx,id);
      if(!grants.length)return [];
      const keys=grants.map(g=>id+":"+g.id);
      const latest=await tx.$queryRaw<{entityId:string;action:string;details:unknown}[]>`
        SELECT DISTINCT ON ("entityId") "entityId",action,details FROM "AuditEvent"
        WHERE "organizationId"=${ctx.organizationId}::uuid AND "entityType"='AccountingConnection'
          AND "entityId" IN (${Prisma.join(keys)}) ORDER BY "entityId","createdAt" DESC,id DESC`;
      const receipts=new Map(latest.filter(e=>e.action==="workspace.accounting_business_checked").map(e=>[e.entityId,businessReceipt.parse(e.details)]));
      return grants.map(g=>({...g,lastCheck:g.state==="authorised"?receipts.get(id+":"+g.id)||null:null}));
    });
    return {type:"grants" as const,organizationId:ctx.organizationId,provider:id,grants:records,checkedAt:new Date().toISOString()};
  } catch(e) {
    if(e instanceof IntelligenceError||e instanceof z.ZodError)throw e;
    if(e instanceof CollectionError&&e.code==="TARGET_MISMATCH")throw new IntelligenceError("The provider did not confirm that business on this connection.",409);
    if(e instanceof CollectionError&&e.code==="SCOPE_LIMIT")throw new IntelligenceError("Too many provider connections to confirm a complete list.",422);
    throw new IntelligenceError("The authorisation service could not confirm this request. Check the connection again.",502);
  }
}
