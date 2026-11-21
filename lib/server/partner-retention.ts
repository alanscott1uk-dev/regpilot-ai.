import {db} from './db';
export async function purgeExpiredPartnerRecords(now=new Date()){
 const due={retentionEndsAt:{lte:now},purgedAt:null};
 const rows=await db.customerApiObservation.findMany({where:due,orderBy:{retentionEndsAt:'asc'},take:500,select:{id:true}});
 if(!rows.length)return 0;
 const changed=await db.customerApiObservation.updateMany({where:{id:{in:rows.map(r=>r.id)},...due},data:{purgedAt:now,payload:{retention:'ended'},reviewNotes:''}});
 return changed.count;
}
