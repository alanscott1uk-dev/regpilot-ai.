import {embed, cosineSimilarity} from "@yarflam/potion-base-8m";
import type {RegulatorySource} from "../regulatory-sources.mjs";
import {normalisePublicationText} from "../regulatory/publication-query.mjs";

const catalogueVectors = new WeakMap<readonly RegulatorySource[], Promise<Float32Array[]>>();
const modelText = (text:string) => normalisePublicationText(text).replace(/\bsop\b/g,"standard operating procedure");

/** Bundled Potion embeddings run in the server process. Only fixed publication
 * metadata is cached. Query and passage vectors live for one request. */
export async function semanticPublicationSearch(question:string, catalogue:readonly RegulatorySource[]) {
  let index = catalogueVectors.get(catalogue);
  if (!index) {
    index = embed(catalogue.map(s=>modelText(s.title+". "+s.topic)));
    catalogueVectors.set(catalogue,index);
    index.catch(()=>catalogueVectors.delete(catalogue));
  }
  const vectors = await index;
  const [query] = await embed([modelText(question)]);
  const sourceScores = new Map(catalogue.map((source,i)=>[source.id,cosineSimilarity(query,vectors[i])]));
  return {
    sourceScores,
    async similarity(texts:string[]) {
      if (!texts.length) return [];
      const embedded = await embed(texts.map(modelText));
      return embedded.map(vector=>cosineSimilarity(query,vector));
    },
  };
}
export type PublicationSemantics = Awaited<ReturnType<typeof semanticPublicationSearch>>;
