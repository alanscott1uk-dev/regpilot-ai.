import {embedMany,type EmbeddingModel} from "ai";
import {checkedVector,KNOWLEDGE_LIMITS} from "../company-knowledge";

export type KnowledgeEmbeddingResult={vectors:number[][];usage:{tokens:number;inputValues:number;inputCharacters:number}};
/** Uses the installed AI SDK embedding provider contract; strings resolve through AI Gateway. */
export async function embedKnowledge(values:string[],model:EmbeddingModel=process.env.REGPILOT_KNOWLEDGE_EMBEDDING_MODEL||""):Promise<KnowledgeEmbeddingResult>{
 if(!values.length||values.length>KNOWLEDGE_LIMITS.chunksPerDocument||values.some(value=>!value.trim()||value.length>KNOWLEDGE_LIMITS.chunkCharacters))throw new Error("Embedding input exceeds the bounded indexing allowance");
 if(typeof model==="string"&&!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model))throw new Error("An explicit embedding provider/model is required");
 const result=await embedMany({model,values,maxRetries:0,maxParallelCalls:1,abortSignal:AbortSignal.timeout(KNOWLEDGE_LIMITS.modelTimeoutMs)});
 if(result.embeddings.length!==values.length)throw new Error("The embedding provider returned incomplete values");
 const vectors=result.embeddings.map(vector=>checkedVector(vector)),dimensions=vectors[0].length;vectors.forEach(vector=>checkedVector(vector,dimensions));
 if(!Number.isSafeInteger(result.usage.tokens)||result.usage.tokens<0)throw new Error("The embedding provider returned invalid token usage");
 return {vectors,usage:{tokens:result.usage.tokens,inputValues:values.length,inputCharacters:values.reduce((sum,value)=>sum+value.length,0)}};
}
