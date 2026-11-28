import type {Prisma} from '@prisma/client';
import {normalisePublicationText} from '../regulatory/publication-query.mjs';
import {searchTerms} from '../retrieval/bm25';
import type {AuthorizedContext} from './authorization';
import {libraryEnabled} from './publication-catalogue';
import {activeOwner,revisionContext} from './library-service';
import {requireMember,ADMIN} from './workspace-member';
import {IntelligenceError} from './intelligence-service';
import {evidenceConfigured} from './evidence-storage';

const generic=new Set('which find show applies applicable current requirements requirement evidence records reviewed approved check tell about company business workspace'.split(' '));
export async function researchRequirements(tx:Prisma.TransactionClient,c:AuthorizedContext,question:string,scope:{productId:string|null;asset:string;nation?:string}){
 if(!libraryEnabled())return null;
 const hits=[];
 if(scope.asset||scope.productId)return {hits:[],notice:'Requirement decisions cover the organisation. Clear the site or product filter to include them.'};
 const profile=await tx.businessProfile.findUnique({where:{organizationId:c.organizationId},select:{jurisdictions:true}});
 const nations=Array.isArray(profile?.jurisdictions)?profile.jurisdictions.filter((n):n is string=>typeof n==='string'):[];
 if(scope.nation&&(nations.length!==1||nations[0]!==scope.nation))
   return {hits:[],notice:'The recorded business profile does not isolate the selected UK nation. Search across all nations to see its decisions.'};
 const terms=[...new Set(searchTerms(normalisePublicationText(question)))].filter(t=>!generic.has(t)).slice(0,16);
 if(!terms.length)return {hits:[],notice:'Enter a requirement reference, activity or clause topic.'};
 // Rank only current heads in this tenant. Recheck each shortlisted revision against its source and business profile before disclosure.
 const candidates=await tx.$queryRaw<{id:string}[]>`
  WITH heads AS (
   SELECT r.id, setweight(to_tsvector('simple',concat_ws(' ',q.reference,q.collection,r.content->>'title')),'A') ||
     setweight(to_tsvector('simple',coalesce(r.content->>'quote','')),'B') AS document
   FROM "LibraryRevision" r JOIN "LibraryRequirement" q ON q.id=r."requirementId" AND q."organizationId"=r."organizationId"
   WHERE r."organizationId"=${c.organizationId}::uuid AND r.status='ACCEPTED' AND q."currentRevision"=r.number
  ), query AS (SELECT to_tsquery('simple',${terms.join(' | ')}) AS terms)
  SELECT id FROM heads,query WHERE document @@ terms ORDER BY ts_rank(document,terms) DESC,id LIMIT 16`;
 let unavailable=0;
 for(const {id} of candidates){
  const r=await revisionContext(tx,c,id),p=r.provenance,content=r.content;
  if(!r.current||!p||!content||p.type!=='PUBLICATION'&&!evidenceConfigured()){unavailable++;continue;}
  let decision=r.applicability,owner:string|null=null;
  if(decision){
   try{
    await requireMember(tx,{...c,userId:decision.reviewerId},ADMIN);
    if(decision.ownerId)owner=(await activeOwner(tx,c,decision.ownerId)).user.email;
   }catch(e){if(!(e instanceof IntelligenceError))throw e;decision=null;}
  }
  hits.push({id,reference:r.revision.requirement.reference,collection:r.revision.requirement.collection,
   edition:r.revision.number,title:content.title,kind:content.kind,quote:content.quote,conditions:content.conditions,
   exceptions:content.exceptions,effectivity:content.effectivity??null,source:{id:p.id,type:p.type,title:p.name,url:p.url,
    page:p.page??null,block:p.block??null,label:p.label??null,start:p.start,end:p.end,fingerprint:p.fingerprint},
   decision:decision?.decision??null,rationale:decision?.rationale??null,owner,profileVersion:r.profileVersion,nations});
  if(hits.length===5)break;
 }
 return {hits,notice:unavailable?'Some shortlisted clauses are unavailable or need a fresh source review.':null};
}
