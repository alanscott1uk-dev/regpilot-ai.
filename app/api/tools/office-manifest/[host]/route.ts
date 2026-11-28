export const dynamic='force-dynamic';
const hosts={
 word:{id:'85483e65-0242-4aad-8f7e-ce3ef41839f7',name:'Word',host:'Document',permission:'ReadAllDocument',description:'Send the current Word SOP to independent review.'},
 excel:{id:'87e31924-f18e-4a06-bd26-54c8b590b1aa',name:'Excel',host:'Workbook',permission:'ReadDocument',description:'Import selected stock register rows into a quality case.'}
};
export async function GET(request:Request,{params}:{params:Promise<{host:string}>}){
 const {host}=await params;
 if(host!=='word'&&host!=='excel')return new Response('Unknown Office host',{status:404});
 const url=new URL(request.url),authority=request.headers.get('host')??url.host;
 if(!/^(?:[a-z0-9.-]+|\[::1\])(?::[0-9]{1,5})?$/i.test(authority))return new Response('Invalid workspace host',{status:400});
 const local=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(authority);
 const origin=(local?url.protocol:'https:')+'//'+authority,h=hosts[host];
 const xml=`<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp">
 <Id>${h.id}</Id><Version>1.0.0.0</Version><ProviderName>RegPilot</ProviderName><DefaultLocale>en-GB</DefaultLocale>
 <DisplayName DefaultValue="RegPilot for ${h.name}"/><Description DefaultValue="${h.description}"/>
 <IconUrl DefaultValue="${origin}/outlook/icon-64.png"/><HighResolutionIconUrl DefaultValue="${origin}/outlook/icon-128.png"/>
 <SupportUrl DefaultValue="${origin}/${host==='word'?'sop-builder':'team/quality'}"/>
 <Hosts><Host Name="${h.host}"/></Hosts>
 <DefaultSettings><SourceLocation DefaultValue="${origin}/office/pane.html?host=${host}"/></DefaultSettings>
 <Permissions>${h.permission}</Permissions>
</OfficeApp>`;
 return new Response(xml,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store',
  'Content-Disposition':'attachment; filename="regpilot-'+host+'.xml"'}});
}
