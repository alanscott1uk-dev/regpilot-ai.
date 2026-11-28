const cyber_essentialsSource="https://www.ncsc.gov.uk/sites/default/files/2026-11/Cyber-Essentials-Requirements-for-IT-Infrastructure-v3-3.pdf";
const cyber_essentials={
 id:"cyber-essentials",version:1,title:"UK Cyber Essentials v3.3",description:"Prepare evidence for the five technical controls across the organisation’s agreed assessment scope.",
 items:[
  {key:"scope",title:"Agree the boundary and asset inventory",
   description:"List the business services, devices, networks and cloud tenants included. Ask an accountable owner to record the boundary and explain exclusions.",
   why:"An incomplete inventory can hide an unmanaged service from every subsequent test.",evidenceHint:"Dated boundary diagram, asset register and approved scope.",
   sourceUrl:cyber_essentialsSource,mappings:["Cyber Essentials v3.3 · Scope"],suggestedDays:7},
  {key:"firewalls",title:"Check network boundary rules",
   description:"Sample an external connection and an administration interface from the approved configuration. Record the owner, purpose and last review of each rule.",
   why:"The team needs a record of who authorised externally reachable services.",evidenceHint:"Redacted firewall rule review with a dated change decision.",
   sourceUrl:cyber_essentialsSource,mappings:["Cyber Essentials v3.3 · Firewalls"],suggestedDays:14},
  {key:"configuration",title:"Check the secure configuration baseline",
   description:"Compare a managed endpoint and a representative cloud service with the approved baseline. Record default accounts, unused services and any exception.",
   why:"The actual configuration shows whether the agreed baseline is in use.",evidenceHint:"Configuration export, baseline version and exception owner.",
   sourceUrl:cyber_essentialsSource,mappings:["Cyber Essentials v3.3 · Secure configuration"],suggestedDays:14},
  {key:"updates",title:"Trace security updates on supported software",
   description:"Select a recent vendor update and follow it from release through deployment to a representative device. Record unsupported software and the follow-up decision.",
   why:"An inventory alone cannot show whether security updates reached the devices.",evidenceHint:"Vendor notice, deployment record and verification date.",
   sourceUrl:cyber_essentialsSource,mappings:["Cyber Essentials v3.3 · Security update management"],suggestedDays:14},
  {key:"access",title:"Sample user and administrator access",
   description:"Review a joiner, a leaver and a privileged account in scope. Match approvals, actual permissions and authentication settings to the access policy.",
   why:"A joined-up sample can reveal stale access or administrative permissions without an owner.",evidenceHint:"Dated account listings, approvals and review outcome.",
   sourceUrl:cyber_essentialsSource,mappings:["Cyber Essentials v3.3 · User access control"],suggestedDays:21},
  {key:"protection",title:"Verify malware protection on managed endpoints",
   description:"Review the protection method used for each device class. Sample a current device status and trace an alert or controlled internal exercise to the recorded response.",
   why:"An enrolled device can still have inactive protection or an unreviewed alert.",evidenceHint:"Protection settings, status timestamp and a response record.",
   sourceUrl:cyber_essentialsSource,mappings:["Cyber Essentials v3.3 · Malware protection"],suggestedDays:21}
 ]
};

const uk_gdpr_accountabilitySource="https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/";
const uk_gdpr_accountability={
 id:"uk-gdpr-accountability",version:1,title:"UK GDPR accountability",description:"Prepare an ICO-guided review of processing decisions, rights, processors, risk assessments and incident handling.",
 items:[
  {key:"governance",title:"Confirm who owns data protection decisions",
   description:"Select a live processing service. Identify the accountable owner, escalation route and the evidence showing when issues last reached management.",
   why:"Decision ownership makes findings actionable and reviewable.",evidenceHint:"Approved responsibilities and management review minutes.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Accountability and governance"],suggestedDays:7},
  {key:"records",title:"Trace a processing activity and its lawful basis",
   description:"Follow one real use of personal data through collection, access, disclosure and retention. Reconcile the actual process with the processing record and privacy notice.",
   why:"A review connects recorded purposes with how staff and suppliers use the data.",evidenceHint:"Reviewed processing entry, lawful basis assessment and current notice.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Records of processing and lawful basis"],suggestedDays:14},
  {key:"rights",title:"Review the handling of an individual rights request",
   description:"Sample a completed request or controlled exercise. Check intake, identity checks, ownership, retrieval, decision and response dates.",
   why:"A dated case shows whether an individual can exercise their rights in practice.",evidenceHint:"Redacted request timeline, response and decision record.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Individual rights"],suggestedDays:14},
  {key:"processors",title:"Check the controls on an appointed processor",
   description:"Select a supplier that handles personal data and match the service actually delivered to the approved processing instructions, contract and oversight record.",
   why:"An agreement needs to describe the processing and responsibilities the service actually uses.",evidenceHint:"Signed processing terms, service description and oversight evidence.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Contracts and processors"],suggestedDays:21},
  {key:"impact",title:"Trace a change through privacy risk assessment",
   description:"Follow a proposed change from initial screening to the decision on whether an impact assessment was needed. Record safeguards, outstanding risks and the accountable decision.",
   why:"Changes in processing can introduce risks beyond an earlier assessment.",evidenceHint:"Screening record, impact assessment where applicable and approval.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Data protection by design and impact assessment"],suggestedDays:21},
  {key:"incident",title:"Trace a personal data incident decision",
   description:"Select an incident or exercise. Review the known facts, risk to affected people, documented notification decision, timings and corrective actions.",
   why:"A complete chronology supports review of the decisions taken as the facts developed.",evidenceHint:"Incident log, decision rationale, communications and follow-up.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Personal data breaches"],suggestedDays:21},
  {key:"assurance",title:"Review staff competence and outstanding actions",
   description:"Sample a role handling personal data. Check relevant training, management review of findings and evidence that an overdue improvement was addressed.",
   why:"Periodic evidence shows whether accountability arrangements continue to work.",evidenceHint:"Training record, review minutes and one verified corrective action.",
   sourceUrl:uk_gdpr_accountabilitySource,mappings:["ICO accountability · Training and review"],suggestedDays:30}
 ]
};

const uk_gdp_self_inspectionSource="https://health.ec.europa.eu/system/files/2016-11/2013_c343_01_en_0.pdf";
const uk_gdp_self_inspection={
 id:"uk-gdp-self-inspection",version:1,title:"UK medicines wholesale GDP self-inspection",description:"Prepare a site inspection across wholesale authorisations, premises, stock, returns, recalls, contractors and transport.",
 items:[
  {key:"quality",title:"Review the quality system with the responsible person",
   description:"Select a recent management review and trace one risk or deviation through a quality decision, assigned action and effectiveness check. Confirm the site activities and authorisations in scope.",
   why:"A quality decision needs an accountable owner and evidence of follow-up.",evidenceHint:"Site scope, quality review minutes, action record and effectiveness evidence.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 1 · Quality management"],suggestedDays:7},
  {key:"people",title:"Check delegated duties and current competence",
   description:"Choose two GDP activities and identify who performed them. Match each person to their delegated authority, training and cover arrangements on the date of the work.",
   why:"The site must be able to reconstruct who carried out a sampled activity and on what authority.",evidenceHint:"Role records, delegated duties and dated competence evidence.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 2 · Personnel"],suggestedDays:14},
  {key:"premises",title:"Trace a storage location to its qualification evidence",
   description:"Choose an in-use storage zone. Review access arrangements, temperature records, relevant mapping, logger identification and current calibration against the site procedure.",
   why:"The storage history for a named location supports an investigation into the stock kept there.",evidenceHint:"Location plan, mapping summary, calibration certificate and dated readings.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 3 · Premises and equipment"],suggestedDays:14},
  {key:"documents",title:"Check which procedure applied when work occurred",
   description:"Select a completed receipt or dispatch and retrieve the approved procedure in force on that date. Check the record, amendment history and ability to retrieve it.",
   why:"A superseded procedure can change how an assessor interprets the transaction.",evidenceHint:"Effective procedure, revision history and completed operation record.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 4 · Documentation"],suggestedDays:14},
  {key:"trading",title:"Trace a pack through authorised trading partners",
   description:"Follow one purchase and sale from the supplier check through receipt, storage and dispatch to the customer check. Match batch or transaction identities across the records.",
   why:"The sample links both trading partners and the physical movement to the site’s authorised activity.",evidenceHint:"Trading partner checks, receipt, stock trail and dispatch record.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 5 · Operations"],suggestedDays:21},
  {key:"returns",title:"Trace an exception through segregation and recall",
   description:"Sample a returned product or a recall exercise. Reconcile affected quantities, stock locations, communications, disposition authority and unresolved differences.",
   why:"Traceability and a recorded disposition can prevent a segregated item being supplied again.",evidenceHint:"Exception investigation, stock reconciliation and authorised decision.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 6 · Complaints, returns and recalls"],suggestedDays:21},
  {key:"contracts",title:"Verify an outsourced wholesale activity",
   description:"Select one contracted service. Compare the agreement with how the supplier carried out the work and check the site’s most recent oversight decision.",
   why:"Outsourcing creates a handover that needs defined responsibilities and evidence of oversight.",evidenceHint:"Current agreement, qualification record and performance review.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 7 · Outsourced activities"],suggestedDays:21},
  {key:"inspection",title:"Verify closure of a self-inspection finding",
   description:"Review the inspection schedule and select a previous finding. Follow it to the action owner, supporting evidence and a recorded check that the action worked.",
   why:"A closed finding needs evidence that the underlying problem was addressed.",evidenceHint:"Inspection plan, finding, corrective action and effectiveness review.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 8 · Self-inspections"],suggestedDays:30},
  {key:"transport",title:"Reconstruct the conditions of a delivery",
   description:"Choose a shipment and trace its route, carrier, packaging, time in transit and available temperature evidence. Review any deviation against the handling decision.",
   why:"A shipment sample ties transport qualification and an actual customer delivery together.",evidenceHint:"Shipping instructions, route evidence, delivery record and any excursion decision.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 9 · Transportation"],suggestedDays:21},
  {key:"brokering",title:"Establish whether medicines brokering is in scope",
   description:"Review commercial arrangements with the responsible person and determine whether the site carries out brokering activities. Document the rationale and any oversight records that apply.",
   why:"A brokerage arrangement may involve different activities and records from holding stock.",evidenceHint:"Business activity assessment and the supporting brokering records where applicable.",
   sourceUrl:uk_gdp_self_inspectionSource,mappings:["EU GDP 2013/C 343/01 · Chapter 10 · Brokers"],suggestedDays:30}
 ]
};

export const ukAuditProgrammes=[cyber_essentials,uk_gdpr_accountability,uk_gdp_self_inspection];
