import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function awsGleifJourney({review,app,org,db,passed,checkpoint}){
  await checkpoint('AWS and GLEIF setup for a UK workspace');
  const control=await db.managedControl.findFirstOrThrow({where:{organizationId:org.id,enabled:true},select:{id:true}});
  await review.goto(app+'/team/operations?'+new URLSearchParams({organizationId:org.id,view:'connections'}));
  const form=review.locator('form').filter({has:review.getByRole('button',{name:'Save connection',exact:true})});
  await form.getByRole('combobox',{name:'System',exact:true}).selectOption('AWS');
  await form.getByLabel('AWS account ID').fill('222222222222');
  assert.equal(await form.getByRole('combobox',{name:'AWS region',exact:true}).inputValue(),'eu-west-2');
  await form.getByRole('combobox',{name:'Responsible control',exact:true}).selectOption(control.id);
  const download=review.waitForEvent('download');
  await form.getByRole('button',{name:'Download AWS role template'}).click();
  const role=JSON.parse(await readFile(await (await download).path(),'utf8')).Resources.EvidenceRole.Properties;
  assert.equal(role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['sts:ExternalId'],'regpilot-'+org.id);
  assert.equal(role.Policies[0].PolicyDocument.Statement[0].Action.length,4);
  await form.getByLabel('I authorise read-only evidence collection for this AWS account.').check();
  await form.getByRole('button',{name:'Save connection',exact:true}).click();
  await review.getByRole('heading',{name:'AWS · 222222222222 · eu-west-2',exact:true}).waitFor();
  await form.getByRole('combobox',{name:'System',exact:true}).selectOption('GLEIF');
  await form.getByLabel('Companies House number').fill('SC045551');
  await form.getByLabel('Legal entity identifier (LEI)').fill('2138005O9XJIJN4JPN90');
  await form.getByRole('combobox',{name:'Responsible control',exact:true}).selectOption(control.id);
  await form.getByLabel('I authorise monitoring this supplier’s public LEI record.').check();
  await form.getByRole('button',{name:'Save connection',exact:true}).click();
  await review.getByRole('heading',{name:'GLEIF · SC045551 · 2138005O9XJIJN4JPN90',exact:true}).waitFor();
  const stored=await db.evidenceConnector.findMany({where:{organizationId:org.id,provider:{in:['AWS','GLEIF']}},select:{provider:true,encryptedSecret:true,enabled:true}});
  assert.equal(stored.length,2);assert.ok(stored.every(c=>c.encryptedSecret===null&&!c.enabled));
  passed('An owner downloaded the workspace-bound AWS role template and configured UK supplier identity monitoring through Operations.');
  return {providers:stored.map(c=>c.provider).sort(),storedCredentials:0};
}
