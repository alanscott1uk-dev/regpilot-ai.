import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "regpilot-ai", mode: "prototype" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
