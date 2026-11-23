import { NextRequest, NextResponse } from "next/server";

// This route is deliberately disabled until a verified authentication provider,
// organisation-scoped authorisation and private object storage are configured.
export async function POST(_request: NextRequest) {
 return NextResponse.json(
  { error: "Secure document uploads are not yet enabled. Do not submit confidential records." },
  { status: 503, headers: { "Cache-Control": "no-store" } }
 );
}
export async function GET() {
 return NextResponse.json(
  { error: "Document retrieval requires an authenticated evidence service." },
  { status: 503, headers: { "Cache-Control": "no-store" } }
 );
}
