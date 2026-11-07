import {Prisma} from "@prisma/client";
import type {AuthorizedContext} from "./authorization";
import {transaction} from "./intelligence-service";
import {requireMember} from "./workspace-member";
import {REGULATORY_SOURCES} from "../regulatory-sources.mjs";
import type {SourceCoverage} from "../regulatory/source-coverage";
export async function sourceCoverage(ctx:AuthorizedContext){return transaction(ctx,async tx=>{
 await requireMember(tx,ctx);
 const extra=await tx.registeredSource.findMany({where:{organizationId:ctx.organizationId},select:{sourceId:true},orderBy:{title:"asc"},take:200});
 const ids=[...new Set([...REGULATORY_SOURCES.map(s=>s.id),...extra.map(s=>s.sourceId)])];
 // Latest per source, independent of the history screen's 60-version page.
 const rows=await tx.$queryRaw<Array<{sourceId:string;id:string;reviewStatus:string;lastCheckedAt:Date}>>`SELECT DISTINCT ON ("sourceId") "sourceId",id,"reviewStatus"::text,"lastCheckedAt" FROM "RegulatorySnapshot" WHERE "organizationId"=${ctx.organizationId}::uuid AND "sourceId" IN (${Prisma.join(ids)}) ORDER BY "sourceId","firstCapturedAt" DESC,id DESC`;
 const watches=await tx.watchSchedule.findMany({where:{organizationId:ctx.organizationId,sourceId:{in:ids}},select:{sourceId:true,enabled:true,failureCode:true,nextCheckAt:true,lastSuccessAt:true}});
 const snapshots=new Map(rows.map(r=>[r.sourceId,r])),schedules=new Map(watches.map(w=>[w.sourceId,w]));
 return ids.map(sourceId=>{const r=snapshots.get(sourceId),w=schedules.get(sourceId);return {sourceId,snapshotId:r?.id||null,reviewStatus:r?.reviewStatus||null,lastCheckedAt:r?.lastCheckedAt.toISOString()||null,monitoring:!w?"Not scheduled":!w.enabled?"Paused":process.env.REGPILOT_MONITORING_ENABLED!=="true"?"Awaiting activation":w.failureCode?"Collection needs attention":w.nextCheckAt.getTime()<Date.now()-3600000?"Schedule overdue":!w.lastSuccessAt?"Waiting for first scheduled check":"Scheduled"} satisfies SourceCoverage;});
 });}
