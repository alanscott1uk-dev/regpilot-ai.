import {z} from "zod";
import {JURISDICTIONS} from "../../../../lib/regulatory/intelligence";
import {RESEARCH_LIMITS} from "../../../../lib/regulatory/research";
import {searchOfficialPublications} from "../../../../lib/server/publication-research";
import {failure, readBody, reply} from "../../../../lib/server/intelligence-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const inputSchema = z.object({
  question:z.string().trim().min(8).max(RESEARCH_LIMITS.question),
  nation:z.enum(JURISDICTIONS).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await readBody(request,8192));
    if (!input.success) return reply({error:"Enter a question of 8 to 1,500 characters and choose a UK nation if needed."},400);
    return reply(await searchOfficialPublications(input.data));
  } catch (error) { return failure(error); }
}
