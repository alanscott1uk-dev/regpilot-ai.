import {db} from './db';
import type {PublicReceipt} from '../connectors/register-benchmark';
export const registerStagingEnabled=()=>process.env.VERCEL_ENV==='preview'&&process.env.REGPILOT_STAGING_PREFLIGHT==='true';
export async function publicRegisterHistory(){
 if(!registerStagingEnabled())return [];
 return db.$queryRaw<PublicReceipt[]>`SELECT batch, started_at, provider, part, url, finished_at, http_status, metadata, fingerprint, intact
 FROM regpilot_verification.public_register_history
 WHERE started_at >= now()-interval '32 days' ORDER BY started_at DESC,provider,part`;
}
