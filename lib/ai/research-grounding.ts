import type {ResearchPassage} from "../regulatory/research";

export type PassageCitation = Pick<ResearchPassage, "sourceId"|"title"|"url"|"documentHash"|"checkedAt"> & {passageId:string;start:number;end:number};

/** A generated quote must occur literally, once, inside exactly one retrieved passage. */
export function resolveResearchQuote(value: string, passages: ResearchPassage[]): PassageCitation | null {
  const quote = value.trim();
  if (quote.length < 12) return null;
  let resolved: PassageCitation | null = null;
  for (const passage of passages) {
    const offset = passage.quote.indexOf(quote);
    if (offset < 0) continue;
    if (resolved || passage.quote.indexOf(quote,offset+1) >= 0) return null;
    resolved = {sourceId:passage.sourceId,title:passage.title,url:passage.url,documentHash:passage.documentHash,
      checkedAt:passage.checkedAt,passageId:passage.id,start:passage.start+offset,end:passage.start+offset+quote.length};
  }
  return resolved;
}

/** Unattributed prose is never delivered as the answer on the automatic research path. */
export function groundResearchDraft<F extends {sourceQuote:string}, A extends {sourceQuote:string}>(output:{findings:F[];suggestedActions:A[]}, passages:ResearchPassage[]) {
  function keep<T extends {sourceQuote:string}>(rows:T[]) {
    return rows.flatMap(row=>{
      const sourceCitation=resolveResearchQuote(row.sourceQuote,passages);
      return sourceCitation ? [{...row,sourceCitation}] : [];
    });
  }
  const findings=keep(output.findings), suggestedActions=keep(output.suggestedActions);
  const omitted=output.findings.length-findings.length+output.suggestedActions.length-suggestedActions.length;
  const summary=findings.length
    ? `RegPilot found supporting quotations for ${findings.length} draft ${findings.length===1?"finding":"findings"}. Open each publication to assess the interpretation.`
    : "The model supplied no draft finding with a uniquely verifiable quotation. Review the retrieved passages directly.";
  return {summary,findings,suggestedActions,omitted};
}
