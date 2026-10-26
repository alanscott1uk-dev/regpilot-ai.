import { NextResponse } from "next/server";
import { healthPayload } from "../../../lib/server/health";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(healthPayload(), { headers: { "Cache-Control": "no-store" } });
}
