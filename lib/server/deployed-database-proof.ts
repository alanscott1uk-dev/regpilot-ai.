import {unstable_cache} from 'next/cache';
import {databaseScheduleProof} from './database-schedule-proof';
const cached=unstable_cache((revision:string)=>databaseScheduleProof(revision),['database-scheduled-recovery-v1'],{revalidate:60});
export function deployedDatabaseProof(){const sha=process.env.VERCEL_GIT_COMMIT_SHA;return sha&&/^[a-f0-9]{40}$/.test(sha)?cached(sha):Promise.resolve(null);}
