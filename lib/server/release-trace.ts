import type {Prisma} from "@prisma/client";
import type {PolicyReleasePlan} from "../policy-effectivity";
import {hashValue} from "../regulatory/intelligence";
import {reviewedFileSchema,reviewedFilesSchema} from "./reviewed-files";
import {IntelligenceError} from "./intelligence-service";
import {verifiedEffectivenessDecision} from "./capa-service";

export async function releaseTrace(tx:Prisma.TransactionClient,organizationId:string,releaseId:string,plan:PolicyReleasePlan,fileSnapshot:unknown){
  const file=reviewedFileSchema.parse(fileSnapshot);
  if(file.sha256!==plan.contentSha256||hashValue(file)!==plan.fileHash)throw new IntelligenceError("The original procedure reference differs from the release plan",409);
  const source=await tx.evidence.findFirst({where:{organizationId,id:file.id},select:{id:true,obligationId:true,reviewVersion:true,sha256:true,reviewStatus:true,scanStatus:true,
    obligation:{select:{id:true,title:true,status:true}}}});
  const exactFile={id:file.id,sha256:file.sha256,reviewVersion:file.reviewVersion};
  const cases=await tx.qualityCase.findMany({where:{organizationId,OR:[
    ...(source?[{actions:{some:{organizationId,obligationId:source.obligationId}}}]:[]),
    {effectiveness:{some:{organizationId,evidenceManifest:{array_contains:[exactFile]}}}}
  ]},orderBy:[{createdAt:"desc"},{id:"asc"}],take:26,select:{id:true,title:true,status:true,cycle:true,recurrenceCount:true,
    actions:{where:{organizationId,obligationId:source?.obligationId||"00000000-0000-0000-0000-000000000000"},orderBy:{createdAt:"asc"},take:26,select:{id:true,cycle:true,kind:true,obligationId:true}},
    effectiveness:{where:{organizationId},orderBy:[{createdAt:"desc"},{id:"asc"}],take:26}}});
  const training=await tx.trainingAssignment.groupBy({by:["status"],where:{organizationId,releaseId,revisionId:plan.revisionId},_count:{_all:true},orderBy:{status:"asc"}});
  const sourceReviewCurrent=Boolean(source&&source.scanStatus==="CLEAN"&&source.reviewStatus==="APPROVED"&&source.sha256===file.sha256&&source.reviewVersion===file.reviewVersion);
  const trace={source:{evidenceId:file.id,filename:file.filename,sha256:file.sha256,reviewVersion:file.reviewVersion,sourceReviewCurrent,task:source?.obligation||null},
    training:training.map(t=>({status:t.status,assignments:t._count._all})),
    qualityCases:cases.slice(0,25).map(c=>({id:c.id,title:c.title,status:c.status,cycle:c.cycle,recurrenceCount:c.recurrenceCount,
      sourceTaskActions:c.actions.slice(0,25),reviews:c.effectiveness.slice(0,25).map(r=>{
        const files=reviewedFilesSchema.safeParse(r.evidenceManifest);
        const citesProcedure=files.success&&files.data.some(f=>f.id===file.id&&f.sha256===file.sha256&&f.reviewVersion===file.reviewVersion);
        return {id:r.id,cycle:r.cycle,outcome:r.status,reviewerId:r.reviewerId,reviewedAt:r.reviewedAt?.toISOString()||null,citesProcedure,
          verifiedDecisionHash:verifiedEffectivenessDecision(r)?r.decisionHash:null};
      }),historyLimited:c.actions.length>25||c.effectiveness.length>25})),caseLimitReached:cases.length>25};
  return {...trace,traceHash:hashValue(trace)};
}
