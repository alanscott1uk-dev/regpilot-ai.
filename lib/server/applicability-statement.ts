import {z} from 'zod';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {requireMember} from './workspace-member';
import {IntelligenceError} from './intelligence-service';
import {revisionContext,activeOwner} from './library-service';
import {coverageRunState} from './coverage-service';
import type {CoverageResult} from '../library/coverage';
import {evaluateDatedRule,factsSchema,type RuleResult} from '../library/applicability';
import {hashValue} from '../regulatory/intelligence';
import {verifiedObservation} from './connector-observation';
import {observationCurrent} from '../connectors/observation';
import {connectorProviderEnabled} from './connector-flags';

const nations=['England','Scotland','Wales','Northern Ireland'] as const;
const params=z.object({on:z.iso.date().optional(),collection:z.string().trim().max(100).default(''),offset:z.number().int().min(0).max(1000).default(0),inventory:z.string().regex(/^[0-9a-f]{64}$/).optional()}).strict();
type Input=z.input<typeof params>;
type Signal={provider:string;connectionId:string;runId:string|null;observedAt:string|null;hash:string|null;status:string};
type Mapping={controlId:string;title:string;decisionId:string;reviewerId:string;reason:string;current:boolean;relation:string|null;rationale:string|null;citations:{id:string;location:string;sha256:string|null;reviewVersion:number|null}[];signals:Signal[]};
type Row={id:string;collection:string;reference:string;revision:number;revisionId:string|null;title:string;state:string;reasons:string[];rationale:string|null;reviewedAt:string|null;ownerId:string|null;reviewerId:string|null;source:{name:string;id:string;url:string|null;fingerprint:string}|null;mappings:Mapping[];territories:{nation:string;assessment:RuleResult}[]};

export async function applicabilityStatementPage(ctx:AuthorizedContext,input:Input){
  const query=params.parse(input);
  return db.$transaction(async tx=>{
    await requireMember(tx,ctx);
    const org=ctx.organizationId;
    const index=await tx.libraryRequirement.findMany({where:{organizationId:org,...(query.collection?{collection:query.collection}:{})},
      orderBy:[{collection:'asc'},{reference:'asc'},{id:'asc'}],select:{id:true,collection:true,reference:true,currentRevision:true,version:true}});
    const profile=await tx.businessProfile.findUnique({where:{organizationId:org},select:{version:true,facts:true}});
    const on=query.on??new Date().toISOString().slice(0,10);
    const facts=factsSchema.safeParse(profile?.facts);
    const inventory=hashValue({on,org,collection:query.collection,index,profile:profile?.version??0});
    if((query.offset>0&&!query.inventory)||(query.inventory&&query.inventory!==inventory)||query.offset>index.length)
      throw new IntelligenceError('The requirement inventory or business profile changed. Refresh the statement.',409);
    const page=index.slice(query.offset,query.offset+10);
    const revisions=page.length?await tx.libraryRevision.findMany({where:{organizationId:org,OR:page.map(r=>({requirementId:r.id,number:r.currentRevision}))},select:{id:true,requirementId:true}}):[];
    const revisionIds=new Map(revisions.map(r=>[r.requirementId,r.id]));
    const decisions=await tx.coverageDecision.findMany({where:{organizationId:org,revisionId:{in:revisions.map(r=>r.id)},decision:{in:['ACCEPTED','WITHDRAWN']}},
      orderBy:[{createdAt:'desc'},{id:'desc'}],distinct:['revisionId','controlId'],include:{run:true,control:{select:{title:true}}}});
    const controlIds=decisions.map(d=>d.controlId);
    const connections=await tx.evidenceConnector.findMany({where:{organizationId:org,OR:[{controlId:{in:controlIds}},{controlLinks:{some:{organizationId:org,controlId:{in:controlIds}}}}]},
      select:{id:true,controlId:true,provider:true,version:true,enabled:true,intervalHours:true,failureCode:true,
        controlLinks:{where:{organizationId:org,controlId:{in:controlIds}},select:{controlId:true}},
        runs:{orderBy:[{capturedAt:'desc'},{id:'desc'}],take:1,select:{id:true,result:true,resultHash:true,signalHash:true,outcome:true,capturedAt:true,configVersion:true}}},orderBy:{id:'asc'}});
    const checkedAt=new Date();
    const signals=new Map<string,Signal[]>();
    for(const connection of connections){
      const run=connection.runs[0],verified=verifiedObservation(run);
      const current=!!run&&!!verified&&connectorProviderEnabled(connection.provider)&&observationCurrent(run,connection,true,checkedAt.getTime());
      const signal={provider:connection.provider,connectionId:connection.id,runId:run?.id??null,observedAt:run?.capturedAt.toISOString()??null,
        hash:verified?run.resultHash:null,status:!run?'NO_RUN':!verified?'INTEGRITY_REVIEW':!current?'STALE':run.outcome};
      for(const id of new Set([connection.controlId,...connection.controlLinks.map(l=>l.controlId)])){
        const existing=signals.get(id)??[];existing.push(signal);signals.set(id,existing);
      }
    }
    const states=new Map<string,Awaited<ReturnType<typeof coverageRunState>>>();
    const contexts=new Map<string,Awaited<ReturnType<typeof revisionContext>>>();
    const owners=new Map<string,boolean>();
    const rows:Row[]=[];
    for(const req of page){
      const id=revisionIds.get(req.id);
      const row:Row={id:req.id,collection:req.collection,reference:req.reference,revision:req.currentRevision,revisionId:id??null,title:'',state:'AWAITING_APPROVAL',
        reasons:[],rationale:null,reviewedAt:null,ownerId:null,reviewerId:null,source:null,mappings:[],territories:[]};
      rows.push(row);
      if(!id){row.reasons.push('No approved revision is available.');continue;}
      const context=contexts.get(id)??await revisionContext(tx,ctx,id);
      contexts.set(id,context);
      const {applicability,provenance}=context;
      if(context.current&&context.content&&facts.success){
        const content=context.content;
        row.territories=nations.map(nation=>({nation,assessment:evaluateDatedRule(content.rule,facts.data,[nation],on,content.effectivity)}));
      }
      row.title=context.content?.title??'';
      row.reasons=context.reasons;
      row.source=provenance?{id:provenance.id,name:provenance.name,url:provenance.url,fingerprint:provenance.fingerprint}:null;
      if(context.current&&applicability){
        row.rationale=applicability.rationale;row.reviewerId=applicability.reviewerId;row.ownerId=applicability.ownerId;
        row.reviewedAt=applicability.updatedAt.toISOString();
      }
      for(const decision of decisions.filter(d=>d.revisionId===id)){
        let state=states.get(decision.runId);
        if(!state){state=await coverageRunState(tx,ctx,decision.run,contexts);states.set(decision.runId,state);}
        const current=state.current&&decision.decision==='ACCEPTED';
        const proposal=current?(decision.run.result as unknown as CoverageResult).mappings.find(m=>m.key===decision.key&&m.revisionId===id&&m.controlId===decision.controlId):undefined;
        const evidence=current?(decision.run.context as {evidence:{id:string;sha256:string;reviewVersion:number}[]}).evidence:[];
        row.mappings.push({controlId:decision.controlId,title:decision.control.title,reviewerId:decision.reviewerId,decisionId:decision.id,current:current&&!!proposal,
          reason:decision.decision==='WITHDRAWN'?'Mapping withdrawn':current&&!proposal?'Reviewed mapping unavailable':state.reason,
          relation:proposal?.relation??null,rationale:proposal?decision.rationale:null,citations:proposal?.citations.map(c=>{
            const file=evidence.find(f=>f.id===c.evidenceId);
            return {id:c.evidenceId,location:(c.unitKind??'page')+' '+c.page,sha256:file?.sha256??null,reviewVersion:file?.reviewVersion??null};
          })??[],
          signals:current&&proposal?(signals.get(decision.controlId)??[]):[]});
      }
      let ownerActive=false;
      if(row.ownerId){
        if(!owners.has(row.ownerId)){
          try{await activeOwner(tx,ctx,row.ownerId);owners.set(row.ownerId,true);}
          catch(e){if(!(e instanceof IntelligenceError))throw e;owners.set(row.ownerId,false);}
        }
        ownerActive=owners.get(row.ownerId)===true;
      }
      row.state=!context.current?'SOURCE_REVIEW':!applicability?'SCOPE_REVIEW':applicability.decision==='NOT_APPLICABLE'?'EXCLUDED':!ownerActive?'OWNER_REVIEW':
        row.mappings.some(m=>m.current)?'APPLIES_MAPPED':'APPLIES_UNMAPPED';
    }
    return {format:'regpilot-applicability-statement-v1' as const,organizationId:org,collection:query.collection,assessmentDate:on,inventory,total:index.length,checkedAt:checkedAt.toISOString(),offset:query.offset,
      nextOffset:query.offset+page.length<index.length?query.offset+page.length:null,rows};
  },{isolationLevel:'RepeatableRead',timeout:20000});
}
