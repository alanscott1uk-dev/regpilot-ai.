import {context,reply,fail,readBody} from '../../../../../lib/server/operations-http';
import {setEvidenceApplicability} from '../../../../../lib/server/product-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function PATCH(request:Request){try{const p=new URL(request.url).searchParams;if(p.getAll('organizationId').length!==1)return reply({error:'Choose one company'},400);return reply(await setEvidenceApplicability(await context(request,p.get('organizationId'),true),await readBody(request,12000)));}catch(error){return fail(error);}}
