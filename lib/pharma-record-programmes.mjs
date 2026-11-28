const us='https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11';
const eu='https://health.ec.europa.eu/document/download/8d305550-dd22-4dad-8463-2ddb4a1345f1_en';

// Each activity is one piece of work even when both regimes reference its evidence.
const activities=[
 {key:'scope',title:'Identify the records and signatures in scope',
  description:'Trace one regulated process from data capture to its retained record. Identify the governing record requirements, closed or open system boundary, intended use and accountable roles.',
  why:'The applicability decision determines which records and system functions to sample.',evidenceHint:'Approved scope, system inventory, record flow and role assignments.',
  us:['11.1','11.2','11.3'],eu:[1,2]},
 {key:'supplier',title:'Assess the supplier and its responsibilities',
  description:'Review supplier competence, access arrangements and responsibilities against the services that can affect the selected process.',
  why:'The site needs evidence that its supplier can perform the responsibilities it delegates.',evidenceHint:'Supplier assessment, agreement, responsibility matrix and review record.',us:[],eu:[3]},
 {key:'release',title:'Execute the intended-use and interface tests',
  description:'Trace a critical requirement to its risk, predefined acceptance criterion, executed result, release and configuration. Challenge an invalid input and reconcile transferred records.',
  why:'The site can then reproduce the release decision and identify the boundary of the tests.',evidenceHint:'Requirements matrix, signed tests, interface reconciliation and deviations.',
  us:['11.10'],eu:[4,5,6]},
 {key:'copies',title:'Retrieve an accurate copy from a retained record',
  description:'Retrieve the original and a readable export. Compare values, metadata and amendment history. Demonstrate an archived record can be located and interpreted.',
  why:'An inspection sample must remain intelligible through its retention period.',evidenceHint:'Source and export comparison, retention rule, archive retrieval and reviewer result.',
  us:['11.10'],eu:[7,8,17]},
 {key:'history',title:'Trace an authorised change through the audit trail',
  description:'Select a change to regulated data. Reconstruct the original value, new value, actor, time and reason. Review a system configuration change and its approval.',
  why:'A reviewer needs enough history to explain the changes affecting a result.',evidenceHint:'Audit trail, change approval, configuration revision and independent review.',
  us:['11.10'],eu:[9,10]},
 {key:'access',title:'Verify access and open-system protections',
  description:'Sample a joiner, changed role and leaver. Check access decisions, credential handling and the controls protecting records across each applicable external boundary.',
  why:'Identity and transmission controls protect the attribution and integrity of the retained record.',evidenceHint:'Role approvals, access removal, credential controls and integrity checks.',
  us:['11.10','11.30','11.300'],eu:[12]},
 {key:'signatures',title:'Trace a signature to its signer and record',
  description:'Use an authorised test signer. Verify identity, signature components, displayed name, date, time and meaning. Retrieve another revision and check the signature remains linked to the signed revision. Review the applicable certification record.',
  why:'The evidence must identify who signed, what they approved and which record carries the signature.',evidenceHint:'Identity evidence, signing result, revision comparison and certification assessment.',
  us:['11.50','11.70','11.100','11.200','11.300'],eu:[14]},
 {key:'batch',title:'Verify electronic batch certification authority',
  description:'Where the system records batch certification, trace one decision to the named qualified person, the role in force and the certified batch record.',
  why:'Certification authority depends on the person, the record and the decision being made.',evidenceHint:'Role delegation, signed sample and independent retrieval.',us:[],eu:[15]},
 {key:'continuity',title:'Exercise continuity and reconcile recovered records',
  description:'Interrupt a representative test process, follow the approved fallback, restore access and reconcile records created during the interruption.',
  why:'The exercise shows whether the operating team can recover the records needed to resume work.',evidenceHint:'Continuity test, recovery log, reconciliation and signed outcome.',us:[],eu:[16]},
 {key:'review',title:'Review incidents and continued fitness for use',
  description:'Trace a significant incident through investigation and corrective action. Review changes, known defects and validation status in the periodic system assessment.',
  why:'A site decision must account for significant changes since the original release.',evidenceHint:'Incident record, effectiveness evidence and periodic evaluation.',us:[],eu:[11,13]}
];
const choices=[
 {id:'us-fda-part-11',title:'US FDA 21 CFR Part 11 electronic records and signatures',us:true,eu:false,
  description:'Prepare evidence for electronic records and signatures within the site’s documented FDA predicate-rule scope.'},
 {id:'eu-gmp-annex-11',title:'EU GMP Annex 11 computerised systems',us:false,eu:true,
  description:'Prepare an evidence file for the 17 sections of Annex 11 for computerised systems used in human medicines GMP activities.'},
 {id:'pharma-electronic-records-joint',title:'Joint FDA Part 11 and EU GMP Annex 11 audit',us:true,eu:true,
  description:'Assign one owner to each shared activity and trace its evidence to each applicable US and EU reference. Record exclusions for the site and intended use.'}
];
export const pharmaRecordProgrammes=choices.map(choice=>({
 id:choice.id,version:1,title:choice.title,description:choice.description,
 items:activities.flatMap(({us:usRefs,eu:euRefs,...activity},index)=>{
  const american=choice.us?usRefs:[],european=choice.eu?euRefs:[];
  if(!american.length&&!european.length)return [];
  const sources=[...(american.length?[{name:'21 CFR Part 11',url:us+'/section-'+american[0]}]:[]),...(european.length?[{name:'EU GMP Annex 11',url:eu}]:[])];
  return [{...activity,suggestedDays:Math.min(30,5+index*3),sourceUrl:sources[0].url,sources,
   mappings:[...american.map(r=>'21 CFR Part 11 · § '+r),...european.map(r=>'EU GMP Annex 11 · Section '+r)]}];
 })
}));
