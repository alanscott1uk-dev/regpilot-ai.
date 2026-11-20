import {loadPublication} from "./ai-sources";
import {REGULATORY_SOURCES, officialSourceUrl, type RegulatorySource} from "../regulatory-sources.mjs";
import {researchPublications, recheckPassage, type ResearchInput, type ResearchPassage} from "../regulatory/research";

type Payload = Awaited<ReturnType<typeof loadPublication>>;
type CacheEntry = {expires: number; data: (Payload & {checkedAt: string}) | null};

/** Only the fixed register can allocate cache entries or trigger a publisher read.
 * A question, a user identity or private evidence never forms part of the cache. */
export function createResearchReader(load = loadPublication, now = Date.now) {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<Payload & {checkedAt:string}>>();
  return async (requested: RegulatorySource, maxAgeMs = 10*60_000) => {
    const source = REGULATORY_SOURCES.find(row => row.id === requested.id);
    if (!source) throw Error("Unknown official publication");
    const entry = cache.get(source.id);
    if (entry && entry.expires > now() && (!entry.data || Date.parse(entry.data.checkedAt)+maxAgeMs > now())) {
      if (!entry.data) throw Error("Publisher unavailable");
      return entry.data;
    }
    let request = pending.get(source.id);
    if (!request) {
      if (pending.size >= 8) throw Error("Publisher reads at capacity");
      request = Promise.resolve().then(() => load(source)).then(payload => {
        if (payload.id !== source.id || payload.url !== officialSourceUrl(source) ||
            typeof payload.text !== "string" || payload.text.length < 80 || payload.text.length > 60000)
          throw Error("Publication identity or content differs from the register");
        const checkedAt = now();
        const data = {...payload, checkedAt:new Date(checkedAt).toISOString()};
        cache.set(source.id,{data,expires:checkedAt+10*60_000});
        return data;
      }).catch(error => {
        cache.set(source.id,{data:null,expires:now()+60_000});
        throw error;
      }).finally(()=>pending.delete(source.id));
      pending.set(source.id,request);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([request, new Promise<never>((_,reject)=>{
        timer = setTimeout(()=>reject(Error("Publisher read deadline reached")), 14000);
      })]);
    } finally { clearTimeout(timer); }
  };
}
const readOfficial = createResearchReader();
export function searchOfficialPublications(input: ResearchInput) {
  return researchPublications(input,readOfficial);
}

export async function verifyOfficialPassage(receipt:Pick<ResearchPassage,"id"|"sourceId"|"documentHash"|"start"|"end"|"quote">) {
  const source=REGULATORY_SOURCES.find(row=>row.id===receipt.sourceId);
  if(!source) throw Error("Unknown official publication");
  return recheckPassage(receipt,await readOfficial(source,60_000));
}
