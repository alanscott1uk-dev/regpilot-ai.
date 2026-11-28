import {NextResponse} from 'next/server';
import {frameworkRegions,release,searchFrameworks} from '../../../../lib/audit-catalogue/catalogue';
export function GET(request:Request){
  const params=new URL(request.url).searchParams,q=params.get('q')??'';
  if(params.getAll('q').length!==1||q.length>150)return NextResponse.json({error:'Invalid framework search.'},{status:400});
  if(params.has('page')){
    const raw=params.get('page')??'',region=params.get('region')??'';
    if(params.getAll('page').length!==1||params.getAll('region').length>1||!/^([1-9]\d{0,5})$/.test(raw)||(region&&!frameworkRegions.includes(region)))
      return NextResponse.json({error:'Invalid catalogue page or region.'},{status:400});
    const {rows,...pagination}=searchFrameworks(q,region,Number(raw));
    return NextResponse.json({release,...pagination,rows:rows.map(variants=>({family:variants[0].family,profiles:variants}))},
      {headers:{'Cache-Control':'public, max-age=300, s-maxage=3600'}});
  }
  const result=searchFrameworks(q,'',1);
  return NextResponse.json({total:result.total,rows:result.rows.slice(0,5).map(v=>({id:v[0].id,name:v[0].name}))},
    {headers:{'Cache-Control':'public, max-age=300, s-maxage=3600'}});
}
