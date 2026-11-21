import {createHash} from "node:crypto";
import {bm25Scores, searchTerms} from "../retrieval/bm25";
import {officialSourceUrl, REGULATORY_SOURCES, type RegulatorySource} from "../regulatory-sources.mjs";
import {JURISDICTIONS} from "./intelligence";
import {normalisePublicationText} from "./publication-query.mjs";
import {semanticPublicationSearch, type PublicationSemantics} from "../retrieval/publication-embeddings";

export type Nation = typeof JURISDICTIONS[number];
export const RESEARCH_LIMITS = {sources: 3, passages: 5, passageLength: 480} as const;
export type ResearchInput = {question: string; nation?: Nation};
export type ResearchDocument = {
  id: string; title: string; url: string; text: string;
  updatedAt: string | null; revisionAt: string | null; checkedAt: string;
};
export type ResearchReader = (source: RegulatorySource) => Promise<ResearchDocument>;
export type ResearchPassage = {
  id: string; sourceId: string; title: string; agency: string; url: string;
  checkedAt: string; revisionAt: string | null; documentHash: string;
  start: number; end: number; quote: string; jurisdictions: string[]; kind?: string; scopeNote?: string;
};
export type ResearchResult = Awaited<ReturnType<typeof researchPublications>>;

const noise = new Set(("uk gb great britain business businesses need find guide guides guidance rules requirements " +
  "about relevant official source sources publication publications published apply applies would tell know relating information " +
  "follow subject british england english scotland scottish wales welsh northern ireland irish").split(" "));
const aliases: [RegExp, string][] = [
  [/\b(?:stockrooms?|storerooms?)\b/gi, " storage room "],
  [/\b(?:thermometers?|(?:temperature|monitoring) (?:probes?|sensors?))\b/gi, " temperature sensor "],
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
  let searchable = normalisePublicationText(text);
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

function researchNationScope(input:ResearchInput){
  const mentioned=mentionedNations(input.question);
  const nations=input.nation?[input.nation]:mentioned;
  const scopeQuestion=input.nation&&mentioned.length&&!mentioned.includes(input.nation)
    ?"Your question mentions "+mentioned.join(", ")+" and your selected nation is "+input.nation+". Which territory should the sources cover?"
    :undefined;
  return {nations,scopeQuestion};
}

function localSource(source:RegulatorySource, nations:readonly Nation[]) {
  return source.jurisdictions?.length===1 && nations.some(n=>source.jurisdictions!.includes(n));
}

export function researchCandidates(input: ResearchInput, catalogue: readonly RegulatorySource[] = REGULATORY_SOURCES, semanticScores?:Map<string,number>) {
  const {nations,scopeQuestion}=researchNationScope(input);
  if(scopeQuestion)return {nations,anchors:[] as string[],semanticSources:new Set<string>(),sources:[] as RegulatorySource[]};
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
  const semanticSources=new Set<string>();
  const nearest=eligible.map(source=>({id:source.id,score:semanticScores?.get(source.id)||0})).sort((a,b)=>b.score-a.score);
  if(query.length>=2) for(const hit of nearest) {
    const clearLead=hit===nearest[0] && query.length>=3 && hit.score-(nearest[1]?.score||0)>=0.10;
    if(hit.score>=0.53 || (clearLead && hit.score>=0.47))semanticSources.add(hit.id);
  }
  const ranked = eligible.map((source, i) => {
    const territorial = nations.length && source.jurisdictions?.length && source.jurisdictions.length < 4;
    const localTopic = localSource(source,nations) && query.filter(term=>!generalTerms.has(term)&&titles[i].includes(term)).length>=2;
    const similarity=semanticScores?.get(source.id) || 0;
    const lexical=(scores[i] + byPublisher[i]*0.4)*(localTopic ? 2 : territorial ? 1.4 : 1);
    // A paraphrase can earn a publisher read on its own only at a strong model match.
    // Passages must independently support that match below.
    const semanticMatch=semanticSources.has(source.id);
    const score=lexical*(1+Math.max(0,similarity))+(semanticMatch ? 3*similarity : 0);
    return {source, score, localTopic, anchored:semanticMatch || localTopic || !anchors.length || anchors.some(term=>titles[i].includes(term))};
  }).filter(row => row.score > 0 && row.anchored).sort((a,b) => b.score-a.score || a.source.id.localeCompare(b.source.id));
  return {nations, anchors, semanticSources, sources: ranked.filter(row=>row.localTopic || row.score>=ranked[0].score*0.25)
    .slice(0, RESEARCH_LIMITS.sources).map(row => row.source)};
}

const segmenter = new Intl.Segmenter("en-GB", {granularity: "sentence"});
/** Boundaries are UTF-16 offsets in the exact text returned by the verified extractor. */
function passages(text: string, nations: readonly Nation[]) {
  const spans: {start:number; end:number; quote:string}[] = [];
  let start = -1, end = 0, applicable = true;
  function flush() {
    if (start >= 0) {
      while (start < end && /\s/u.test(text[start])) start++;
      while (end > start && /\s/u.test(text[end-1])) end--;
      if (end-start >= 12) spans.push({start,end,quote:text.slice(start,end)});
    }
    start = -1;
  }
  for (const part of segmenter.segment(text)) {
    if (nations.length) {
      // Unlabelled follow-on sentences inherit the last explicit territorial scope.
      // Keep foreign sections outside both evidence receipts and extracted answers.
      const named = mentionedNations(part.segment);
      if (named.length) applicable = named.some(nation=>nations.includes(nation));
      else if (/\b(?:UK-wide|across the (?:UK|United Kingdom)|throughout the (?:UK|United Kingdom))\b/i.test(part.segment)) applicable = true;
      if (!applicable) { flush(); continue; }
    }
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

type AnswerPoint = {citationId:string; sourceId:string; text:string; start:number; end:number};
type AnswerReference=Pick<ResearchPassage,"id"|"sourceId"|"start"|"end">;

const detailNoise=new Set("how much many long often frequently what which when cost costs price prices fee fees charge charges expensive budget pay frequency interval deadline period day days week weeks month months year years firm company example writing".split(" "));
const numberWords="one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand a an".split(" ").join("|");
const duration=new RegExp("\\b(?:\\d+(?:[.,]\\d+)?|"+numberWords+") (?:working |business |calendar )?(?:minutes?|hours?|days?|weeks?|months?|years?)\\b","i");
const calendarDate=/\b(?:\d{4}-\d{2}-\d{2}|(?:[0-3]?\d(?:st|nd|rd|th)? )?(?:January|February|March|April|May|June|July|August|September|October|November|December) (?:\d{4}|[0-3]?\d))\b/i;
const namedDay=/\b[0-3]?\d(?:st|nd|rd|th)? (?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const schedule=/\b(?:daily|weekly|monthly|quarterly|annually|yearly|fortnightly|immediately|without (?:undue )?delay|(?:once|twice) (?:a|per)|(?:every|each|per) (?:day|week|month|quarter|year)|(?:before|after|whenever|until) \S+|(?:no|without a) (?:fixed|set|prescribed) (?:period|interval|frequency|deadline))\b/i;
function hasTiming(text:string){return duration.test(text) || schedule.test(text) || calendarDate.test(text) || namedDay.test(text);}

/** Pick complete sentences from the original publication, never from text
 * truncated at a passage boundary. Every answer point must fit one receipt. */
async function extractAnswer(question:string, citations:AnswerReference[], docs:ResearchDocument[], semantics:PublicationSemantics|null) {
  const points:AnswerPoint[]=[];
  const model=semantics?"potion-base-8M":null;
  if(!semantics || !citations.length) return {model,points};
  const options:AnswerPoint[]=[];
  const asksPrice=/\b(costs?|prices?|fees?|expensive|budget|how much.*(?:pay|charge))\b/i.test(question);
  const asksTiming=/\b(?:how (?:often|frequently|long)|how many (?:days|weeks|months|years)|what (?:frequency|interval|deadline)|by when)\b/i.test(question);
  const detailQuestion=asksPrice || asksTiming;
  const subject=detailQuestion ? terms(question).filter(t=>!detailNoise.has(t) && !generalTerms.has(t)) : [];
  for (const doc of docs) {
    const references=citations.filter(c=>c.sourceId===doc.id);
    if(!references.length) continue;
    let previous:{start:number;end:number}|undefined;
    for(const part of segmenter.segment(doc.text)) {
      let text=part.segment.trim().replace(/^[“"]\s*/u,"");
      let start=part.index+part.segment.indexOf(text);
      const end=start+text.length, prior=previous;
      previous=/[.!?][”"’)]?$/.test(text)?{start,end}:undefined;
      if(/^(?:they|these|those|it (?!is\b))\b/i.test(text)){
        if(!prior || end-prior.start>420)continue;
        start=prior.start;text=doc.text.slice(start,end);
      }
      if(text.length<40 || text.length>420 || !/[.!?][”"’)]?$/.test(text) || text.endsWith("?")) continue;
      if(/^(?:this (?:[\d-]+minute )?(?:article|video|guidance|document)|it explains|click|read more|find out|see also|for more information)\b/i.test(text)) continue;
      if(asksPrice && !/(?:£\s?\d|\b\d[\d,.]*\s*(?:pounds?|GBP)\b|\bfree of charge\b|\bno (?:fee|charge)\b)/i.test(text)) continue;
      if(asksTiming && !hasTiming(text)) continue;
      if(detailQuestion && subject.length && !terms(text).some(t=>subject.includes(t))) continue;
      const citation=references.find(c=>c.start<=start && c.end>=end);
      if(citation) options.push({citationId:citation.id,sourceId:doc.id,text,start,end});
    }
  }
  const similarities=await semantics.similarity(options.map(o=>o.text));
  const query=[...new Set(terms(question).filter(term=>!generalTerms.has(term)))];
  const rows=options.map((point,i)=>{
    const words=terms(point.text), overlap=query.filter(term=>words.includes(term)).length;
    const relevant=similarities[i]>=0.28 && (overlap>0 || similarities[i]>=0.5);
    const qualified= /\b(?:depends? on|take account of)\b/i.test(point.text);
    const score=similarities[i]+Math.min(0.15,overlap*0.05)+Math.min(0.10,words.length/160)-
      (query.length<=2 && qualified ? 0.12 : 0);
    return {point,relevant,score};
  }).filter(row=>row.relevant).sort((a,b)=>b.score-a.score || a.point.start-b.point.start);
  if(rows.length) {
    points.push(rows[0].point);
    const other=rows.slice(1).filter(row=>row.point.citationId!==points[0].citationId && row.point.text!==points[0].text && row.score>=rows[0].score*0.72);
    const second=other.find(row=>row.point.sourceId!==points[0].sourceId && row.score>=other[0].score-0.06) || other[0];
    if(second)points.push(second.point);
  }
  return {model,points};
}

export async function researchPublications(input: ResearchInput, read: ResearchReader, catalogue: readonly RegulatorySource[] = REGULATORY_SOURCES) {
  const {scopeQuestion}=researchNationScope(input);
  const semantics = scopeQuestion?null:await semanticPublicationSearch(input.question,catalogue).catch(()=>null);
  const {sources,nations,anchors,semanticSources} = researchCandidates(input, catalogue, semantics?.sourceScores);
  const loaded = await Promise.all(sources.map(async source => {
    if(source.refreshMode==="manual")return null;
    try {
      const data = await read(source);
      if (data.id !== source.id || data.url !== officialSourceUrl(source) || data.text.length < 80 ||
          data.text.length > 60000 || !Number.isFinite(Date.parse(data.checkedAt))) return null;
      return {source, data, digest:researchHash(data.text)};
    } catch { return null; }
  }));
  const candidates = loaded.flatMap(row => row ? passages(row.data.text,nations).map(span => ({...span,row})) : []);
  const query = [...new Set(terms(input.question))].slice(0,64);
  const tokens = candidates.map(span => terms(span.quote));
  const scores = bm25Scores(query, tokens);
  const similarities = semantics ? await semantics.similarity(candidates.map(span=>span.quote)) : [];
  // Publisher names help route a question. Alone they are insufficient evidence in a passage.
  const publishers = new Set(sources.flatMap(source => terms(source.agency)));
  const substantive = query.filter(term => !publishers.has(term));
  const ranked = candidates.map((span,i) => {
    const mentioned = nations.length ? mentionedNations(span.quote) : [];
    const local = mentioned.some(nation=>nations.includes(nation));
    const applicable = !nations.length || !mentioned.length || local;
    const matches=substantive.filter(term=>tokens[i].includes(term));
    const localTopic=localSource(span.row.source,nations) && matches.filter(term=>!generalTerms.has(term)).length>=2;
    const similarity=similarities[i] || 0;
    const semanticMatch=substantive.length>=2 && semanticSources.has(span.row.source.id) && similarity>=0.50;
    const lexicalMatch=matches.length>=Math.min(2,Math.max(1,substantive.length)) &&
      (localTopic || !anchors.length || anchors.some(term=>tokens[i].includes(term)));
    const score=(scores[i]+Math.max(0,similarity)*3)*(local?1.5:1)*(localTopic?1.5:1);
    return {...span, score, supported:applicable && (lexicalMatch || semanticMatch)};
  })
    .filter(span => span.score > 0 && span.supported)
    .sort((a,b) => b.score-a.score || a.row.source.id.localeCompare(b.row.source.id) || a.start-b.start);
  // Represent each matched publication before including a second excerpt from any one publication.
  const perSource = new Map<string, typeof ranked>();
  for (const hit of ranked) {
    const list = perSource.get(hit.row.source.id) || [];
    if (list.length < 6) list.push(hit);
    perSource.set(hit.row.source.id,list);
  }
  const groups = [...perSource.values()];
  const references=groups.flat().map(({start,end,quote,row})=>({
    start,end,sourceId:row.source.id,id:passageId(row.source.id,row.digest,start,end,quote),
  }));
  const answer=await extractAnswer(input.question,references,loaded.flatMap(row=>row?[row.data]:[]),semantics);
  const highlighted=new Set(answer.points.map(point=>point.citationId));
  // Keep the answer's supporting receipts, then represent each matching publisher.
  const evidence=groups.flatMap(group=>group.filter(hit=>highlighted.has(passageId(hit.row.source.id,hit.row.digest,hit.start,hit.end,hit.quote))));
  const ordered=[...new Set([...evidence,...groups.map(list=>list[0]),...groups.flatMap(list=>list.slice(1,2))])];
  const counts=new Map<string,number>();
  const selected=ordered.filter(hit=>{
    const id=hit.row.source.id,count=counts.get(id)||0;
    counts.set(id,count+1);return count<2;
  }).slice(0,RESEARCH_LIMITS.passages);
  const citations: ResearchPassage[] = selected.map(({start,end,quote,row}) => ({
    id:passageId(row.source.id,row.digest,start,end,quote), sourceId:row.source.id,
    title:row.data.title, agency:row.source.agency, url:row.data.url, checkedAt:row.data.checkedAt,
    revisionAt:row.data.revisionAt || row.data.updatedAt, documentHash:row.digest, start,end,quote,
    jurisdictions:row.source.jurisdictions || [], kind:row.source.kind, scopeNote:row.source.scopeNote,
  }));
  const supportingSources=[...new Set([
    ...answer.points.map(point=>point.sourceId),
    ...citations.map(passage=>passage.sourceId),
    ...perSource.keys()
  ])];
  const evidenceRank=new Map(supportingSources.map((id,index)=>[id,index]));
  const checked=sources.map((source,index)=>({
    id:source.id,title:source.title,url:officialSourceUrl(source),candidateRank:index+1,
    status:source.refreshMode==="manual"?"manual_refresh" as const:!loaded[index]?"unavailable" as const:perSource.has(source.id)?"matched" as const:"no_passage" as const
  })).sort((a,b)=>
    (evidenceRank.get(a.id)??sources.length)-(evidenceRank.get(b.id)??sources.length) ||
    a.candidateRank-b.candidateRank
  );
  const unavailable = checked.filter(row=>row.status==="unavailable").length;
  const status = citations.length ? "matched" as const : unavailable || checked.some(row=>row.status==="manual_refresh") ? "incomplete" as const : "no_match" as const;
  return {status, catalogueSize:catalogue.length, nations, checked, unavailable, citations, answer,...(scopeQuestion?{scopeQuestion}:{})};
}
