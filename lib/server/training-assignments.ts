import {randomUUID} from 'node:crypto';
import type {Prisma,TrainingRequirement,PolicyRevision} from '@prisma/client';
import type {AuthorizedContext} from './authorization';
import {IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {allowedEmail} from '../ai/security.mjs';
import {hashValue} from '../regulatory/intelligence';
import {TRAINING_LIMITS,trainingCriteriaSchema,trainingQuizSchema} from '../training';
type Tx=Prisma.TransactionClient;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function trainingRequirementSnapshot(requirement:TrainingRequirement,revision:PolicyRevision){return {requirementId:requirement.id,requirementVersion:requirement.version,policyId:requirement.policyId,preparedRevisionId:requirement.preparedRevisionId,revisionId:revision.id,revisionNumber:revision.number,objective:requirement.objective,criteria:trainingCriteriaSchema.parse(requirement.criteria),quiz:trainingQuizSchema.parse(requirement.quiz),passPercent:requirement.passPercent,dueDays:requirement.dueDays,validDays:requirement.validDays};}
/** Called only inside an authorised company transaction; assignments are idempotent by exact revision and role-enrolment identity. */
export async function reconcileTrainingCurriculum(tx:Tx,ctx:AuthorizedContext,curriculumId:string,reason:string){
 await requireMember(tx,ctx,ADMIN);const curriculum=await tx.trainingCurriculum.findFirst({where:{id:curriculumId,organizationId:ctx.organizationId}});if(!curriculum)throw new IntelligenceError('Training curriculum not found',404);
 if(!curriculum.active)return {created:0,superseded:0};
 const [requirements,enrolments,existing]=await Promise.all([
  tx.trainingRequirement.findMany({where:{organizationId:ctx.organizationId,curriculumId,active:true},orderBy:{id:'asc'},take:TRAINING_LIMITS.requirements+1,include:{policy:{include:{revisions:{where:{status:'PUBLISHED'},orderBy:{number:'desc'},take:1}}}}}),
  tx.trainingEnrollment.findMany({where:{organizationId:ctx.organizationId,curriculumId,active:true},orderBy:{id:'asc'},take:TRAINING_LIMITS.enrolments+1,include:{learner:{select:{email:true,memberships:{where:{organizationId:ctx.organizationId},select:{role:true}}}}}}),
  tx.trainingAssignment.findMany({where:{organizationId:ctx.organizationId,curriculumId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10001})
 ]);
 if(requirements.length>TRAINING_LIMITS.requirements||enrolments.length>TRAINING_LIMITS.enrolments||existing.length>10000)throw new IntelligenceError('This curriculum exceeds the bounded training scope',409);
 const today=new Date().toISOString().slice(0,10),now=new Date(),data:Prisma.TrainingAssignmentCreateManyInput[]=[],supersede:string[]=[];
 const eligible=enrolments.filter(enrolment=>enrolment.learner.memberships.length&&allowedEmail(enrolment.learner.email,process.env.REGPILOT_AI_ALLOWED_EMAILS));
 for(const requirement of requirements){const revision=requirement.policy.revisions[0];if(!requirement.policy.active||!revision||revision.number!==requirement.policy.currentRevision)continue;
  const snapshot=trainingRequirementSnapshot(requirement,revision),snapshotHash=hashValue(snapshot);
  for(const enrolment of eligible){
   const prior=existing.filter(assignment=>assignment.requirementId===requirement.id&&assignment.enrollmentId===enrolment.id),exact=prior.find(assignment=>assignment.revisionId===revision.id&&assignment.requirementVersion===requirement.version&&assignment.enrollmentVersion===enrolment.version);
   if(exact&&(['ASSIGNED','SUBMITTED','RETRAIN'].includes(exact.status)||exact.status==='PASSED'&&exact.validUntil&&exact.validUntil.toISOString().slice(0,10)>=today))continue;
   const cycle=exact?exact.cycle+1:1;if(cycle>50)throw new IntelligenceError('This training requirement reached its fifty-renewal history limit',409);
   supersede.push(...prior.filter(assignment=>['ASSIGNED','SUBMITTED','RETRAIN'].includes(assignment.status)).map(assignment=>assignment.id));
   const dueAt=new Date(now);dueAt.setUTCDate(dueAt.getUTCDate()+requirement.dueDays);
   data.push({id:randomUUID(),organizationId:ctx.organizationId,curriculumId,requirementId:requirement.id,enrollmentId:enrolment.id,revisionId:revision.id,learnerId:enrolment.userId,requirementVersion:requirement.version,enrollmentVersion:enrolment.version,cycle,dueAt,requirementSnapshot:json(snapshot),requirementHash:snapshotHash});
  }
 }
 if(supersede.length){await tx.trainingAttempt.updateMany({where:{organizationId:ctx.organizationId,assignmentId:{in:supersede},status:'PENDING'},data:{status:'SUPERSEDED',version:{increment:1}}});await tx.trainingAssignment.updateMany({where:{organizationId:ctx.organizationId,id:{in:supersede},status:{not:'PASSED'}},data:{status:'SUPERSEDED',version:{increment:1}}});}
 if(data.length){await tx.trainingAssignment.createMany({data});await tx.auditEvent.createMany({data:data.map(assignment=>({organizationId:ctx.organizationId,actorId:ctx.userId,action:'training.assigned',entityType:'TrainingAssignment',entityId:assignment.id!,details:{curriculumId,requirementId:assignment.requirementId,revisionId:assignment.revisionId,learnerId:assignment.learnerId,cycle:assignment.cycle!,reason}}))});}
 return {created:data.length,superseded:supersede.length};
}
/** A policy publication and its new training obligations commit together. No paid service or background delivery is required. */
export async function syncPublishedPolicyTraining(tx:Tx,ctx:AuthorizedContext,policyId:string){
 await requireMember(tx,ctx,ADMIN);const rows=await tx.trainingRequirement.findMany({where:{organizationId:ctx.organizationId,policyId,active:true,curriculum:{organizationId:ctx.organizationId,active:true}},select:{curriculumId:true},distinct:['curriculumId'],take:TRAINING_LIMITS.curricula+1});
 if(rows.length>TRAINING_LIMITS.curricula)throw new IntelligenceError('The published procedure exceeds the training curriculum limit',409);
 let created=0;for(const row of rows)created+=(await reconcileTrainingCurriculum(tx,ctx,row.curriculumId,'PROCEDURE_PUBLISHED')).created;return created;
}
