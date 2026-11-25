import {deployedDatabaseProof} from '../../../../lib/server/deployed-database-proof';
import {reply} from '../../../../lib/server/intelligence-http';
export const dynamic='force-dynamic',runtime='nodejs';
export async function GET(){try{const proof=await deployedDatabaseProof();return proof?reply(proof):reply({error:'A deployed release is required.'},503);}catch{return reply({error:'The scheduled test receipts are unavailable.'},503);}}
