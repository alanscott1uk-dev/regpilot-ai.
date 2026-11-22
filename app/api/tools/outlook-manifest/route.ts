export const dynamic='force-dynamic';

// A sideloaded manifest must point back to the deployment from which it was installed.
export function GET(request:Request){
 const url=new URL(request.url);
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))
  return new Response('Use the HTTPS address of your RegPilot workspace.',{status:400});
 const origin=url.origin.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 const pane=origin+'/outlook/pane.html',icon=(size:number)=>origin+'/outlook/icon-'+size+'.png';
 const xml=`<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xsi:type="MailApp">
 <Id>ec417d45-a25c-45a5-8e53-1b61eba45132</Id><Version>1.0.0.0</Version><ProviderName>RegPilot</ProviderName><DefaultLocale>en-GB</DefaultLocale>
 <DisplayName DefaultValue="RegPilot"/><Description DefaultValue="Save selected supplier correspondence to a quality case."/>
 <IconUrl DefaultValue="${icon(64)}"/><HighResolutionIconUrl DefaultValue="${icon(128)}"/><SupportUrl DefaultValue="${origin}/team/quality"/>
 <Hosts><Host Name="Mailbox"/></Hosts><Requirements><Sets><Set Name="Mailbox" MinVersion="1.3"/></Sets></Requirements>
 <FormSettings><Form xsi:type="ItemRead"><DesktopSettings><SourceLocation DefaultValue="${pane}"/><RequestedHeight>360</RequestedHeight></DesktopSettings></Form></FormSettings>
 <Permissions>ReadItem</Permissions><Rule xsi:type="ItemIs" ItemType="Message" FormType="Read"/><DisableEntityHighlighting>false</DisableEntityHighlighting>
 <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
  <Requirements><bt:Sets DefaultMinVersion="1.3"><bt:Set Name="Mailbox"/></bt:Sets></Requirements>
  <Hosts><Host xsi:type="MailHost"><DesktopFormFactor><FunctionFile resid="Pane.Url"/>
   <ExtensionPoint xsi:type="MessageReadCommandSurface"><OfficeTab id="TabDefault"><Group id="RegPilot.Group"><Label resid="Group.Label"/>
    <Control xsi:type="Button" id="RegPilot.Save"><Label resid="Save.Label"/><Supertip><Title resid="Save.Label"/><Description resid="Save.Help"/></Supertip>
     <Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>
     <Action xsi:type="ShowTaskpane"><SourceLocation resid="Pane.Url"/></Action>
    </Control></Group></OfficeTab></ExtensionPoint></DesktopFormFactor></Host></Hosts>
  <Resources><bt:Images>${[16,32,80].map(n=>`<bt:Image id="Icon.${n}" DefaultValue="${icon(n)}"/>`).join('')}</bt:Images>
   <bt:Urls><bt:Url id="Pane.Url" DefaultValue="${pane}"/></bt:Urls>
   <bt:ShortStrings><bt:String id="Group.Label" DefaultValue="RegPilot"/><bt:String id="Save.Label" DefaultValue="Save to RegPilot"/></bt:ShortStrings>
   <bt:LongStrings><bt:String id="Save.Help" DefaultValue="Preview this message and choose the documents to save to a quality case."/></bt:LongStrings>
  </Resources>
 </VersionOverrides>
</OfficeApp>`;
 return new Response(xml,{headers:{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':'attachment; filename="regpilot-outlook.xml"','Cache-Control':'no-store'}});
}
