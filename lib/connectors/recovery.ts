/** Shared recovery guidance. Only known temporary failures permit a bounded retry. */
export function connectorRecovery(code:string|null){
 if(!code)return {retryable:false,message:"No collection error is recorded."};
 if(code==="AWS_TRUST_UNSCOPED")return {retryable:false,message:"The AWS role accepted a session without the correct workspace external ID. Apply the workspace trust conditions, then enable and verify the connection."};
 if(["AWS_WORKLOAD_UNAVAILABLE","AWS_SESSION_INVALID","AWS_ROLE_ACCESS"].includes(code))return {retryable:false,message:"Verify the Vercel workload identity, the AWS broker trust and the customer role template before collecting again."};
 if(code==="REGISTER_RECORD_MISSING")return {retryable:false,message:"Find the supplier on GLEIF using the exact UK company number and confirm its current LEI."};
 if(["PROVIDER_TIMEOUT","PROVIDER_UNAVAILABLE","COLLECTION_UNAVAILABLE","COLLECTION_FAILED","INTERRUPTED_REPEATEDLY","DATABASE_BUSY"].includes(code))
  return {retryable:true,message:"Collection could not finish. An administrator can schedule one recovery attempt using the existing settings."};
 if(["CREDENTIAL_REJECTED","CREDENTIAL_UNAVAILABLE","AUTH_UNAVAILABLE"].includes(code))
  return {retryable:false,message:"Check or replace the provider credential in Manage connection, then save the connection."};
 if(code==="PERMISSION_REVOKED")return {retryable:false,message:"An administrator must review workspace access and control ownership, then save the connection."};
 if(["RATE_LIMITED","PROVIDER_COOLDOWN","PROVIDER_BUSY","PROVIDER_RATE_LIMIT"].includes(code))
  return {retryable:false,message:"The provider is limiting requests. Keep the scheduled retry time; repeated requests will not speed it up."};
 if(code==="ACCESS_OR_RATE_LIMIT")return {retryable:false,message:"The provider reported an access restriction or request limit. Check its permissions and limits before saving the connection again."};
 if(code==="PROVIDER_DISABLED")return {retryable:false,message:"This provider needs to be enabled before collection can resume."};
 return {retryable:false,message:"Review the connection target, permissions and provider response before saving these settings again."};
}
