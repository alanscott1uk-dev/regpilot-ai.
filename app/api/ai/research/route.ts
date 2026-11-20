import {z} from "zod";
import {JURISDICTIONS} from "../../../../lib/regulatory/intelligence";
import {MIN_RESEARCH_QUESTION,MAX_RESEARCH_QUESTION} from "../../../../lib/regulatory/publication-query.mjs";
import {searchOfficialPublications} from "../../../../lib/server/publication-research";
import {failure, readBody, reply} from "../../../../lib/server/intelligence-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const inputSchema = z.object({
  question:z.string().trim().min(MIN_RESEARCH_QUESTION).max(MAX_RESEARCH_QUESTION),
  nation:z.enum(JURISDICTIONS).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await readBody(request,8192));
    if (!input.success) return reply({error:"Enter a topic or question of 3 to 1,500 characters and choose a UK nation if needed."},400);
    return reply(await searchOfficialPublications(input.data));
  } catch (error) { return failure(error); }
}
