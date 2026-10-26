import { NextResponse } from "next/server";
import { REGULATORY_SOURCES, normaliseContent } from "../../../lib/regulatory-sources.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const results = await Promise.all(REGULATORY_SOURCES.map(async source => {
    try {
      const response = await fetch("https://www.gov.uk/api/content"+source.path, {
        headers: { Accept:"application/json" },
        signal:AbortSignal.timeout(8000),
        next:{revalidate:3600}
      });
      if (!response.ok) throw new Error("Source unavailable");
      return normaliseContent(source,await response.json());
    } catch {
      return {id:source.id,agency:source.agency,topic:source.topic,title:source.title,url:"https://www.gov.uk"+source.path,updatedAt:null,firstPublishedAt:null,description:"",status:"unavailable"};
    }
  }));
  return NextResponse.json({source:"GOV.UK public Content API",checkedAt:new Date().toISOString(),disclaimer:"Source metadata only; not proof of a regulatory change or compliance.",results},{headers:{"Cache-Control":"public, s-maxage=900, stale-while-revalidate=3600"}});
}
