import {medicineAlertRouting} from '../../../../lib/server/deployed-medicine-alert-routing';
import {reply} from '../../../../lib/server/intelligence-http';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=120;
export async function GET(){
 try{return reply(await medicineAlertRouting());}
 catch{return reply({error:'The MHRA category comparison is unavailable.'},503);}
}
