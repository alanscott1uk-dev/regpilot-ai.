# Competitor benchmark — 6 November 2026

This is a review of documented vendor capabilities, not an independent hands-on performance test. It does not establish that RegPilot matches or exceeds any vendor.

| Vendor and primary reference | Documented capability | RegPilot improvement in this batch | Remaining gap |
| --- | --- | --- | --- |
| [Vanta guided flows](https://help.vanta.com/en/articles/16055560-vanta-agent-guided-flows) | Guided AI workflows, role-aware actions and control/evidence suggestions | One source-to-decision inbox, explicit review checks, evidence availability | No broad operational integrations or validated agent execution |
| [Sprinto AI overview](https://docs.sprinto.com/sprinto-ai/overview) | AI workflows for policies, vendor documents and repetitive work | Saved organisation context and explainable source/document quotation matching | No autonomous collection, vendor review programme or production evaluation |
| [Drata custom control mapping](https://help.drata.com/en/articles/16791453-ai-assisted-custom-control-mapping-to-grc-objects) | AI suggestions linking controls to framework requirements, policies, risks and evidence, with accept/dismiss review | Reusable control themes with matched words and evidence requirements; independent accept/dismiss | Theme suggestions are not semantic mapping or validated framework equivalence |
| [CUBE obligations management](https://www.cube.global/products/regplatform/obligations-management) | Unified extracted obligations, applicability, ownership and audit history | Immutable source/profile-bound analyses, decisions, task links and stale-context blocking | Small manual GOV.UK catalogue; no broad licensed regulatory corpus or legal ontology |

The practical differentiation to pursue is a low-friction UK SME workflow with inspectable evidence and transparent uncertainty. This batch improves that foundation. Coverage, integration breadth, semantic accuracy, live reliability, accessibility and cost must be measured before making superiority claims.

Next meaningful engineering benchmarks: a labelled UK multi-sector extraction corpus (precision/recall including exceptions and territorial scope), real-provider staging acceptance, tenant isolation under browser sessions, queue retry/lease testing for scheduled monitoring, cross-framework mapping review by domain specialists, and task completion time with non-technical users.

## 7 November development update — measurable progress, no superiority claim

| Competitive requirement | New implementation | What the tests establish | Still unproven |
| --- | --- | --- | --- |
| Reliable recurring work | Durable schedules, atomic leases, pause fencing, retries, failure visibility | Duplicate workers cannot both claim a due schedule; stale workers cannot write after pause; failures do not overwrite success timestamps | Hosted uptime, backlog capacity and scheduler operation |
| Semantic obligation understanding | Structured AI interpretation of subjects, actions, exemptions and conditions | Mock SDK adapter works; unsupported quotations and unknown control IDs are withheld/rejected; concurrent requests make one provider attempt | Live-model precision/recall, omitted exceptions, territorial accuracy |
| Change-to-action traceability | New source versions surface earlier accepted tasks and evidence attachments | Tenant-filtered source-hash changes identify existing work without silently changing approval or completion | Real user benefit, source coverage and legal impact accuracy |
| SME simplicity | Monitoring status and interpretation details inside the existing inbox | Production compilation and gated HTTP/page rendering | Timed usability study, visual/accessibility QA and successful onboarding of independent reviewers |

Release measurements should include expert-labelled extraction precision/recall (including exceptions and implicit duties), incorrect deadline/applicability rates, evidence-collection coverage, monitoring latency and missed-check rates, cost per organisation, and owner task-completion time. Results from mock providers must not be reported as live-model accuracy or as a head-to-head win over a competitor.

Detailed scope, safeguards and remaining release gates: [monitoring and semantic analysis](monitoring-and-semantic-analysis.md).

## Evidence-assurance upgrade — 7 November

The next implementation closes a specific weakness in RegPilot's old completion logic: an approved attachment was sufficient even without a content-level link to the requirement. Source-linked tasks now require a separate, current, scoped evidence assessment.

| Benchmark dimension | Implemented capability | Verification boundary |
| --- | --- | --- |
| Document understanding | Real bounded PDF text extraction with page anchors, coverage limits and ambiguity detection; AI Studio uses it too | Generated PDFs exercise the real parser. No OCR, table fidelity or authenticity validation |
| Evidence assessment | Requirement-level AI checks, exact page citation validation, policy-versus-implementation prompt, independent scoped decisions | Model adapter/grounding tested with mocks; real semantic precision and recall still unmeasured |
| Evidence reuse | Reuse one stored file across tasks with independent scope decisions; changes invalidate each use | Tenant isolation, shared-file revision and completion-gate tests |
| Living review record | Source/profile/evidence/expiry and adverse-finding checks invalidate old assurance | Database integration tests, including bytes changed after approval |
| Inspection support | Export source, evidence hashes, selected quotations, human rationale and current/stale state | Export hash and authorisation checked; not a digitally signed certification |

These features address content-level assurance and explainability. Superiority over Vanta, Sprinto, Drata or CUBE still requires comparable hands-on evidence of accuracy, collection coverage, task-completion time, uptime and cost. See [evidence assurance](evidence-assurance.md) for scope and activation boundaries.
