import {REGULATORY_SOURCES,officialSourceUrl} from "../regulatory-sources.mjs";
import {validPassageReceipt} from "../regulatory/research";
import {sopDraftSchema,sopOpenItems,sopStarterNames} from "../sop-draft";
import {verifyOfficialPassage} from "./publication-research";
import {writeOfficeZip} from "./questionnaire-workbook.mjs";
import {IntelligenceError} from "./intelligence-service";

const word="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationships="http://schemas.openxmlformats.org/package/2006/relationships";
const office="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xml=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function paragraph(value:string,style=""){
  const runs=value.split(/\r\n?|\n/).map((line,i)=>`<w:r>${i?"<w:br/>":""}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join("");
  return `<w:p>${style?`<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`:""}${runs}</w:p>`;
}
export async function buildSopDocument(input:unknown,verify=verifyOfficialPassage){
  const parsed=sopDraftSchema.safeParse(input);
  if(!parsed.success)throw new IntelligenceError("Check the draft fields, source references and step limits.",400);
  const d=parsed.data;
  if(!d.title.trim())throw new IntelligenceError("Add a procedure title before exporting.",400);
  const receipts=await Promise.all(d.sources.map(async receipt=>{
    const source=REGULATORY_SOURCES.find(s=>s.id===receipt.sourceId);
    if(!source||!validPassageReceipt(receipt))throw new IntelligenceError("One source reference is invalid. Remove it and find the passage again.",400);
    if(d.nation&&source.jurisdictions?.length&&!source.jurisdictions.includes(d.nation))throw new IntelligenceError("A selected publication is outside the chosen UK nation. Review the references.",409);
    let checked;
    try{checked=await verify(receipt);}catch{throw new IntelligenceError("A publisher could not be rechecked. Retry or remove its passage to export without it.",503);}
    if(checked.status!=="verified")throw new IntelligenceError("A cited publication has changed. Refresh the research and select a current passage.",409);
    return {source,receipt,checked};
  }));
  const content:string[]=[];
  function section(heading:string,body:string){content.push(paragraph(heading,"Heading1"),paragraph(body.trim()||"To complete"));}
  content.push(paragraph("DRAFT FOR REVIEW","Status"),paragraph(d.title,"Title"));
  content.push(paragraph(["Reference "+(d.reference.trim()||"to assign"),"Revision "+(d.revision.trim()||"to assign")].join("  |  ")));
  content.push(paragraph("Accountable owner: "+(d.owner.trim()||"to assign")),paragraph("UK nation: "+(d.nation||"to confirm")));
  section("Purpose",d.purpose);section("Scope and site",d.scope);
  content.push(paragraph("Procedure","Heading1"));
  d.steps.forEach((s,i)=>{
    content.push(paragraph(`${i+1}. ${s.action.trim()||"Instruction to complete"}`,"Heading2"),paragraph("Responsible role: "+(s.role.trim()||"to assign")),paragraph("Evidence record: "+(s.record.trim()||"to define")));
    if(s.citationId)content.push(paragraph("Supporting passage "+(d.sources.findIndex(p=>p.id===s.citationId)+1)+" · reviewer to confirm applicability."));
  });
  section("Exceptions and escalation",d.exceptions);
  if(d.localChecks.trim())section("Site decisions to confirm",d.localChecks);
  const pending=sopOpenItems(d);
  if(pending.length)section("Incomplete draft fields",pending.join("\n"));
  content.push(paragraph("Official source passages","Heading1"));
  if(!receipts.length)content.push(paragraph("No official publication passages were attached to this draft."));
  for(const [i,{source,receipt,checked}] of receipts.entries()){
    content.push(paragraph(`${i+1}. ${source.agency} — ${source.title}`,"Heading2"),paragraph(receipt.quote),paragraph(officialSourceUrl(source)),
      paragraph(`Rechecked ${checked.checkedAt}. Characters ${receipt.start}–${receipt.end}. Publication SHA-256 ${receipt.documentHash}.`));
    if(source.scopeNote)content.push(paragraph(source.scopeNote));
  }
  section("Review and release",`Prepared from the ${sopStarterNames[d.starter].toLowerCase()} starter. An authorised reviewer must assess the proposed instructions, local decisions and applicability before controlled release.`);
  const parts:Array<[string,string]>=[
    ["[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ["_rels/.rels",`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels",`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/styles" Target="styles.xml"/></Relationships>`],
    ["word/styles.xml",`<w:styles xmlns:w="${word}">${[["Title","36"],["Heading1","28"],["Heading2","23"],["Status","20"]].map(([name,size])=>`<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="24485A"/><w:sz w:val="${size}"/></w:rPr></w:style>`).join("")}</w:styles>`],
    ["word/document.xml",`<w:document xmlns:w="${word}"><w:body>${content.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1150" w:bottom="1080" w:left="1150"/></w:sectPr></w:body></w:document>`],
  ];
  const stem=(d.reference.trim()||d.title.trim()).replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,85)||"procedure";
  return {filename:stem+"-draft.docx",bytes:writeOfficeZip(parts)};
}
