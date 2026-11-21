const stopWords = new Set("the a an and or is are was were do does did how what which who when where why for to of in on at by with from that this these those our your their it its be been as can could would should we you they have has had please describe explain".split(" "));

export function searchTerms(text: string): string[] {
  return (text.toLocaleLowerCase("en-GB").match(/[\p{L}\p{N}]+/gu) || [])
    .filter(term => term.length > 1 && !stopWords.has(term));
}

/** BM25 with k1 = 1.2 and b = 0.75. Scores are comparable within one corpus and query. */
export function bm25Scores(query: string[], documents: string[][]): number[] {
  const wanted = new Set(query);
  const frequencies = new Map<string, number>();
  const averageLength = documents.reduce((sum, row) => sum + row.length, 0) / Math.max(1, documents.length);
  const counts = documents.map(row => {
    const counts = new Map<string, number>();
    for (const term of row) {
      if (wanted.has(term)) counts.set(term, (counts.get(term) || 0) + 1);
    }
    for (const term of counts.keys()) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    return counts;
  });
  return counts.map((row, index) => {
    let score = 0;
    const norm = 1.2 * (0.25 + 0.75 * documents[index].length / Math.max(1, averageLength));
    for (const term of wanted) {
      const count = row.get(term);
      if (!count) continue;
      const frequency = frequencies.get(term)!;
      const idf = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
      score += idf * (count * 2.2) / (count + norm);
    }
    return score;
  });
}
