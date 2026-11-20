import {z} from "zod";

export const awsRegions={"eu-west-2":"London","eu-west-1":"Ireland","eu-central-1":"Frankfurt","eu-west-3":"Paris","us-east-1":"N. Virginia","us-west-2":"Oregon"} as const;
export const awsRegion=z.enum(["eu-west-2","eu-west-1","eu-central-1","eu-west-3","us-east-1","us-west-2"]);
export const awsTarget=z.object({accountId:z.string().regex(/^\d{12}$/),region:awsRegion});
export const awsOrganizationId=z.string().regex(/^o-[a-z0-9]{10,32}$/);
export const awsOrganizationTarget=awsTarget.extend({awsOrganizationId});
export type AwsOrganizationTarget=z.infer<typeof awsOrganizationTarget>;
export type AwsTarget=z.infer<typeof awsTarget>;
export const brokerRole=z.string().regex(/^arn:aws:iam::\d{12}:role\/(?:[\w+=,.@-]+\/)*[\w+=,.@-]{1,64}$/).max(512);
export function awsBinding(orgId:string){
  const id=z.uuid().parse(orgId).toLowerCase();
  return {roleName:"RegPilotEvidence-"+id.replaceAll("-",""),externalId:"regpilot-"+id};
}
export function awsRoleTemplate(orgId:string,principal:string,inventory=false){
  const {roleName,externalId}=awsBinding(orgId);
  return {AWSTemplateFormatVersion:"2010-09-09",Description:"Allow the named RegPilot broker to read S3 and CloudTrail evidence for this workspace.",Resources:{
    EvidenceRole:{Type:"AWS::IAM::Role",Properties:{RoleName:roleName,AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[
      {Effect:"Allow",Principal:{AWS:brokerRole.parse(principal)},Action:"sts:AssumeRole",Condition:{StringEquals:{"sts:ExternalId":externalId}}}]},
      Policies:[{PolicyName:"RegPilotEvidenceRead",PolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Resource:"*",Action:[
        "s3:GetAccountPublicAccessBlock","cloudtrail:DescribeTrails","cloudtrail:GetTrailStatus","cloudtrail:GetEventSelectors",...(inventory?["organizations:DescribeOrganization","organizations:ListAccounts"]:[])]}]}}]}}
  }};
}
