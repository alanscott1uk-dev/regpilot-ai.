import {z} from 'zod';
import {boundedJson} from '../horizon/collector';
import {CollectionError} from '../connectors/collection-error';

const sha=z.string().regex(/^[a-f0-9]{40}$/);
const repo='alanscott1uk-dev/regpilot-ai.';
const paths=z.array(z.object({filename:z.string().min(1).max(800),previous_filename:z.string().min(1).max(800).optional(),status:z.string().max(30)})).max(300);
const coverage:[RegExp,string[]][]=[
 [/logger|calibrat|operational-record|instrument|ubibot|excursion/,['PH-01','PH-03','PH-06']],
 [/retained-validation|validation-archive|release-validation|execute-pharma-validation/,['PH-08']],
 [/stock|reconcil|inventory/,['PH-02']], [/capa|quality|handover/,['PH-02','PH-03','PH-04']],
 [/qualification|trial|validation/,['PH-05','PH-06']], [/effectivity|signature|authoris|authoriz|membership|evidence|prisma\//,['PH-04','PH-05','PH-07']]
];
export async function validationChangeReview(baseline:string,release:string,fetcher:typeof fetch=fetch){
 sha.parse(baseline);sha.parse(release);
 const range=baseline+'...'+release,api='https://api.github.com/repos/'+repo+'/compare/'+range,compareUrl='https://github.com/'+repo+'/compare/'+range;
 const base={baseline,release,compareUrl};
 let raw;
 try{raw=await boundedJson(api+'?per_page=1&page=1',fetcher,4_000_000);}
 catch(e){if(e instanceof CollectionError&&e.code==='RESPONSE_TOO_LARGE')return {...base,state:'REVIEW_ON_GITHUB' as const};throw e;}
 const parsed=z.object({url:z.string(),base_commit:z.object({sha}),merge_base_commit:z.object({sha}),status:z.enum(['identical','ahead','behind','diverged']),ahead_by:z.number().int().nonnegative(),behind_by:z.number().int().nonnegative(),files:paths}).parse(raw);
 if(parsed.url!==api||parsed.base_commit.sha!==baseline)throw new Error('Release comparison identity mismatch.');
 const files=parsed.files.map(f=>({path:f.filename,...(f.previous_filename?{previousPath:f.previous_filename}:{}),status:f.status}));
 const requirementIds=[...new Set(files.flatMap(f=>coverage.flatMap(([pattern,ids])=>pattern.test(f.path)||f.previousPath&&pattern.test(f.previousPath)?ids:[])))].sort();
 const linear=parsed.merge_base_commit.sha===baseline&&['ahead','identical'].includes(parsed.status);
 return {...base,state:!linear?'DIVERGED' as const:files.length===300?'FILE_LIMIT' as const:'COMPARED' as const,ahead:parsed.ahead_by,behind:parsed.behind_by,files,requirementIds,
  scope:'Suggested retests are based on changed paths. Quality reviews the full change and chooses site tests.'};
}
