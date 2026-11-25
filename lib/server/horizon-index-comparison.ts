import {unstable_cache} from 'next/cache';
import {readPublicHorizon} from './horizon-service';
import {assessOfficialIndexes} from '../horizon/official-indexes';

const compare=unstable_cache(async(previewRelease:string)=>{
 const report=await readPublicHorizon();
 if(previewRelease&&report.codeCommit!==previewRelease)throw Error('The collected snapshot belongs to another release.');
 return assessOfficialIndexes(report);
},['official-publication-index-comparison-v2'],{revalidate:300});
export function publicIndexComparison(){
 return compare(process.env.VERCEL_ENV==='preview'?(process.env.VERCEL_GIT_COMMIT_SHA??''):'');
}
