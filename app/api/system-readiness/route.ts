import { NextResponse } from "next/server";
import { assessBackendReadiness } from "../../../lib/backend-readiness.mjs";
export const dynamic = "force-dynamic";
export async function GET() {
 const result = assessBackendReadiness(process.env);
 return NextResponse.json(result, {
  headers: { "Cache-Control": "no-store" }
 });
}
