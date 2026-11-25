import {CollectionError} from './collection-error';
export const collectionSteps={
 'grafana-org':['Verify the Grafana organisation','Check the selected organisation ID and the service account’s access to that organisation.'],
 dashboard:['Read the monitored dashboard','Check the dashboard UID and grant the service account viewer access to its folder.'],
 record:['Read the configured record','Confirm that the credential can read the selected record in the configured account.'],
 repository:['Identify the repository','Check the repository name and contents-read access.'],
 workflow:['Read the workflow definition','Check the workflow filename and Actions read permission.'],
 branch:['Verify the monitored branch','Check that the branch still exists and can be read.'],
 runs:['Read completed runs','Check the workflow run history and Actions access for the monitored branch.'],
 jobs:['Read the jobs for this attempt','Inspect the recorded run attempt and job visibility in GitHub Actions.'],
 integration:['Find the managed integration','Check the enabled provider configuration in the integration directory.'],
 grant:['Verify the workspace grant','Open the connected account in Company integrations and check its authorisation and workspace.'],
 model:['Read sync status','Check the selected model, last completed sync and reported population.'],
 records:['Read the synced records','Check the configured model and read permission for its records.']
} as const;
export type CollectionStep=keyof typeof collectionSteps;
export function failureStage(value:unknown){
 if(typeof value!=='string'||!Object.hasOwn(collectionSteps,value))return null;
 const [label,guidance]=collectionSteps[value as CollectionStep];return {label,guidance};
}
export async function atStep<T>(step:CollectionStep,fn:()=>Promise<T>):Promise<T>{
 try{return await fn();}catch(error){
  if(error instanceof CollectionError){error.step??=step;throw error;}
  throw new CollectionError('INVALID_RESPONSE',undefined,step);
 }
}
