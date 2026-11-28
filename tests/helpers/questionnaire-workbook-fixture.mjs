import {zipFixture} from './docx-fixture.mjs';
export const sheetNamespace='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel='http://schemas.openxmlformats.org/package/2006/relationships',office='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export const inlineCell=(coordinate,value)=>`<c r="${coordinate}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
export const sheetRow=(number,cells)=>`<row r="${number}">${cells.join('')}</row>`;
export const defaultSheet=()=>sheetRow(1,[inlineCell('A1','Reference'),inlineCell('B1','Question'),inlineCell('C1','Instructions'),inlineCell('D1','Existing response')])+sheetRow(4,[inlineCell('A4','Q-1'),inlineCell('B4','How do you review user access?'),inlineCell('C4','Describe frequency and named owners.'),inlineCell('D4','Original supplied response, awaiting review.')]);
export function workbookParts(sheets=[{name:'Security',xml:defaultSheet()}],extras=[]){
  return [
    ['[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,index)=>`<Override PartName="/xl/worksheets/sheet${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels',`<Relationships xmlns="${rel}"><Relationship Id="root" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',`<workbook xmlns="${sheetNamespace}" xmlns:r="${office}"><sheets>${sheets.map((sheet,index)=>`<sheet name="${escape(sheet.name)}" sheetId="${index+1}" r:id="sheet${index+1}"${sheet.hidden?' state="hidden"':''}/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<Relationships xmlns="${rel}">${sheets.map((_,index)=>`<Relationship Id="sheet${index+1}" Type="${office}/worksheet" Target="worksheets/sheet${index+1}.xml"/>`).join('')}${extras.some(([name])=>name==='xl/sharedStrings.xml')?`<Relationship Id="strings" Type="${office}/sharedStrings" Target="sharedStrings.xml"/>`:''}</Relationships>`],
    ...sheets.map((sheet,index)=>[`xl/worksheets/sheet${index+1}.xml`,`<worksheet xmlns="${sheetNamespace}"><sheetData>${sheet.xml}</sheetData>${sheet.after||''}</worksheet>`]),
    ...extras,
  ];
}
export const fixtureWorkbook=(sheets,extras)=>zipFixture(workbookParts(sheets,extras));
