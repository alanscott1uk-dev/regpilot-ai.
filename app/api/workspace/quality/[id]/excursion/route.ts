import {context,fail,readBody,reply,validId} from '../../../../../../lib/server/operations-http';
import {verifiedDownloadResponse} from '../../../../../../lib/server/verified-download';
import {excursionWorkspace,excursionCommand,excursionArchive} from '../../../../../../lib/server/excursion-pilot';
export const runtime='nodejs',dynamic='force-dynamic';
type Args={params:Promise<{id:string}>};
export async function GET(r:Request,{params}:Args){try{
 const c=await context(r,new URL(r.url).searchParams.get('organizationId'));
 return reply(await excursionWorkspace(c,validId((await params).id)));
}catch(e){return fail(e);}}
export async function POST(r:Request,{params}:Args){try{
 const c=await context(r,new URL(r.url).searchParams.get('organizationId'));
 const id=validId((await params).id),body=await readBody(r,16000);
 if(new URL(r.url).searchParams.get('format')==='zip')return await verifiedDownloadResponse(()=>excursionArchive(c,id,body),{filename:'excursion-'+id+'.zip',contentType:'application/zip',signal:r.signal});
 return reply(await excursionCommand(c,id,body));
}catch(e){return fail(e);}}
