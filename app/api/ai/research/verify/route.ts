import {z} from "zod";
import {REGULATORY_SOURCES} from "../../../../../lib/regulatory-sources.mjs";
import {RESEARCH_LIMITS,validPassageReceipt} from "../../../../../lib/regulatory/research";
import {readBody,reply,failure} from "../../../../../lib/server/intelligence-http";
import {verifyOfficialPassage} from "../../../../../lib/server/publication-research";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const receipt=z.object({sourceId:z.string().max(120),id:digest,documentHash:digest,
  start:z.number().int().min(0),end:z.number().int().max(60000),
  quote:z.string().min(12).max(RESEARCH_LIMITS.passageLength)}).strict();

export async function POST(request:Request) {
  try {
    const input=receipt.safeParse(await readBody(request,4096));
    if(!input.success || !validPassageReceipt(input.data) || !REGULATORY_SOURCES.some(s=>s.id===input.data.sourceId))
      return reply({error:"The saved passage reference is invalid."},400);
    try { return reply(await verifyOfficialPassage(input.data)); }
    catch { return reply({error:"The publication could not be checked. Its present wording is unknown."},503); }
  } catch(error) { return failure(error); }
}
