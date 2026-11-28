export const dynamic="force-static";
const text={type:"string"},uuid={type:"string",format:"uuid"},date={type:"string",format:"date-time"};
const period={type:"object",required:["from","to"],properties:{from:{type:"string",format:"date"},to:{type:"string",format:"date"}}};
const failures={"401":{description:"Key invalid, expired, replaced, or revoked"},"409":{description:"Published evidence or assurance changed"},
  "429":{description:"Per-key or company rate limit reached",headers:{"Retry-After":{schema:{type:"integer"}}}},"503":{description:"API disabled or unavailable"}};
const available={type:"object",required:["id","state","sha256","bytes","download","filename","contentType","reviewVersion","reviewedAt"],properties:{
  id:uuid,state:{enum:["AVAILABLE"]},sha256:{type:"string",pattern:"^[0-9a-f]{64}$"},bytes:{type:"integer"},download:text,
  filename:text,contentType:text,reviewVersion:{type:"integer"},reviewedAt:date}};
const withdrawn={type:"object",required:["id","state"],properties:{id:uuid,state:{enum:["WITHDRAWN"]}}};
const control={type:"object",required:["requestId","requestTitle","title","version","acceptedAt","coverage","evidenceIds"],properties:{
  requestId:uuid,requestTitle:text,title:text,version:{type:"integer"},acceptedAt:date,coverage:period,evidenceIds:{type:"array",items:uuid}}};
const packageSchema={type:"object",required:["format","roomId","title","purpose","publishedAt","roomExpiresAt","accessExpiresAt","selectionHash","period","controls","evidence"],
  properties:{format:{enum:["regpilot-auditor-package-v1"]},roomId:uuid,title:text,purpose:text,publishedAt:date,roomExpiresAt:date,accessExpiresAt:date,selectionHash:text,
    period:{anyOf:[period,{type:"null"}]},controls:{type:"array",items:control},evidence:{type:"array",items:{oneOf:[available,withdrawn]}}}};
export function GET(){
  return Response.json({openapi:"3.1.0",info:{title:"RegPilot Auditor API",version:"1.0.0",
    description:"Each bearer key reads one published room. Reconcile withdrawn IDs on sync. A 401 ends access to the entire room. Accepted control requests reflect the published audit period."},
    components:{securitySchemes:{auditorKey:{type:"http",scheme:"bearer"}}},security:[{auditorKey:[]}],paths:{
      "/api/v1/auditor/package":{get:{operationId:"readPublishedPackage",parameters:[{name:"If-None-Match",in:"header",schema:text}],
        responses:{"200":{description:"Current package and availability",headers:{ETag:{schema:text}},content:{"application/json":{schema:packageSchema}}},
        "304":{description:"Access revalidated and package unchanged"},...failures}}},
      "/api/v1/auditor/evidence/{id}":{get:{operationId:"downloadReviewedEvidence",parameters:[{name:"id",in:"path",required:true,schema:uuid}],
        responses:{"200":{description:"Verified attachment in its declared content type",headers:{"Content-Digest":{schema:text}},content:{"*/*":{schema:{type:"string",format:"binary"}}}},
        "404":{description:"File outside this package"},...failures}}}
    }});
}
