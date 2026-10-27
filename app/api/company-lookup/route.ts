import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COMPANY_NUMBER = /^(?:[A-Z]{2}\d{6}|\d{8})$/;
const CH_API = "https://api.company-information.service.gov.uk";

export async function GET(request: NextRequest) {
  const companyNumber = request.nextUrl.searchParams.get("number")?.trim().toUpperCase() ?? "";
  if (!COMPANY_NUMBER.test(companyNumber)) {
    return NextResponse.json({ error: "Enter a valid UK company number." }, { status: 400 });
  }

  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Company lookup is not configured." }, { status: 503 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(`${CH_API}/company/${encodeURIComponent(companyNumber)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`, Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 404) return NextResponse.json({ error: "Company not found." }, { status: 404 });
    if (response.status === 429) return NextResponse.json({ error: "Company lookup is busy. Try again shortly." }, { status: 503 });
    if (!response.ok) return NextResponse.json({ error: "Company lookup temporarily unavailable." }, { status: 502 });
    const company = await response.json();
    return NextResponse.json({
      companyNumber: company.company_number,
      companyName: company.company_name,
      status: company.company_status,
      type: company.type,
      sicCodes: company.sic_codes ?? [],
      incorporatedOn: company.date_of_creation ?? null,
      accountsDue: company.accounts?.next_accounts?.due_on ?? null,
      accountsOverdue: company.accounts?.next_accounts?.overdue ?? false,
      confirmationDue: company.confirmation_statement?.next_due ?? null,
      confirmationOverdue: company.confirmation_statement?.overdue ?? false,
      source: "Companies House",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Company lookup timed out or is unavailable." }, { status: 502 });
  }
}
