import {Prisma,type WatchSchedule,type EvidenceConnector} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {db} from './db';
type LaneKind='SOURCE'|'CONNECTOR';

/** Each tenant gets one active slot per work type. The oldest-served eligible
 * tenant goes first, independent of the size or age of another tenant's backlog.
 * Lane and job are claimed in one statement; lane row locks fence concurrency. */
async function claim(kind:LaneKind,providers:string[]=[]){
 const table=kind==='SOURCE'?Prisma.raw('"WatchSchedule"'):Prisma.raw('"EvidenceConnector"');
 const date=kind==='SOURCE'?Prisma.raw('"nextCheckAt"'):Prisma.raw('"nextRunAt"');
 const eligible=kind==='SOURCE'?Prisma.sql`TRUE`:Prisma.sql`j.provider IN (${Prisma.join(providers)}) AND j."encryptedSecret" IS NOT NULL`;
 const token=randomUUID();
 return db.$queryRaw<Array<WatchSchedule|EvidenceConnector>>(Prisma.sql`
  WITH lane AS (
   SELECT l."organizationId" FROM "DispatchLane" l
   WHERE l.kind=${kind} AND (l."leaseUntil" IS NULL OR l."leaseUntil"<=NOW())
    AND NOT EXISTS (SELECT 1 FROM ${table} active WHERE active."organizationId"=l."organizationId" AND active.enabled=true AND active."leaseUntil">NOW())
    AND EXISTS (SELECT 1 FROM ${table} j WHERE j."organizationId"=l."organizationId" AND j.enabled=true AND j.${date}<=NOW() AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=NOW()) AND ${eligible})
   ORDER BY l."lastDispatchedAt" ASC NULLS FIRST,l."organizationId"
   FOR UPDATE OF l SKIP LOCKED LIMIT 1
  ), due AS (
   SELECT j.id FROM ${table} j JOIN lane l ON l."organizationId"=j."organizationId"
   WHERE j.enabled=true AND j.${date}<=NOW() AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=NOW()) AND ${eligible}
   ORDER BY j.${date},j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
  ), claimed AS (
   UPDATE ${table} j SET "leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '90 seconds',attempts=j.attempts+1,"updatedAt"=NOW()
    ${kind==='SOURCE'?Prisma.sql`,"lastAttemptAt"=NOW()`:Prisma.empty}
   FROM due WHERE j.id=due.id RETURNING j.*
  ), advanced AS (
   UPDATE "DispatchLane" l SET "lastDispatchedAt"=clock_timestamp(),"leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '90 seconds',"dispatchCount"=l."dispatchCount"+1
   FROM claimed j WHERE l."organizationId"=j."organizationId" AND l.kind=${kind} RETURNING l."organizationId"
  ) SELECT j.* FROM claimed j JOIN advanced a ON a."organizationId"=j."organizationId"`);
}
export async function claimFairWatch():Promise<WatchSchedule|null>{return ((await claim('SOURCE'))[0] as WatchSchedule|undefined)??null;}
export async function claimFairConnector(providers:string[]):Promise<EvidenceConnector|null>{
 if(!providers.length)return null;
 return ((await claim('CONNECTOR',providers))[0] as EvidenceConnector|undefined)??null;
}
export async function releaseDispatchLease(kind:LaneKind|'AUTOMATION',job:{organizationId:string;leaseToken:string|null}){
 if(!job.leaseToken)return;
 // A delayed completion must never release a newer worker's tenant slot.
 await db.dispatchLane.updateMany({where:{organizationId:job.organizationId,kind,leaseToken:job.leaseToken},data:{leaseToken:null,leaseUntil:null}});
}
export async function claimManualConnectorLane(tx:Prisma.TransactionClient,organizationId:string,token:string){
 const changed=await tx.$executeRaw`
  UPDATE "DispatchLane" l SET "leaseToken"=${token}::uuid,"leaseUntil"=NOW()+interval '90 seconds',"lastDispatchedAt"=clock_timestamp(),"dispatchCount"="dispatchCount"+1
  WHERE l."organizationId"=${organizationId}::uuid AND l.kind='CONNECTOR'
   AND (l."leaseUntil" IS NULL OR l."leaseUntil"<=NOW())
   AND NOT EXISTS (SELECT 1 FROM "EvidenceConnector" c WHERE c."organizationId"=l."organizationId" AND c.enabled=true AND c."leaseUntil">NOW())`;
 return changed===1;
}
