import {REGULATORY_SOURCES} from "../regulatory-sources.mjs";

export const MIN_RESEARCH_QUESTION = 3;
export const MAX_RESEARCH_QUESTION = 1500;
export function publicationResearchHref(question) {
  return "/ai#source-research?" + new URLSearchParams({q:question.trim().slice(0,MAX_RESEARCH_QUESTION)});
}

// Correct a stuck key only if its spelling identifies a single catalogue word.
const spellings = new Map();
const vocabulary = new Set(REGULATORY_SOURCES.flatMap(source =>
  (source.title + " " + source.topic).toLowerCase().match(/[a-z]+/g) || []));
const withoutRepeats = word => word.replace(/([a-z])\1+/g, "$1");
for (const word of vocabulary) {
  const key = withoutRepeats(word);
  spellings.set(key, spellings.has(key) ? null : word);
}

/** Search keys only. Citation text and offsets always refer to the original. */
export function normalisePublicationText(text) {
  return text.toLowerCase().replace(/[a-z]+/g, word =>
    /([a-z])\1{2}/.test(word) && !vocabulary.has(word) ? spellings.get(withoutRepeats(word)) || word : word)
    .replace(/\bstandard[\s-]+operating[\s-]+procedures?\b/g, "sop")
    .replace(/\bs\.?o\.?p(?:\.?s)?\b\.?/g, "sop")
    .replace(/\b(?:temp|temperature|temprature)[\s-]+map{1,2}ing\b/g, "temperature mapping");
}

export function matchesPublicationText(text, query) {
  return text.toLowerCase().includes(query.trim().toLowerCase()) ||
    normalisePublicationText(text).includes(normalisePublicationText(query.trim()));
}
