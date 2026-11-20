import {context,fail,reply} from "../../../../../lib/server/operations-http";
import {IntelligenceError} from "../../../../../lib/server/intelligence-service";
import {gleifEnabled} from "../../../../../lib/server/connector-flags";
import {findGleifCompany} from "../../../../../lib/connectors/gleif";
import {CollectionError} from "../../../../../lib/connectors/collection-error";

export const runtime="nodejs";
export async function GET(request:Request){
  try{
    const params=new URL(request.url).searchParams;
    await context(request,params.get("organizationId"),true);
    if(!gleifEnabled())throw new IntelligenceError("GLEIF monitoring awaits activation",503);
    return reply(await findGleifCompany((params.get("companyNumber")??"").trim().toUpperCase()));
  }catch(error){
    if(error instanceof CollectionError)return reply({error:"GLEIF could not complete the company lookup. Try again later."},error.code==="RATE_LIMITED"?429:503);
    return fail(error);
  }
}
