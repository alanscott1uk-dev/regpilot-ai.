# RegPilot competitive integration and capability review

22 November 2026 · PR #10

The 20 November workbook contains 79 products and services, 22 capability rows and four tabs. The entries include software vendors, data networks, professional services and certification alternatives. A service such as GDP Pharma Consulting calls for an independent Responsible Person trial. A platform such as ServiceNow can also supply operational evidence through an API.

## What changed on the branch

The workbook counted 13 evidence provider types. PR #10 had 15 before this change. Five new collectors bring the implementation count to 20. The tally excludes accounting OAuth connections, portal shortcuts and partner-import formats. It counts a collector as implemented even while its deployment flag is off. Live tenant verification and buyer acceptance are separate measures.

| Connection | Independent signal the reviewer can inspect | Boundary of the observation |
| --- | --- | --- |
| Jira Cloud | Assignment, Done category and a recorded resolution for one issue | A workflow can close an issue as declined. Verify the corrective action separately. |
| ServiceNow | Assignment, active flag and closure time for one incident | Local incident states and access policies differ. Closing an incident requires separate effectiveness evidence. |
| Azure DevOps | Build result and exact match to an expected Git revision | A successful build leaves test coverage, deployment and release approval to be verified. |
| Confluence Cloud | Publication state and current version compared with the reviewed revision | The page version identifies drift. Approval and training records live separately. |
| SafetyCulture | Template identity, completion date and archive status for one inspection | The adapter reads the legacy audit JSON endpoint. Checklist findings and action closure still require review. |

Each collector supports workspace-specific setup, manual verification, daily or weekly collection, restricted credentials, retained observations, change follow-up and export. Missing fields produce unknown results. The pilot connectors need customer-authorised accounts, suitable read permissions and credential expiry testing. ServiceNow currently requires access-token replacement. Azure DevOps uses an expiring Build (Read) PAT for the pilot.

A separate logger CSV import covers a period of temperature or humidity monitoring. It accepts up to 288 timestamped samples, the site and sensor, the certificate reference and period, operating limits and maximum gap. RegPilot retains the imported CSV digest and checks the sample sequence again on receipt. An excursion triggers follow-up even when other periods have missing readings. A window with gaps or incomplete calibration cannot pass. Verifying the certificate, device identity and a real vendor export remains a pilot task.

[Logger assessment](../lib/logger-window.ts) · [CSV converter](../public/examples/logger-csv.mjs) · [Collector implementation](../lib/connectors/operational-records.ts) · [Provider catalogue](../lib/connectors/record-catalogue.ts) · [Database integration test](../tests/operational-records.integration.test.ts) · [Existing partner record types](../lib/partner-records.ts) · [Buyer trial criteria](../lib/capability-trials.ts)

## All 22 capability gaps

The row numbers match the Capability gaps tab. The count is the number of competitors mapped to the gap in this review. One competitor can appear against several gaps. Hosted recovery is also a release prerequisite independent of any single competitor.

| Workbook row | Capability | Workbook priority | Comparators | Evidence still needed |
| --- | --- | --- | ---: | --- |
| 7 | Native integrations and cloud coverage | Pilot priority | 9 | Run disconnection, field loss and reauthorisation against a consented multi-system estate. Reconcile the estate to an independent inventory. |
| 8 | Workforce, access and ticketing | Pilot priority | 4 | Exercise a real leaver from HR to directory and a reopened Jira or ServiceNow record. Measure latency and identify any missed changes. |
| 9 | Customer-built integrations and event delivery | Next | 2 | Ask a customer engineer to build an adapter, rotate its credential and replay an interrupted delivery without duplicating evidence. |
| 10 | Shared controls, frameworks and audits | Next | 15 | Submit a control shared across two frameworks for independent auditor review. Preserve a rejected item and a local exception. |
| 11 | UK regulatory monitoring and applicability | Pilot priority | 15 | Blind-score UK notice applicability by activity, date and nation. Measure missed changes and false alarms against an expert reference set. |
| 12 | AI answers, private SOP search and abstention | Pilot priority | 6 | Blind-score public/private answers, citation correctness, abstentions and cross-tenant isolation using representative questions. |
| 13 | SOP authoring from an operator question | Pilot priority | 4 | Observe a new operator drafting a usable SOP from a question. Measure edits, assistance and time to an independently accepted draft. |
| 14 | Regulated SOP release, signatures and validation | Pilot priority | 7 | Have a customer quality owner approve a specific release and intended use, including signer identity, supersession and retrieval. |
| 15 | Training, competence and CAPA effectiveness | Pilot priority | 8 | Trace role assignment, practical assessment, retraining and a failed CAPA effectiveness check through a real incident. |
| 16 | Supplier identity, licences and review | Pilot priority | 3 | Reconcile an actual supplier, licensed activity, premises, validity dates and quality agreement. Exercise a lapsed authorisation. |
| 17 | Supplier network, external cyber and ESG | Integrate on demand | 8 | Secure permissioned tier-two relationships and licensed cyber or ESG signals, then test dispute, expiry and withdrawal. |
| 18 | Trust centre and access requests | Next | 3 | Have an external buyer request a published claim and prove access expires when the underlying evidence is withdrawn. |
| 19 | Questionnaire files, OCR and external portals | Next | 3 | Round-trip two buyer portals and an original workbook. Count edits and confirm every citation and product scope survives. |
| 20 | Risk estimates and cross-entity reporting | Later | 13 | Reconcile group finance against two entities and periods with a local exception and a missing source. |
| 21 | AI system and AI vendor governance | Later | 2 | Connect a runtime or procurement inventory and detect an undeclared use and a changed model under independent review. |
| 22 | Privacy, ethics and operational resilience | Integrate on demand | 6 | Connect one specialist system with restricted permissions. Exercise access separation, retention limits and reassessment. |
| 23 | NHS procurement and sector content | Next | 1 | Have a digital health supplier and NHS procurement reviewer validate the pack for its buyer, date and intended product. |
| 24 | Pharma manufacturing, medtech and product traceability | Integrate on demand | 10 | Connect at least one authorised LIMS, MES, RIM or device lifecycle system. Trace a source event to the exact release decision. |
| 25 | Field evidence, inspections and monitoring | Integrate on demand | 6 | Connect a calibrated logger, test for gaps and reconcile a real inspection finding with effective corrective action. |
| 26 | Commercial offer, onboarding and usability | Pilot priority | 9 | Time first value with external SME users, including support minutes, subscription allowances and observed cost. |
| 27 | Hosted service, isolation and operational proof | Release gate | 3 | Exercise two customer-like tenants, provider outages, evidence restoration, rollback and an independently observed recovery. |
| 28 | Self-service help and operator support | Pilot priority | 3 | Watch an unfamiliar operator diagnose an expired token and escalate a missing source. Record whether the guidance resolves each case. |

## All 79 competitors and buying alternatives

The capability numbers below refer to worksheet row numbers. The branch column names a feature available for comparison. The last column records what a buyer or independent reviewer would still have to demonstrate. The linked vendor materials describe their offerings. The review used public evidence and the feature branch. It did not include paid trials of the 79 products.

### Compliance automation

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 1 | [Vanta](https://www.vanta.com/collection/grc/compliance-programs) | 7, 10 | Cloud account inventory and 20 provider types | Inventory two customer accounts, identify omissions and time a failed control through owner response. Compare on the same estate. |
| 2 | [Drata / SafeBase](https://drata.com/products/compliance) | 18, 19 | Trust discovery, private disclosures and reviewed portal handoffs | Have a buyer request access and complete a questionnaire in its original portal. Measure correction rate and revoked access. |
| 3 | [Sprinto](https://sprinto.com/continuous-compliance/) | 7, 8 | Scheduled observations and owned follow-ups now include Jira and ServiceNow | Reopen a ticket and revoke a grant. Measure detection delay and duplicate tasks across two collection cycles. |
| 4 | [Secureframe](https://secureframe.com/products/secureframe-comply) | 10, 26 | Shared evidence, auditor access and support intake | Have a named adviser guide an unfamiliar SME to its first auditor-accepted evidence pack. Measure hours of assistance. |
| 5 | [Scrut Automation](https://www.scrut.io/) | 10, 11 | Shared controls and UK obligation mappings | Select a framework buyers actually request. Have an independent expert test mapping completeness, exceptions and update ownership. |
| 6 | [Thoropass](https://www.thoropass.com/independence-and-excellence) | 10, 27 | Auditor workspace and scoped exchange | Have an external firm sample fresh, stale and rejected evidence, then reconcile its acceptances against the export. |
| 7 | [Scytale](https://scytale.ai/wp-content/uploads/2026/01/Scytale_Overview_One-pager.pdf) | 18, 26 | Controlled disclosures and questionnaire drafts | Time first-use setup through a buyer accepting a response. Record which steps still require an adviser. |
| 8 | [Anecdotes](https://www.anecdotes.ai/data-engine) | 7, 9 | Scoped observations, signed events and a partner connector example | Have an external developer ship and maintain an adapter. Exercise retries, token rotation, schema changes and support. |
| 9 | [Hyperproof](https://hyperproof.io/product/risk-management/) | 7, 20 | Manual verification, scheduled collectors and linked controls | Measure recurring collection effort and evidence age across the same five customer systems. |
| 10 | [Complyance](https://www.complyance.com/controls-ai-agents) | 9, 10 | Customer-defined evidence tests and scoped observation intake | Have a control owner author a test, change its threshold and explain the results using missing and stale records. |
| 11 | [Strike Graph](https://help.strikegraph.com/en/articles/4699300-verify-ai) | 10, 12 | Evidence hashes, cited passages and review decisions | Ask two independent auditors to score whether the same attachments support the control, and measure disagreement. |
| 12 | [TrustCloud](https://www.trustcloud.ai/continuous-control-monitoring/) | 7, 10 | Product scope and shared evidence links | Sample the same control across two applications and prove missing coverage in one appears in reporting. |
| 13 | [Delve](https://delve.co/product/framework/soc-2) | 10, 12 | Attributed evidence exports and reviewed answers | Give an auditor a blind sample of generated claims. Count reproducible claims and unsupported answers. |

### UK SME and health assurance

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 14 | [Naq](https://www.naqcyber.com/faqs) | 23, 26 | English NHS procurement pack and evidence reuse | Have a digital-health buyer and clinical safety reviewer assess current DSPT, DTAC and DCB evidence for one product. |
| 15 | [ISMS.online / IO](https://brand.isms.online/wp-content/uploads/2025/08/ISO-27001-Platform-Features.pdf) | 10, 13 | Controlled SOP drafts and shared programme records | Produce a reviewed Statement of Applicability with inclusion, exclusion rationale and revision history. |
| 16 | [Hicomply](https://www.hicomply.com/plans) | 26, 28 | Help, support and usage controls | Give a buyer a priced scope with included support, paid usage and onboarding time. Verify the cost against a trial. |
| 17 | [DataGuard](https://www.dataguard.com/) | 12, 22 | UK research, private evidence and specialist attestations | Run procurement privacy questions with a qualified reviewer and retain which answers required specialist input. |
| 18 | [CyberSmart](https://cybersmart.co.uk/frameworks/cyber-essentials/) | 7, 26 | Intune fleet observations | Reconcile unmanaged and missing devices against the real asset register and obtain a certification partner assessment. |
| 19 | [Adoptech](https://adoptech.co.uk/policies/securesdlc/) | 13, 26 | Versioned approval and staff training assignments | Time a new customer's first approved policy and staff acknowledgement, including support and subscription costs. |
| 20 | [Cyberday](https://www.cyberday.ai/pricing) | 10, 20 | Separate organisations and shared controls within a workspace | Demonstrate group inheritance with a local exception and revocation across two authorised organisations. |
| 21 | [Radar Healthcare](https://radarhealthcare.com/) | 15, 25 | Quality events, CAPA and inspection metadata | Trace a real incident to a changed practice at a second site and sample whether recurrence was prevented. |
| 22 | [Quality Compliance Systems (QCS)](https://www.qcs.co.uk/faq/who-do-we-provide-policies-and-procedures-for/) | 11, 13 | UK source research and editable SOP starters | Commission maintained care-sector procedures for the relevant UK nation and test withdrawal of an obsolete version. |

### Regulatory intelligence

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 23 | [CUBE RegPlatform](https://www.cube.global/products/regplatform) | 11, 12 | Territorial applicability and source-to-control tracking | Blind-test notices by nation, date and activity. Report missed applicable notices as well as false alarms. |
| 24 | [Corlytics / Clausematch](https://www.corlytics.com/solutions/regulatory-monitoring/) | 11, 13 | Change actions, controlled documents and external page revision monitoring | Time one notice through policy amendment and reapproval. Check a reviewer can reconstruct the originating text. |
| 25 | [Bloomberg Regology](https://regology.com/regulatory-change-agent) | 11 | UK source catalogue and applicability decisions | Distinguish proposal, final instrument and in-force provision on held-out cases split by UK territory. |
| 26 | [RegASK](https://regask.com/regask-expands-ai-agents-to-automate-regulatory-action-across-160-markets/) | 11, 24 | Change records, training and product-event intake | Test an authorised regulatory-information-system event against the resulting SOP, affected roles and reviewed evidence. |
| 27 | [Clarivate Cortellis](https://clarivate.com/life-sciences-healthcare/cortellis/) | 11, 24 | UK public sources and attributed research | Procure or license the relevant international biopharma content and check its scope, currency and permitted reuse. |
| 28 | [Enhesa](https://www.enhesa.com/solutions/ehs/compliance-intelligence) | 11, 20 | UK applicability decisions and identified sites | Have separate facilities assess a shared rule with different activities and explain opposite applicability outcomes. |
| 29 | [ERM Libryo](https://www.erm.com/products/erm-libryo/sites/) | 11, 20 | Obligations linked to owners and evidence | Maintain two site registers over an update cycle and measure incorrect assignments and review effort. |
| 30 | [Barbour EHS](https://barbour-ehs.com/news/introducing-the-new-barbour-ehs-platform/) | 11 | Retained source versions and change history | Have an EHS specialist reconstruct a UK manufacturer's requirement on a past date, including superseded text. |
| 31 | [The Compliance People](https://thecompliancepeople.co.uk/legislation-update-service/legal-register/) | 11 | Tailored obligation records with review evidence | Compare matched and irrelevant changes in one sector against an independently maintained legal register. |
| 32 | [LexisNexis Regulatory Compliance](https://www.lexisnexis.co.uk/products/regulatory-compliance) | 11, 12 | Source citations and reviewed obligation mappings | Establish editorial ownership and reuse rights, then score omitted, superseded and misinterpreted requirements. |
| 33 | [Norm](https://www.norm.ai/) | 12, 28 | Source-based answers and review handoffs | Measure resolution time for questions that need an accountable professional and confirm who accepts that work. |
| 34 | [Compliance & Risks C2P](https://www.complianceandrisks.com/wp-content/uploads/2023/11/Ultimate-Guide-To-Product-Compliance.pdf) | 11, 24 | Product-scoped evidence and versioned product events | Connect a product family and intended market to a dated requirement and its registration decision. |

### Quality and operations

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 35 | [Qualio](https://www.qualio.com/compliance-platform/document-control) | 14, 15 | SOP release, retraining and independent practical assessments | Follow one material SOP revision to all affected roles, including maintenance and cleaners. Sample late and failed checks. |
| 36 | [Veeva Vault Quality](https://www.veeva.com/wp-content/uploads/2023/07/Veeva-Product-Sheet-Vault-Quality.pdf) | 14, 27 | Exact-version review, attestation and audit records | Execute a customer-approved intended-use validation for a specific release, configuration and restore procedure. |
| 37 | [MasterControl](https://www.mastercontrol.com/uk/library/manufacturing/electronic-batch-records/) | 14, 24 | Versioned batch decision intake | Connect an authorised manufacturing system and reconcile a held and subsequently released batch to the source decision. |
| 38 | [Honeywell TrackWise Digital](https://www.honeywell.com/us/en/process-automation-technology/solutions/trackwise/pharmaceutical) | 15, 24 | CAPA effectiveness and incident evidence | Connect a laboratory investigation with original result and disposition, then have quality assess recurrence independently. |
| 39 | [Dot Compliance](https://www.dotcompliance.com/eqms/) | 14, 27 | Controlled release and reproducible engineering tests | Deliver a configuration-specific validation pack, run it with its intended users and record deviations and sign-off. |
| 40 | [Ideagen Quality Management](https://www.ideagen.com/solutions/quality/quality-management) | 15, 16, 25 | Supplier review, CAPA and field-inspection evidence | Follow a supplier inspection through correction, effectiveness review and a later failed or repeated finding. |
| 41 | [Scilife](https://www.scilife.io/product/qms-pharma) | 14, 15 | Versioned attestation and role-based training | Have the quality owner test signer identity, intended meaning, exact revision, supersession and retrieval. |
| 42 | [SimplerQMS](https://simplerqms.com/pharmaceutical-quality-management-system/) | 14, 26 | Quality release and trial evidence | Have a regulated customer approve intended use and execute the release and change-control protocol in its configuration. |
| 43 | [Ennov](https://en.ennov.com/solutions/regulatory/rim/) | 24 | Registration-event intake and product scope | Reconcile an actual licence renewal, jurisdiction, deadline and dossier version with the registration system. |
| 44 | [Greenlight Guru](https://www.greenlight.guru/platform) | 24 | Product evidence, change decisions and build provenance | Trace a device requirement in both directions through risk, design change, test and approved release. |
| 45 | [RegDesk](https://www.regdesk.co/) | 11, 24 | UK device sources and registration decisions | Connect a maintained market-registration feed and test one changed submission deadline against its owner. |
| 46 | [Ketryx](https://support.ketryx.com/hc/en-us/articles/35197205593997-How-does-Ketryx-validate-integrations) | 24, 7 | Standalone Jira issues and Azure DevOps builds pinned to a Git revision | Link the actual work item, test cases and signed release baseline. Reject a passed build from a different change. |
| 47 | [Eupry](https://eupry.com/solutions/monitoring/) | 25 | Logger CSV windows with sampling-gap, excursion and calibration checks | Reconcile a live vendor export or API with sensor ID, calibration certificate, timestamps, gaps and excursion review. |
| 48 | [TraceLink](https://www.tracelink.com/products/product-orchestration/serialization) | 24 | Product-event intake with external decision identifiers | Obtain an authorised serialisation or traceability feed and reconcile a shipment or recall to its pack identities. |
| 49 | [Nulogy / AuditComply](https://www.auditcomply.com/wp-content/uploads/2025/08/Case-Study-2025-Cranswick.pdf) | 25 | Criteria-based reviews and connected inspection metadata | Run an offline inspection with attachments and verify that resynchronisation preserves identity and chronology. |
| 50 | [FoodDocs](https://www.fooddocs.com/knowledge/how-to-connect-monitoring-tasks-with-hazards-in-your-haccp-plan) | 25, 15 | Versioned hazard and corrective-action records | Change a HACCP limit and show which checks become due, retaining both the prior limit and corrective records. |
| 51 | [SafetyCulture](https://help.safetyculture.com/using-safetyculture/inspections?page=3) | 25, 15 | Direct inspection read bound to its template, with completion date and archive status | Follow an actual finding to an assigned corrective action, evidence and independent closure. Verify access loss. |

### Supplier and customer assurance

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 52 | [Risk Ledger](https://www.riskledger.com/overview-active-supply-chain-security) | 16, 17 | Supplier identity and consent-bound second-tier records | Run two suppliers through consent, disputed relationships, expiry and withdrawal with real purchasing organisations. |
| 53 | [UpGuard](https://help.upguard.com/migration/en/articles/3764556-what-is-upguard-vendor-risk) | 17 | Corporate identity, public software indicators and assessment intake | License or connect an external posture feed and show how the supplier can dispute an attributed finding. |
| 54 | [Bitsight](https://www.bitsight.com/products/continuous-monitoring) | 17 | Versioned supplier assessment intake | Verify external signal provenance, observation date, scope and false attribution under a permitted data agreement. |
| 55 | [SecurityScorecard](https://support.securityscorecard.com/hc/en-us/articles/25923897052827-Third-party-risk-management-dashboard) | 17 | Scoped assessment and unknown coverage states | Show partial, missing and stale vendor coverage side by side against a licensed source inventory. |
| 56 | [ProcessUnity](https://www.processunity.com/third-party-risk-management-glossary/global-risk-exchange/) | 16, 17 | Consent-bound private supplier records and named buyer access | Have two authorised buyers reuse one assessment and test revision, dispute, expiry and withdrawal. |
| 57 | [Whistic](https://www.whistic.com/trust-catalog) | 18, 17 | Public trust discovery with named access requests | Have an external buyer find and request approved material, then verify access after withdrawal. |
| 58 | [Conveyor](https://docs.conveyor.com/docs/portal-questionnaires) | 19 | Workbook round trips, reviewed OCR and browser portal handoff | Run a consenting buyer's portal with conditional and repeated questions. Count edits and preserve human submission. |
| 59 | [Loopio](https://support.loopio.com/hc/en-us/articles/43547399918355-How-Can-I-Import-Project-Content-Using-the-Loopio-Extension-new) | 19 | Product-scoped answers, citations and reviewed exports | Round-trip a multi-product questionnaire and check every imported answer and citation after re-export. |
| 60 | [EcoVadis](https://support.ecovadis.com/hc/en-us/articles/115002531307-What-is-EcoVadis) | 17 | Supplier ESG assessment intake and provenance | Obtain consent and licensed scorecard data, then test revision, withdrawal and disclosure rights. |

### Enterprise GRC and specialist risk

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 61 | [ServiceNow Integrated Risk Management](https://www.servicenow.com/docs/r/governance-risk-compliance/audit-management/continuous-monitoring.html) | 8, 20 | Direct read of a selected ServiceNow incident, with ownership, inactivity and closure time | Reopen an incident in a customer instance and reconcile the audit trail. Bidirectional IRM issue updates still need a separate integration. |
| 62 | [OneTrust](https://www.onetrust.com/products/privacy-operations/) | 22 | Privacy evidence and specialist decisions | Connect an authorised data inventory and trace a processing activity into a reviewed assessment and change record. |
| 63 | [Optro (formerly AuditBoard)](https://optro.ai/blog/auditboard-is-now-optro) | 10, 20 | Audit periods, evidence packs and grants | Have an independent audit team trace a sampled control through programme-level reporting with a local exception. |
| 64 | [LogicGate Risk Cloud](https://help.logicgate.com/hc/en-us/articles/6822955323668-How-to-Run-a-Risk-Cloud-Quantify-Analysis) | 20 | Saved loss scenarios, assumptions and repeatable estimates | Compare sensitivity and calibration against independently modelled scenarios with a risk owner. |
| 65 | [Archer Evolv Compliance](https://explore.archerirm.com/contact-us-compliance-ai) | 11 | Versioned sources, change actions and owners | Benchmark obligation supersession and false-positive alerts against an independently maintained regulatory set. |
| 66 | [MetricStream](https://www.metricstream.com/innovations) | 10, 20 | Reusable control evidence and tracked exceptions | Roll up two entities with different evidence freshness and verify a failed local control remains visible. |
| 67 | [Diligent One](https://www.diligent.com/lp/the-diligent-one-platform) | 20 | Risk registers and exportable evidence | Have a director reproduce each material board-pack claim and see exposure that lacks current evidence. |
| 68 | [Workiva](https://www.workiva.com/uk/platform/grc-and-financial-reporting) | 20, 7 | Accounting connections, risk estimates and evidence exports | Reconcile a report line to its period, source transaction, control and approved change in a finance sandbox. |
| 69 | [IBM OpenPages](https://www.ibm.com/products/openpages/operational-risk) | 10, 20 | Source, obligation, owner and control records | Load-test cross-entity reassessment after a common obligation changes and preserve local accountability. |
| 70 | [6clicks](https://www.6clicks.com/platform/hub-and-spoke) | 10, 20 | Isolated workspaces and scoped evidence sharing | Exercise central inheritance, local overrides and revocation across a real group structure. |
| 71 | [Holistic AI](https://go.holisticai.com/) | 21 | Declared AI inventory, model-change intake and independent review | Discover an undeclared AI service from a permitted source and reconcile runtime use with the approved inventory. |
| 72 | [Credo AI](https://www.credo.ai/solutions/vendor-compliance) | 21, 17 | Model and vendor records linked to reviewed uses | Request evidence from a supplier, change the model version and show which prior use decisions need reassessment. |
| 73 | [SAP Access Control](https://help.sap.com/docs/SAP_ACCESS_CONTROL/dec918a76e1246d386c51be8e6ca5bc8/e15efebdfb20481b8d9e17ada8ba780d.html) | 8, 22 | Identity evidence, leaver verification and ticket state | Connect the ERP entitlement and role-conflict decision for the same identity, including a time-limited exception. |
| 74 | [NAVEX One](https://www.navex.com/en-us/platform/) | 22 | Restricted specialist attestations and internal quality events | Connect a confidential ethics provider using minimal case status and test access separation and retention. |
| 75 | [Riskonnect](https://riskonnect.com/en-gb/business-continuity-management-software/) | 22, 20 | Connected risk records and specialist attestations | Map one critical service to dependencies and demonstrate the recovery exercise met its stated objectives. |
| 76 | [TrustArc](https://trustarc.com/products/privacy-data-governance/assessment-manager/) | 22 | UK privacy research and permissioned assessment evidence | Connect a maintained privacy assessment and test ownership, reassessment and retention against a real change. |

### Existing stack and services

| # | Comparator and vendor source | Gap rows | RegPilot capability today | Remaining integration or test |
| ---: | --- | --- | --- | --- |
| 77 | [Microsoft Purview Compliance Manager](https://learn.microsoft.com/purview/compliance-manager-improvement-actions) | 7, 10 | Microsoft 365, Intune and evidence from non-Microsoft systems | Demonstrate one UK obligation using both Microsoft and independent evidence and time the buyer's effort. |
| 78 | [GDP Pharma Consulting](https://www.gdppharmaconsulting.co.uk/quality-management-support) | 14, 15, 26 | Controlled SOPs, role-specific practical training and CAPA | Have an independent Responsible Person assess a maintenance handover, staff competence and evidence retrieval. |
| 79 | [Citation Atlas](https://www.citation.co.uk/hr-software/) | 8, 26, 28 | Workforce leaver workflow and source-linked support | Time a real change from the buyer's HR system to access review and demonstrate the reduction in manual entry. |

Three original shortcuts were unavailable during retrieval. The table links to alternative first-party materials for Clarivate Cortellis, Compliance & Risks C2P and IBM OpenPages. The C2P document is an older product description. Commercial terms, connector availability by plan and independently measured competitor outcomes require separate confirmation.
