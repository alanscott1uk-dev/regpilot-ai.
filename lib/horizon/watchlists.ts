import {z} from 'zod';
import {itemSchema, PUBLISHERS, rankItem, type HorizonItem} from './model';

const publishers = new Set<string>(PUBLISHERS.map(publisher => publisher.id));
export const horizonTopics = [...new Set(PUBLISHERS.flatMap(publisher => [...publisher.topics]))].sort();
const topics = new Set<string>(horizonTopics);
export const MAX_WATCHLISTS = 20;

const words = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function searchPhrases(search: string) {
  return [...new Set(search.split(',').map(words).filter(Boolean))];
}

export const watchlistFilters = z.object({
  siteView:z.literal('scottish-pharma-wholesale').optional(),
  publisher: z.string().refine(id => id === '' || publishers.has(id)),
  kind: z.union([z.literal(''), itemSchema.shape.kind]),
  topic: z.string().refine(id => id === '' || topics.has(id)),
  phrases: z.array(z.string().trim().min(1).max(80).transform(words).pipe(z.string().min(1).max(80))).max(8)
    .transform(values => [...new Set(values)]),
  updatedWithin: z.enum(['window', 'day', 'week']).default('window'),
  changedOnly: z.boolean(),
  onlyOpen: z.boolean(),
}).strict();

export type HorizonFilters = z.infer<typeof watchlistFilters>;
export type HorizonWatch = {id: string; name: string; version: number; filters: HorizonFilters; archived: boolean};

export function sameHorizonFilters(a: HorizonFilters, b: HorizonFilters) {
  return a.siteView === b.siteView && a.publisher === b.publisher && a.kind === b.kind && a.topic === b.topic &&
    a.updatedWithin === b.updatedWithin && a.changedOnly === b.changedOnly && a.onlyOpen === b.onlyOpen &&
    a.phrases.length === b.phrases.length && a.phrases.every((phrase,index)=>phrase===b.phrases[index]);
}

const edit = {id: z.uuid(), version: z.number().int().min(0).max(2_000_000_000)};
export const watchlistMutation = z.discriminatedUnion('action', [
  z.object({...edit, action: z.literal('save'), name: z.string().trim().min(2).max(80), filters: watchlistFilters}).strict(),
  z.object({...edit, action: z.literal('archive'), version: z.number().int().positive()}).strict(),
]);
export type WatchlistMutation = z.infer<typeof watchlistMutation>;

// Match whole words within one metadata field so short terms such as GMP stay precise.
export function matchingPhrase(item: HorizonItem, phrases: string[]) {
  const title = ' ' + words(item.title) + ' ';
  const summary = ' ' + words(item.summary) + ' ';
  return phrases.find(phrase => title.includes(' '+phrase+' ') || summary.includes(' '+phrase+' '));
}

const medicinesTerms=['medicine','medicines','pharmaceutical','pharmaceuticals','controlled drug','controlled drugs','misuse of drugs','good distribution practice','wholesale dealer','wholesale dealers','cold chain','pharmacy','pharmacies'];
export function scottishPharmaReason(item:HorizonItem){
 if(item.publisherIds.includes('mhra')&&item.kind==='Safety alert')return 'MHRA safety alert';
 if(!item.publisherIds.some(id=>['mhra','home-office','dhsc','ukhsa','hse','uksi','ssi'].includes(id)))return null;
 const phrase=matchingPhrase(item,medicinesTerms);
 return phrase?'Matched “'+phrase+'” in a selected official source':null;
}
export function matchesHorizonView(item: HorizonItem, filters: HorizonFilters, generatedAt: string, hasDecision: boolean) {
  if(filters.siteView&&!scottishPharmaReason(item))return false;
  if (filters.publisher && !item.publisherIds.includes(filters.publisher)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.topic && !rankItem(item, [filters.topic]).suggested) return false;
  if (filters.onlyOpen && hasDecision) return false;
  if (filters.updatedWithin !== 'window') {
    const days = filters.updatedWithin === 'day' ? 1 : 7;
    if (Date.parse(item.updatedAt) < Date.parse(generatedAt) - days * 86400000) return false;
  }
  if (filters.changedOnly && (item.observedAt !== generatedAt ||
    (item.discovery !== 'FIRST_SEEN' && item.discovery !== 'METADATA_UPDATED'))) return false;
  return !filters.phrases.length || Boolean(matchingPhrase(item, filters.phrases));
}

export const emptyHorizonView: HorizonFilters = {
  publisher:'', kind:'', topic:'', phrases:[], updatedWithin:'window', changedOnly:false, onlyOpen:false,
};
