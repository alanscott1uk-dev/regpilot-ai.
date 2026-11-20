import {z} from "zod";
import {hashValue} from "./regulatory/intelligence";
import {extractionBlocked,type ExtractedDocument} from "./documents/coverage";

export const KNOWLEDGE_ENGINE="company-knowledge-1.0.0";
export const KNOWLEDGE_LIMITS={documents:40,chunksPerDocument:40,corpusChunks:1600,chunkCharacters:1200,overlapCharacters:150,charactersPerDocument:42000,dimensions:1536,hits:10,queryCharacters:1200,indexHistory:200,dailyIndexes:20,dailyIndexReuses:100,dailySearches:100,processingTimeoutMs:120000,modelTimeoutMs:45000,indexDays:30,searchHours:24} as const;
export const knowledgeMethod=z.enum(["CONTENT","SEMANTIC"]);
export type KnowledgeMethod=z.infer<typeof knowledgeMethod>;
export const knowledgeIndexInput=z.object({evidenceId:z.uuid(),method:knowledgeMethod,requestKey:z.uuid(),confirm:z.literal(true),retryOfId:z.uuid().optional()}).strict();
export const knowledgeSearchInput=z.object({query:z.string().trim().min(3).max(KNOWLEDGE_LIMITS.queryCharacters),productId:z.uuid().nullable().optional(),method:knowledgeMethod,requestKey:z.uuid(),confirm:z.literal(true),retryOfId:z.uuid().optional()}).strict();
export const knowledgeChunkSchema=z.object({ordinal:z.number().int().min(0).max(KNOWLEDGE_LIMITS.chunksPerDocument-1),unit:z.number().int().positive(),unitKind:z.enum(["page","block"]),start:z.number().int().nonnegative(),end:z.number().int().positive(),text:z.string().min(1).max(KNOWLEDGE_LIMITS.chunkCharacters),textHash:z.string().regex(/^[a-f0-9]{64}$/),vector:z.array(z.number().finite()).min(1).max(KNOWLEDGE_LIMITS.dimensions).nullable()}).strict().refine(chunk=>chunk.end===chunk.start+chunk.text.length&&hashValue(chunk.text)===chunk.textHash,"The indexed quotation changed");
export type KnowledgeChunkValue=z.infer<typeof knowledgeChunkSchema>;
export const knowledgeHitSchema=z.object({evidenceId:z.uuid(),filename:z.string().max(300),indexId:z.uuid(),unit:z.number().int().positive(),unitKind:z.enum(["page","block"]),quote:z.string().min(1).max(KNOWLEDGE_LIMITS.chunkCharacters),start:z.number().int().nonnegative(),end:z.number().int().positive(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/),score:z.number().finite(),scoreKind:z.enum(["CONTENT_MATCH","COSINE_SIMILARITY"])}).strict();
export type KnowledgeSearchHit=z.infer<typeof knowledgeHitSchema>;
export const knowledgeHitsSchema=z.array(knowledgeHitSchema).max(KNOWLEDGE_LIMITS.hits);
export function citationHash(hit:Pick<KnowledgeSearchHit,"evidenceId"|"unit"|"start"|"end"|"quote">){return hashValue({evidenceId:hit.evidenceId,unit:hit.unit,start:hit.start,end:hit.end,quote:hit.quote});}
/** Offsets are UTF-16 offsets in a single extracted PDF page or DOCX block. */
export function chunkKnowledgeDocument(document:ExtractedDocument):KnowledgeChunkValue[]{
 if(extractionBlocked(document)||!document.pages.length)throw new Error("Indexing requires complete readable PDF or DOCX text. Incomplete extraction was not indexed.");
 if(document.pages.reduce((sum,unit)=>sum+unit.text.length,0)>KNOWLEDGE_LIMITS.charactersPerDocument)throw new Error("This document exceeds the 42,000-character indexing limit. Use a shorter independently approved document.");
 const result:KnowledgeChunkValue[]=[],seen=new Set<number>();
 const boundary=(text:string,index:number)=>index>0&&index<text.length&&/[\uDC00-\uDFFF]/.test(text[index])&&/[\uD800-\uDBFF]/.test(text[index-1])?index-1:index;
 for(const unit of document.pages){
  if(!Number.isInteger(unit.page)||unit.page<1||seen.has(unit.page))throw new Error("Document locations are invalid or duplicated");seen.add(unit.page);
  let offset=0;
  while(offset<unit.text.length){
   const limit=boundary(unit.text,Math.min(offset+KNOWLEDGE_LIMITS.chunkCharacters,unit.text.length));
   let start=offset,end=limit;while(start<end&&/\s/u.test(unit.text[start]))start++;while(end>start&&/\s/u.test(unit.text[end-1]))end--;
   if(end>start){const text=unit.text.slice(start,end);result.push(knowledgeChunkSchema.parse({ordinal:result.length,unit:unit.page,unitKind:document.unitKind||"page",start,end,text,textHash:hashValue(text),vector:null}));}
   if(result.length>KNOWLEDGE_LIMITS.chunksPerDocument)throw new Error("This document exceeds the 40-chunk indexing limit. No partial index was retained.");
   if(limit===unit.text.length)break;
   offset=boundary(unit.text,limit-KNOWLEDGE_LIMITS.overlapCharacters);
  }
 }
 if(!result.length)throw new Error("No readable text was found. Scan images and signatures need visual review.");
 return result;
}
export function checkedVector(value:unknown,dimensions?:number):number[]{
 const result=z.array(z.number().finite()).min(1).max(KNOWLEDGE_LIMITS.dimensions).parse(value);
 if(dimensions!==undefined&&result.length!==dimensions)throw new Error("Embedding dimensions changed");
 const norm=Math.hypot(...result);if(!Number.isFinite(norm)||norm===0)throw new Error("Embedding vector has no finite direction");
 return result;
}
export const KNOWLEDGE_VECTOR_SCALE=1_000_000_000;
/** Fixed-point unit directions keep JSON/Prisma/PostgreSQL round trips exact.
 * The cosine angle is retained; each normalized coordinate rounds by at most 0.5e-9.
 */
export function vectorForKnowledgeStorage(value:unknown,dimensions?:number):number[]{
 const vector=checkedVector(value,dimensions),norm=Math.hypot(...vector);return vector.map(component=>Math.round(component/norm*KNOWLEDGE_VECTOR_SCALE)||0);
}
export function checkedStoredKnowledgeVector(value:unknown,dimensions?:number):number[]{
 const vector=checkedVector(value,dimensions);if(vector.some(component=>!Number.isSafeInteger(component)||Math.abs(component)>KNOWLEDGE_VECTOR_SCALE)||Math.abs(Math.hypot(...vector)-KNOWLEDGE_VECTOR_SCALE)>40)throw new Error("Stored embedding direction is invalid");return vector;
}
/** Scores are serialized as fixed decimal strings; source citations remain exact.
 * This avoids false integrity failures from last-bit JSON floating-point round trips.
 */
export function storedKnowledgeHits(hits:KnowledgeSearchHit[]){return knowledgeHitsSchema.parse(hits).map(hit=>({...hit,score:hit.score.toFixed(9)}));}
export function restoredKnowledgeHits(value:unknown){
 const rows=z.array(z.record(z.string(),z.unknown())).max(KNOWLEDGE_LIMITS.hits).parse(value);
 return knowledgeHitsSchema.parse(rows.map(row=>({...row,score:Number(z.string().regex(/^-?\d{1,6}\.\d{9}$/).parse(row.score))})));
}
export function cosineSimilarity(left:number[],right:number[]):number{
 if(left.length!==right.length||!left.length)throw new Error("Embedding dimensions differ");
 let dot=0,leftSquare=0,rightSquare=0;for(let i=0;i<left.length;i++){dot+=left[i]*right[i];leftSquare+=left[i]*left[i];rightSquare+=right[i]*right[i];}
 const value=dot/Math.sqrt(leftSquare*rightSquare);if(!Number.isFinite(value))throw new Error("Invalid embedding similarity");return Math.max(-1,Math.min(1,value));
}
const stopWords=new Set("the a an and or is are was were do does did how what which who when where why for to of in on at by with from that this these those our your their it its be been as can could would should we you they have has had please describe explain".split(" "));
function terms(text:string){return (text.toLocaleLowerCase("en-GB").match(/[\p{L}\p{N}]+/gu)||[]).filter(term=>term.length>1&&!stopWords.has(term));}
export type SearchableKnowledgeChunk=KnowledgeChunkValue&{evidenceId:string;filename:string;indexId:string};
/** BM25-style content matching and cosine ranking are distinct retrieval methods, never confidence. */
export function rankKnowledgeChunks(query:string,chunks:SearchableKnowledgeChunk[],method:KnowledgeMethod,queryVector?:number[]):KnowledgeSearchHit[]{
 if(chunks.length>KNOWLEDGE_LIMITS.corpusChunks)throw new Error("Knowledge corpus exceeds the supported retrieval limit");
 const queryTerms=[...new Set(terms(query))].slice(0,64),tokens=method==="CONTENT"?chunks.map(chunk=>terms(chunk.text)):[],average=tokens.reduce((sum,list)=>sum+list.length,0)/Math.max(1,tokens.length),frequencies=new Map(queryTerms.map(term=>[term,tokens.filter(list=>list.includes(term)).length]));
 const hits=chunks.map((chunk,index)=>{
  let score=0;
  if(method==="SEMANTIC"){
   if(!queryVector||!chunk.vector)throw new Error("Semantic retrieval requires compatible embeddings");
   score=cosineSimilarity(queryVector,chunk.vector);
  }else{
   const list=tokens[index];for(const term of queryTerms){const count=list.filter(token=>token===term).length;if(!count)continue;const idf=Math.log(1+(chunks.length-(frequencies.get(term)||0)+0.5)/((frequencies.get(term)||0)+0.5));score+=idf*(count*2.2)/(count+1.2*(0.25+0.75*list.length/Math.max(1,average)));}
  }
  const hit={evidenceId:chunk.evidenceId,filename:chunk.filename,indexId:chunk.indexId,unit:chunk.unit,unitKind:chunk.unitKind,quote:chunk.text,start:chunk.start,end:chunk.end,quoteHash:"",score,scoreKind:method==="SEMANTIC"?"COSINE_SIMILARITY" as const:"CONTENT_MATCH" as const};hit.quoteHash=citationHash(hit);return hit;
 }).filter(hit=>method==="SEMANTIC"||hit.score>0).sort((a,b)=>b.score-a.score||a.evidenceId.localeCompare(b.evidenceId)||a.unit-b.unit||a.start-b.start);
 return knowledgeHitsSchema.parse(hits.slice(0,KNOWLEDGE_LIMITS.hits));
}
