import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {siteProfile,siteProfiles} from '../library/site-facts';
import {hashValue} from '../regulatory/intelligence';
import {IntelligenceError,transaction} from './intelligence-service';
import type {AuthorizedContext} from './authorization';
import {ADMIN,requireMember} from './workspace-member';

const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('SAVE'),site:siteProfile,version:z.number().int().nonnegative(),requestKey:z.uuid()}).strict(),
 z.object({action:z.literal('ARCHIVE'),siteId:z.uuid(),version:z.number().int().positive(),requestKey:z.uuid()}).strict()
]);
const snapshot=z.object({sites:siteProfiles,version:z.number().int().positive(),requestHash:z.string(),digest:z.string()});
const type='LibrarySiteRegister',action='library.site-scope-updated';
export async function librarySites(tx:Prisma.TransactionClient,organizationId:string){
 const head=await tx.auditEvent.findFirst({where:{organizationId,entityType:type,entityId:organizationId,action},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{details:true,createdAt:true}});
 if(!head)return {sites:[],version:0,checkedAt:null,digest:null};
 const parsed=snapshot.safeParse(head.details);
 if(!parsed.success||hashValue({organizationId,sites:parsed.data.sites,version:parsed.data.version})!==parsed.data.digest)throw new IntelligenceError('Site register integrity requires review.',409);
 return {sites:parsed.data.sites,version:parsed.data.version,checkedAt:head.createdAt.toISOString(),digest:parsed.data.digest};
}
export async function saveLibrarySite(ctx:AuthorizedContext,raw:unknown){
 const d=input.parse(raw),organizationId=ctx.organizationId,requestHash=hashValue({actor:ctx.userId,...d});
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const current=await librarySites(tx,organizationId);
  const existing=await tx.auditEvent.findUnique({where:{id:d.requestKey},select:{organizationId:true,entityType:true,details:true}});
  if(existing){
   if(existing.organizationId!==organizationId||existing.entityType!==type||snapshot.safeParse(existing.details).data?.requestHash!==requestHash)throw new IntelligenceError('This request belongs to a different change.',409);
   return current;
  }
  if(d.version!==current.version)throw new IntelligenceError('Site facts changed. Refresh the statement before editing.',409);
  const id=d.action==='SAVE'?d.site.id:d.siteId;
  if(d.action==='ARCHIVE'&&!current.sites.some(s=>s.id===id))throw new IntelligenceError('Site unavailable in this register.',404);
  const others=current.sites.filter(s=>s.id!==id);
  const sites=siteProfiles.parse((d.action==='SAVE'?[...others,d.site]:others).sort((a,b)=>a.id.localeCompare(b.id)));
  const version=current.version+1,digest=hashValue({organizationId,sites,version});
  const row=await tx.auditEvent.create({data:{id:d.requestKey,organizationId,actorId:ctx.userId,entityType:type,entityId:organizationId,action,details:{sites,version,digest,requestHash}},select:{createdAt:true}});
  return {sites,version,digest,checkedAt:row.createdAt.toISOString()};
 });
}
