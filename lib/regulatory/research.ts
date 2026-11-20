import {createHash} from "node:crypto";
import {bm25Scores, searchTerms} from "../retrieval/bm25";
import {officialSourceUrl, REGULATORY_SOURCES, type RegulatorySource} from "../regulatory-sources.mjs";
import {JURISDICTIONS} from "./intelligence";

export type Nation = typeof JURISDICTIONS[number];
export const RESEARCH_LIMITS = {question: 1500, sources: 3, passages: 5, passageLength: 480} as const;
export type ResearchInput = {question: string; nation?: Nation};
export type ResearchDocument = {
  id: string; title: string; url: string; text: string;
  updatedAt: string | null; revisionAt: string | null; checkedAt: string;
};
export type ResearchReader = (source: RegulatorySource) => Promise<ResearchDocument>;
export type ResearchPassage = {
  id: string; sourceId: string; title: string; agency: string; url: string;
  checkedAt: string; revisionAt: string | null; documentHash: string;
  start: number; end: number; quote: string; jurisdictions: string[];
};
export type ResearchResult = Awaited<ReturnType<typeof researchPublications>>;

const noise = new Set(("uk gb great britain business businesses need find guide guides guidance rules requirements " +
  "about relevant official source sources publication publications published apply applies would tell know relating information " +
  "follow subject british england english scotland scottish wales welsh northern ireland irish").split(" "));
const aliases: [RegExp, string][] = [
  [/\b(?:commercial|business|trade) (?:refuse|rubbish)\b/gi, " commercial waste "],
  [/\bgood manufacturing practice\b/gi, " gmp "],
  [/\bgood distribution practice\b/gi, " pharmaceuticalgdp "],
  [/\bgdp\b/gi, " pharmaceuticalgdp "],
  [/\bwda\s*\(\s*h\s*\)|\bwholesale dealer(?:'s|’s|s)? authorisation\b/gi, " wholesale medicine licence "],
  [/\b(?:gdpr|general data protection regulation)\b/gi, " data protection "],
  [/\b(?:aml|anti[- ]money laundering)\b/gi, " money laundering "],
  [/\b(?:epr|extended producer responsibility)\b/gi, " packaging producer responsibility "],
  [/\b(?:postmarket|post[- ]market)\b/gi, " postmarket "],
];
const generalTerms = new Set("must may help prepare cover covers covered need record keep use used using check checks managing manage review find work about concerning".split(" "));
const roots: Record<string,string> = {
  wholesale:"wholesale",wholesaler:"wholesale",wholesalers:"wholesale",wholesaling:"wholesale",
  license:"licence",licenses:"licence",licensing:"licence",licensed:"licence",licences:"licence",
  manufacture:"manufacturing",manufacturer:"manufacturing",manufacturers:"manufacturing",
  pharmaceutical:"medicine",pharmaceuticals:"medicine",pharma:"medicine",medicines:"medicine",
  verifications:"verification",verifying:"verification",verify:"verification",
  registering:"registration",register:"registration",records:"record",keeping:"keep",
  regulated:"regulation",regulating:"regulation",devices:"device",risks:"risk",assessments:"assessment",
};

function terms(text: string) {
  let searchable = text;
  // Gross domestic product is outside the pharmaceutical register.
  const economic = /\b(growth|economy|economic|inflation|gross domestic product)\b/i.test(text);
  if (economic) searchable = searchable.replace(/\bgdp\b/gi, " ");
  for (const [pattern, replacement] of aliases) searchable = searchable.replace(pattern, replacement);
  return searchTerms(searchable).filter(word => !noise.has(word)).map(word => Object.hasOwn(roots, word) ? roots[word] : word);
}

const regions: Record<Nation, RegExp> = {
  England: /\bengl(?:and|ish)\b/i, Scotland: /\bscot(?:land|tish)\b/i,
  Wales: /\b(?:wales|welsh)\b/i, "Northern Ireland": /\b(?:northern ireland|n\.?i\.?)\b/i,
};

function mentionedNations(text:string) {
  const greatBritain=/\b(?:great britain|gb)\b/i.test(text);
  return JURISDICTIONS.filter(n=>regions[n].test(text) || (greatBritain && n!=="Northern Ireland"));
}

function localSource(source:RegulatorySource, nations:readonly Nation[]) {
  return source.jurisdictions?.length===1 && nations.some(n=>source.jurisdictions!.includes(n));
}

export function researchCandidates(input: ResearchInput, catalogue: readonly RegulatorySource[] = REGULATORY_SOURCES) {
  const nations = input.nation ? [input.nation] : mentionedNations(input.question);
  const eligible = catalogue.filter(source => !nations.length || !source.jurisdictions?.length ||
    nations.some(n => source.jurisdictions!.includes(n)));
  const query = [...new Set(terms(input.question))].slice(0,64);
  const titles = eligible.map(s => terms(s.title + " " + s.topic));
  const publisher = eligible.map(s => terms(s.agency));
  const frequencies = query.map(term => ({term, count:titles.filter(row=>row.includes(term)).length}))
    .filter(({term,count})=>count>0 && !generalTerms.has(term));
  const rarest = Math.min(...frequencies.map(row=>row.count));
  const anchors = frequencies.filter(row=>row.count<=Math.min(Math.max(2,eligible.length/6),rarest+1)).map(row=>row.term);
  const scores = bm25Scores(query, titles);
  const byPublisher = bm25Scores(query, publisher);
  const ranked = eligible.map((source, i) => {
    const territorial = nations.length && source.jurisdictions?.length && source.jurisdictions.length < 4;
    const localTopic = localSource(source,nations) && query.filter(term=>!generalTerms.has(term)&&titles[i].includes(term)).length>=2;
    const score = (scores[i] + byPublisher[i] * 0.4) * (localTopic ? 2 : territorial ? 1.4 : 1);
    return {source, score, localTopic, anchored:localTopic || !anchors.length || anchors.some(term=>titles[i].includes(term))};
  }).filter(row => row.score > 0 && row.anchored).sort((a,b) => b.score-a.score || a.source.id.localeCompare(b.source.id));
  return {nations, anchors, sources: ranked.filter(row=>row.localTopic || row.score>=ranked[0].score*0.25)
    .slice(0, RESEARCH_LIMITS.sources).map(row => row.source)};
}

const segmenter = new Intl.Segmenter("en-GB", {granularity: "sentence"});
/** Boundaries are UTF-16 offsets in the exact text returned by the verified extractor. */
function passages(text: string) {
  const spans: {start:number; end:number; quote:string}[] = [];
  let start = -1, end = 0;
  function flush() {
    if (start >= 0) {
      while (start < end && /\s/u.test(text[start])) start++;
      while (end > start && /\s/u.test(text[end-1])) end--;
      if (end-start >= 12) spans.push({start,end,quote:text.slice(start,end)});
    }
    start = -1;
  }
  for (const part of segmenter.segment(text)) {
    let from = part.index;
    const to = from + part.segment.length;
    if (start >= 0 && to-start > RESEARCH_LIMITS.passageLength) flush();
    while (to-from > RESEARCH_LIMITS.passageLength) {
      let cut = from + RESEARCH_LIMITS.passageLength;
      const space = text.lastIndexOf(" ", cut);
      if (space > from + RESEARCH_LIMITS.passageLength/2) cut = space;
      if (/[\uD800-\uDBFF]/.test(text[cut-1])) cut--;
      start = from; end = cut; flush(); from = cut;
    }
    if (start < 0) start = from;
    end = to;
  }
  flush();
  return spans;
}

export function researchHash(text: string) { return createHash("sha256").update(text,"utf8").digest("hex"); }

type Receipt = Pick<ResearchPassage,"id"|"sourceId"|"documentHash"|"start"|"end"|"quote">;
function passageId(sourceId:string, digest:string, start:number, end:number, quote:string) {
  return researchHash(JSON.stringify([sourceId,digest,start,end,quote]));
}
export function validPassageReceipt(receipt:Receipt) {
  return receipt.end-receipt.start===receipt.quote.length && receipt.start>=0 && receipt.end<=60000 &&
    receipt.id===passageId(receipt.sourceId,receipt.documentHash,receipt.start,receipt.end,receipt.quote);
}
export function recheckPassage(receipt:Receipt, doc:ResearchDocument) {
  if (!validPassageReceipt(receipt) || doc.id!==receipt.sourceId) throw Error("Invalid passage reference");
  const documentHash=researchHash(doc.text);
  const result=(status:"verified"|"same_position"|"relocated"|"ambiguous"|"missing"|"inconsistent", start:number|null)=>
    ({status,documentHash,checkedAt:doc.checkedAt,start,end:start===null?null:start+receipt.quote.length});
  if(documentHash===receipt.documentHash) {
    return doc.text.slice(receipt.start,receipt.end)===receipt.quote ? result("verified",receipt.start) : result("inconsistent",null);
  }
  const at=doc.text.indexOf(receipt.quote);
  if(at<0) return result("missing",null);
  if(doc.text.indexOf(receipt.quote,at+1)>=0) return result("ambiguous",null);
  return result(at===receipt.start?"same_position":"relocated",at);
}
export type PassageCheck = ReturnType<typeof recheckPassage>;

export async function researchPublications(input: ResearchInput, read: ResearchReader, catalogue: readonly RegulatorySource[] = REGULATORY_SOURCES) {
  const {sources,nations,anchors} = researchCandidates(input, catalogue);
  const loaded = await Promise.all(sources.map(async source => {
    try {
      const data = await read(source);
      if (data.id !== source.id || data.url !== officialSourceUrl(source) || data.text.length < 80 ||
          data.text.length > 60000 || !Number.isFinite(Date.parse(data.checkedAt))) return null;
      return {source, data, digest:researchHash(data.text)};
    } catch { return null; }
  }));
  const candidates = loaded.flatMap(row => row ? passages(row.data.text).map(span => ({...span,row})) : []);
  const query = [...new Set(terms(input.question))].slice(0,64);
  const tokens = candidates.map(span => terms(span.quote));
  const scores = bm25Scores(query, tokens);
  // Publisher names help route a question. Alone they are insufficient evidence in a passage.
  const publishers = new Set(sources.flatMap(source => terms(source.agency)));
  const substantive = query.filter(term => !publishers.has(term));
  const ranked = candidates.map((span,i) => {
    const mentioned = nations.length ? mentionedNations(span.quote) : [];
    const local = mentioned.some(nation=>nations.includes(nation));
    const applicable = !nations.length || !mentioned.length || local;
    const matches=substantive.filter(term=>tokens[i].includes(term));
    const localTopic=localSource(span.row.source,nations) && matches.filter(term=>!generalTerms.has(term)).length>=2;
    return {...span, score:applicable?scores[i]*(local?1.5:1)*(localTopic?1.5:1):0, matches:matches.length,
      anchored:localTopic || !anchors.length || anchors.some(term=>tokens[i].includes(term))};
  })
    .filter(span => span.score > 0 && span.anchored && span.matches >= Math.min(2, Math.max(1,substantive.length)))
    .sort((a,b) => b.score-a.score || a.row.source.id.localeCompare(b.row.source.id) || a.start-b.start);
  // Represent each matched publication before including a second excerpt from any one publication.
  const perSource = new Map<string, typeof ranked>();
  for (const hit of ranked) {
    const list = perSource.get(hit.row.source.id) || [];
    if (list.length < 2) list.push(hit);
    perSource.set(hit.row.source.id,list);
  }
  const groups = [...perSource.values()];
  const selected = [...groups.map(list=>list[0]), ...groups.flatMap(list=>list.slice(1))].slice(0,RESEARCH_LIMITS.passages);
  const citations: ResearchPassage[] = selected.map(({start,end,quote,row}) => ({
    id:passageId(row.source.id,row.digest,start,end,quote), sourceId:row.source.id,
    title:row.data.title, agency:row.source.agency, url:row.data.url, checkedAt:row.data.checkedAt,
    revisionAt:row.data.revisionAt || row.data.updatedAt, documentHash:row.digest, start,end,quote,
    jurisdictions:row.source.jurisdictions || [],
  }));
  const checked = sources.map((source,i) => ({id:source.id,title:source.title,url:officialSourceUrl(source),
    status: !loaded[i] ? "unavailable" as const : perSource.has(source.id) ? "matched" as const : "no_passage" as const}));
  const unavailable = checked.filter(row=>row.status==="unavailable").length;
  const status = citations.length ? "matched" as const : unavailable ? "incomplete" as const : "no_match" as const;
  return {status, catalogueSize:catalogue.length, nations, checked, unavailable, citations};
}
