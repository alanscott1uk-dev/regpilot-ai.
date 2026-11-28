import {z} from 'zod';

export const githubTrialTrack='github_receipt_review';
export const pilotReceipt=z.object({
 id:z.uuid(),checkedAt:z.iso.datetime(),revision:z.string().regex(/^[a-f0-9]{40}$/).nullable(),
 action:z.literal('list-repositories'),count:z.number().int().nonnegative(),
 digest:z.string().regex(/^[a-f0-9]{64}$/),providerHealth:z.boolean().nullable(),
 checks:z.array(z.object({id:z.string(),label:z.string(),status:z.enum(['PASS','FAIL','UNKNOWN'])})).max(5)
});
export type PilotReceipt=z.infer<typeof pilotReceipt>;
export type PilotWindow='previous_day'|'today';

export function settingGuidance(id:string,status:string){
 if(status==='FAIL')return 'Review the reported configuration in GitHub and check the next scheduled reading.';
 if(status==='PASS')return 'The repository data satisfied this check at collection time.';
 if(id==='repository_branch_delete_on_merge_enabled')return 'The read did not expose a usable branch-deletion setting. Check the repository’s pull request settings.';
 if(id.includes('secret_scanning'))return 'The read did not expose this security setting. Check code security in GitHub with an authorised repository administrator.';
 return 'The read contained insufficient repository data for this check. Review the source in GitHub.';
}
