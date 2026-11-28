import type {Prisma} from '@prisma/client';
/** A credential is stored once; explicit control links extend evidence reuse within its organisation. */
export const connectorControlScope=(controlId:string):Prisma.EvidenceConnectorWhereInput=>({OR:[{controlId},{controlLinks:{some:{controlId,control:{enabled:true}}}}]});
export async function connectorControlIds(tx:Prisma.TransactionClient,organizationId:string,connectorId:string,primaryControlId:string){
 const links=await tx.connectorControlLink.findMany({where:{organizationId,connectorId,control:{enabled:true}},select:{controlId:true},orderBy:{controlId:'asc'},take:20});
 return [...new Set([primaryControlId,...links.map(l=>l.controlId)])];
}
