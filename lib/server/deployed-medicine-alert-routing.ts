import {unstable_cache} from 'next/cache';
import {compareMedicineAlertRouting} from '../horizon/medicine-alert-routing';
import {readPublicHorizon} from './horizon-service';

const compare=unstable_cache(async(revision:string)=>{
 const report=await readPublicHorizon();
 if(revision&&report.codeCommit!==revision)throw Error('The regulatory snapshot changed release.');
 return compareMedicineAlertRouting(report);
},['medicines-only-publisher-comparison-v1'],{revalidate:300});
export function medicineAlertRouting(){
 return compare(process.env.VERCEL_ENV==='preview'?(process.env.VERCEL_GIT_COMMIT_SHA??''):'');
}
