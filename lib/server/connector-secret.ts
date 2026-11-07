import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
function encryptionKey(){const value=process.env.REGPILOT_CONNECTOR_ENCRYPTION_KEY||"";if(!/^[a-f\d]{64}$/i.test(value))throw new Error("Connector encryption is not configured");return Buffer.from(value,"hex");}
export function encryptConnectorSecret(secret:string,organisation:string,id:string){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);cipher.setAAD(Buffer.from(`regpilot:connector:v1:${organisation}:${id}`));
 const encrypted=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);return ["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),encrypted.toString("base64")].join(".");
}
export function decryptConnectorSecret(value:string,organisation:string,id:string){
 const [version,iv,tag,encrypted,...extra]=value.split(".");if(version!=="v1"||!iv||!tag||!encrypted||extra.length)throw new Error("Credential envelope invalid");
 const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64"));decipher.setAAD(Buffer.from(`regpilot:connector:v1:${organisation}:${id}`));decipher.setAuthTag(Buffer.from(tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(encrypted,"base64")),decipher.final()]).toString("utf8");
}
