import {z} from "zod";
export const invitationSchema=z.object({email:z.string().trim().toLowerCase().pipe(z.email().max(254)),role:z.enum(["ADMIN","EDITOR","VIEWER"])}).strict();
export const memberChangeSchema=z.object({userId:z.uuid(),expectedRole:z.enum(["OWNER","ADMIN","EDITOR","VIEWER"]),action:z.enum(["ROLE","REMOVE","TRANSFER"]),role:z.enum(["ADMIN","EDITOR","VIEWER"]).optional(),replacementId:z.uuid().optional()}).strict();
export const invitationDecisionSchema=z.object({id:z.uuid(),version:z.number().int().positive(),decision:z.enum(["ACCEPT","DECLINE"])}).strict();
