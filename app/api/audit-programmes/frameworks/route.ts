import {NextResponse} from 'next/server';
import {searchFrameworks} from '../../../../lib/audit-catalogue/catalogue';
export function GET(request:Request){
  const params=new URL(request.url).searchParams,q=params.get('q')??'';
  if(params.getAll('q').length!==1||q.length>150)return NextResponse.json({error:'Invalid framework search.'},{status:400});
  const result=searchFrameworks(q,'',1);
  return NextResponse.json({total:result.total,rows:result.rows.slice(0,5).map(v=>({id:v[0].id,name:v[0].name}))},
    {headers:{'Cache-Control':'public, max-age=300, s-maxage=3600'}});
}
