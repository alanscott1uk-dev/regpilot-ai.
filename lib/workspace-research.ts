import {z} from 'zod';
import {bm25Scores,searchTerms} from './retrieval/bm25';
import {normalisePublicationText} from './regulatory/publication-query.mjs';
import {citationHash,type SearchableKnowledgeChunk} from './company-knowledge';

export const workspaceResearchInput=z.object({
 question:z.string().trim().min(3).max(1200),
 asset:z.string().trim().max(100).default('').refine(value=>!value||/[\p{L}\p{N}]/u.test(value),'Enter a site or asset name'),
 productId:z.uuid().nullable().default(null)
}).strict();
type PolicyReference={title:string;number:number};
const words=(value:string)=>value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ')||'';
const noise=new Set('find show give current approved evidence records documents document report reports relevant guidance linked official procedure procedures supporting published our company site asset cold room check standard for please missing latest need me'.split(' '));

export function supportingPassages(question:string,asset:string,chunks:SearchableKnowledgeChunk[],policies:Map<string,PolicyReference|null>){
 const assetWords=words(asset),assetTerms=new Set(assetWords.split(' '));
 const raw=[...new Set(searchTerms(normalisePublicationText(question)))].filter(term=>!assetTerms.has(term)&&!noise.has(term));
 const topic=raw.length>1?raw.filter(t=>t!=='sop'):raw;
 const terms=chunks.map(chunk=>searchTerms(normalisePublicationText([policies.get(chunk.evidenceId)?.title,chunk.filename,chunk.text].filter(Boolean).join(' '))));
 const scores=bm25Scores(topic,terms);
 const ranked=chunks.map((chunk,i)=>({chunk,index:i,score:scores[i]})).filter(({chunk,index,score})=>{
  if(!score||topic.filter(term=>terms[index].includes(term)).length<Math.min(topic.length,2))return false;
  if(topic.includes('mapping')&&topic.includes('temperature')&&!(terms[index].includes('mapping')&&terms[index].includes('temperature')))return false;
  if(policies.has(chunk.evidenceId))return Boolean(policies.get(chunk.evidenceId));
  return !assetWords||[chunk.filename,chunk.text].some(value=>(' '+words(value)+' ').includes(' '+assetWords+' '));
 }).sort((a,b)=>b.score-a.score||a.chunk.evidenceId.localeCompare(b.chunk.evidenceId)||a.chunk.ordinal-b.chunk.ordinal);
 const seen=new Set<string>();
 const hits=ranked.flatMap(({chunk})=>{
  if(seen.has(chunk.evidenceId))return [];
  seen.add(chunk.evidenceId);
  const {evidenceId,indexId,filename,unit,unitKind,start,end,text:quote}=chunk;
  return [{policy:policies.get(evidenceId)||null,evidenceId,indexId,filename,unit,unitKind,start,end,quote,quoteHash:citationHash({evidenceId,unit,start,end,quote})}];
 });
 return {procedures:hits.filter(hit=>hit.policy).slice(0,5),evidence:hits.filter(hit=>!hit.policy).slice(0,5)};
}
