import {AssumeRoleCommand,AssumeRoleWithWebIdentityCommand,GetCallerIdentityCommand,STSClient,type Credentials,type STSClientConfig} from "@aws-sdk/client-sts";
import {CloudTrailClient,DescribeTrailsCommand,GetEventSelectorsCommand,GetTrailStatusCommand} from "@aws-sdk/client-cloudtrail";
import {S3ControlClient,GetPublicAccessBlockCommand} from "@aws-sdk/client-s3-control";
import {getVercelOidcToken} from "@vercel/oidc";
import {awsBinding,awsTarget,brokerRole} from "./aws-target";
import {awsPosture} from "./aws-posture";
import {CollectionError} from "./collection-error";

export type AwsRuntime={signal?:AbortSignal;token?:()=>Promise<string>;requestHandler?:STSClientConfig["requestHandler"]};
const denied=new Set(["AccessDenied","AccessDeniedException","InsufficientPermissionsException","InsufficientIAMPolicyException"]);
function code(e:unknown){return e instanceof Error?e.name:"";}
function temporary(c:Credentials|undefined){
  if(!c?.AccessKeyId||!c.SecretAccessKey||!c.SessionToken||!c.Expiration||!(c.Expiration.getTime()>Date.now()+30000))throw new CollectionError("AWS_SESSION_INVALID");
  return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration};
}
async function optional<T>(read:()=>Promise<T>,missingTrail=false):Promise<T|null>{
  try{return await read();}
  catch(e){if(denied.has(code(e))||(missingTrail&&code(e)==="TrailNotFoundException"))return null;throw e;}
}

/** The web identity only obtains the broker session. Every evidence read signs with the customer session. */
export async function withAwsAccount<T>(input:{accountId:string;region:string},organizationId:string,runtime:AwsRuntime,read:(options:{region:string;maxAttempts:number;ignoreConfiguredEndpointUrls:boolean;requestHandler?:AwsRuntime["requestHandler"];credentials:ReturnType<typeof temporary>},signal:AbortSignal)=>Promise<T>){
  const target=awsTarget.parse(input),binding=awsBinding(organizationId);
  const broker=brokerRole.safeParse(process.env.REGPILOT_AWS_BROKER_ROLE_ARN);
  if(!broker.success)throw new CollectionError("AWS_WORKLOAD_UNAVAILABLE");
  const opts={region:target.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,requestHandler:runtime.requestHandler};
  const signal=runtime.signal??AbortSignal.timeout(25000),sendOptions={abortSignal:signal};
  signal.throwIfAborted();
  const clients:Array<{destroy():void}>=[];
  function own<T extends {destroy():void}>(client:T){clients.push(client);return client;}
  try{
    const token=await new Promise<string>((resolve,reject)=>{
      const expired=()=>reject(new CollectionError("PROVIDER_TIMEOUT"));
      signal.addEventListener("abort",expired,{once:true});
      Promise.resolve().then(()=>(runtime.token??getVercelOidcToken)()).then(resolve,()=>reject(new CollectionError("AWS_WORKLOAD_UNAVAILABLE")))
        .finally(()=>signal.removeEventListener("abort",expired));
    });
    signal.throwIfAborted();
    const issuer=own(new STSClient(opts));
    const brokerSession=await issuer.send(new AssumeRoleWithWebIdentityCommand({RoleArn:broker.data,RoleSessionName:"regpilot-broker",DurationSeconds:900,WebIdentityToken:token}),sendOptions);
    const bridge=own(new STSClient({...opts,credentials:temporary(brokerSession.Credentials)}));
    const roleArn="arn:aws:iam::"+target.accountId+":role/"+binding.roleName;
    const request={RoleArn:roleArn,RoleSessionName:"regpilot-evidence",DurationSeconds:900};
    // AWS recommends verifying that a third-party role rejects both absent and incorrect external IDs.
    for(const externalId of [undefined,"regpilot-check-"+organizationId]){
      try{await bridge.send(new AssumeRoleCommand({...request,ExternalId:externalId}),sendOptions);}
      catch(e){if(denied.has(code(e)))continue;throw e;}
      throw new CollectionError("AWS_TRUST_UNSCOPED");
    }
    const session=await bridge.send(new AssumeRoleCommand({...request,ExternalId:binding.externalId}),sendOptions);
    const credentials=temporary(session.Credentials),options={...opts,credentials};
    const sts=own(new STSClient(options));
    const who=await sts.send(new GetCallerIdentityCommand({}),sendOptions);
    if(who.Account!==target.accountId||who.Arn!=="arn:aws:sts::"+target.accountId+":assumed-role/"+binding.roleName+"/regpilot-evidence")throw new CollectionError("TARGET_MISMATCH");
    return await read(options,signal);
  }catch(e){
    if(e instanceof CollectionError)throw e;
    const reason=code(e);
    if(signal.aborted||["AbortError","TimeoutError"].includes(reason))throw new CollectionError("PROVIDER_TIMEOUT");
    if(["Throttling","ThrottlingException","TooManyRequestsException","SlowDown","RequestLimitExceeded"].includes(reason))throw new CollectionError("RATE_LIMITED",60);
    if(denied.has(reason)||["InvalidIdentityToken","ExpiredToken","ExpiredTokenException","IDPRejectedClaim"].includes(reason))throw new CollectionError("AWS_ROLE_ACCESS");
    throw new CollectionError("PROVIDER_UNAVAILABLE");
  }finally{for(const client of clients)client.destroy();}
}

export async function collectAws(input:{accountId:string;region:string},organizationId:string,runtime:AwsRuntime={}){
  const target=awsTarget.parse(input);
  return withAwsAccount(target,organizationId,runtime,async(options,signal)=>{
    const sendOptions={abortSignal:signal},clients:Array<{destroy():void}>=[];
    function own<T extends {destroy():void}>(client:T){clients.push(client);return client;}
    try{
    const s3=own(new S3ControlClient(options));
    const regionalClients=new Map<string,CloudTrailClient>();
    function trailClient(region:string){
      let client=regionalClients.get(region);
      if(!client){client=own(new CloudTrailClient({...options,region}));regionalClients.set(region,client);}
      return client;
    }
    const selected=trailClient(target.region);
    return await awsPosture(target,{
      publicBlock:()=>optional(async()=>{
        try{
          const out=await s3.send(new GetPublicAccessBlockCommand({AccountId:target.accountId}),sendOptions);
          if(!out.PublicAccessBlockConfiguration)throw new CollectionError("INVALID_RESPONSE");
          return out.PublicAccessBlockConfiguration;
        }catch(e){
          if(code(e)!=="NoSuchPublicAccessBlockConfiguration")throw e;
          return {BlockPublicAcls:false,IgnorePublicAcls:false,BlockPublicPolicy:false,RestrictPublicBuckets:false};
        }
      }),
      trails:()=>optional(async()=>{
        const out=await selected.send(new DescribeTrailsCommand({includeShadowTrails:true}),sendOptions);
        if(!Array.isArray(out.trailList))throw new CollectionError("INVALID_RESPONSE");
        return out.trailList;
      }),
      status:arn=>optional(()=>selected.send(new GetTrailStatusCommand({Name:arn}),sendOptions),true),
      selectors:(arn,home)=>optional(async()=>{
        const out=await trailClient(home).send(new GetEventSelectorsCommand({TrailName:arn}),sendOptions);
        if(out.TrailARN!==arn)throw new CollectionError("TARGET_MISMATCH");
        return {EventSelectors:out.EventSelectors,AdvancedEventSelectors:out.AdvancedEventSelectors};
      },true)
    });
    }finally{for(const client of clients)client.destroy();}
  });
}
