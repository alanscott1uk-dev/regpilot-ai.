import {z} from "zod";
import {regulatorServices} from "../regulator-services";
import {accountingIds} from "../accounting-software";
import type {AuthorizedContext} from "./authorization";
import {transaction} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";

type Group="regulator"|"accounting";
const groups:Record<Group,readonly string[]>={
  regulator:regulatorServices.filter(s=>s.kind==="account").map(s=>s.id),accounting:accountingIds
};

export async function workspaceAccountShortcuts(ctx:AuthorizedContext,group:Group) {
  return transaction(ctx,async tx=>{
    const member=await requireMember(tx,ctx);
    const org=await tx.organization.findUniqueOrThrow({where:{id:ctx.organizationId},select:{accountShortcuts:true}});
    return {organizationId:ctx.organizationId,serviceIds:org.accountShortcuts.filter(id=>groups[group].includes(id)),canManage:ADMIN.includes(member.role)};
  });
}

export async function saveWorkspaceShortcut(ctx:AuthorizedContext,group:Group,input:unknown) {
  const {serviceId,pinned}=z.object({serviceId:z.string().max(60).refine(id=>groups[group].includes(id)),pinned:z.boolean()}).strict().parse(input);
  return transaction(ctx,async tx=>{
    await requireMember(tx,ctx,ADMIN);
    const where={id:ctx.organizationId};
    const org=await tx.organization.findUniqueOrThrow({where,select:{accountShortcuts:true}});
    const ids=new Set(org.accountShortcuts);
    if (ids.has(serviceId)!==pinned) {
      if (pinned) ids.add(serviceId); else ids.delete(serviceId);
      await tx.organization.update({where,data:{accountShortcuts:[...ids]}});
      await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,
        action:"workspace."+group+"_account_"+(pinned?"pinned":"unpinned"),
        entityType:"Organization",entityId:ctx.organizationId,details:{serviceId}}});
    }
    return {organizationId:ctx.organizationId,serviceIds:[...ids].filter(id=>groups[group].includes(id)),canManage:true};
  });
}
export const workspaceRegulatorAccounts=(ctx:AuthorizedContext)=>workspaceAccountShortcuts(ctx,"regulator");
export const saveRegulatorAccount=(ctx:AuthorizedContext,input:unknown)=>saveWorkspaceShortcut(ctx,"regulator",input);
