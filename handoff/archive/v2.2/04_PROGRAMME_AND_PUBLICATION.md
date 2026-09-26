# 04 — Programme view, FOIL pack and business/publication contracts

## The right expansion is a Programme view, not an LCOE-only module

The user's business need is broader than changing a scientific parameter: understand what the programme is trying to demonstrate, which studies/experiments support it, what remains uncertain, what budget assumptions are used, and which outputs can be prepared for Francis, internal planning, fundraising or a website.

Provide a generic Programme projection with optional domain packs. Proposed FOIL views:

- **Design**: families/cases, geometry/kinematics/pose refs, CAD/2D artifacts and candidate revisions.
- **Experiments**: hypotheses, input snapshots, campaigns, observables, fidelity, receipts and scientific limitations.
- **Economics**: native LCOE model/config/result refs; assumptions, scope, currency/year and sensitivity results.
- **Studies and questions**: bounded external study/claim summaries and Francis question refs with answer/decision provenance.
- **Business/funding**: programme objectives, milestone gates, funding scenarios, approved budget references and output briefs.
- **Applications/publication**: Streamlit, React website, reports, presentations, diagrams and their review/deployment status.

These are filtered projections of the common graph. A small non-FOIL project may only use Programme → Data → BI → Deliverables. Do not force wind concepts, fundraising or Mongo into every project.

## Economics is not fundraising, and neither is cloud cost

A unit CAPEX assumption is not a programme R&D budget. LCOE is not company valuation or a financing requirement. Cloud spend belongs to infrastructure cost controls, not implicitly to a turbine bill of materials. Funding target, requested amount, committed funding and received cash are distinct fields/states with source/asOf and currency. Unknown values are not zero and a hypothetical budget is not a supplier quote.

No accounting engine or investment-advice engine is required in DataPass. It can show native model inputs/results, contradictions, missing evidence, version comparisons and references to authoritative business systems. Any existing FOIL PM/business authority remains owner until an explicit migration is approved.

## Opt-in domain pack contract

A pack supplies a namespace/version, accepted native schema IDs, declarative form groups, units/help text, field provenance mappings, dependency facets, typed external validator/action references, output templates and brief sections. The generic core renders forms and manages candidates; the external FOIL kernel owns the computations.

No evaluated expressions, arbitrary JavaScript, Python imports, shell strings or remote plugin installation are permitted from a pasted pack. Executable adapters are separately installed/reviewed software, not data files. Their permissions and actual file/network access must be constrained independently.

For a selected case, fields should indicate whether they are reference facts, assumptions, computed values, user proposals or unsupported/non-coupled inputs. A parameter control must not imply the L0 model uses that parameter. Read-only references stay read-only. Field editing creates a detached candidate; validation failure leaves the accepted state unchanged.

The R0 source specifies three family geometries for nine scenario cases. Do not multiply CAD unnecessarily. Budget line items and CAD solids need an explicit many-to-many mapping where useful; matching their counts is not an engineering requirement.

## External PublicationBrief contract

The first business feature is **Prepare brief**, not **Auto-publish pitch deck**.

Required information:

| Category | Contract content |
|---|---|
| Purpose | Internal review, Francis questions, grant preparation, investor discussion, website brief, portfolio reconstruction |
| Audience | Named/internal/public; language and permitted distribution |
| Scope | Programme/case/architecture revision and exact source cutoff |
| Claims | Stable claim IDs, approved wording/value refs, basis (reported/assumption/modelled/measured/target), source refs, uncertainty and restrictions |
| Assets | CAD/chart/image references, byte hashes, rights, confidentiality and captions |
| Business context | Authoritative funding/budget/model refs with currency/year/scope and unresolved questions |
| Requested outputs | PPTX/PDF/DOCX/web content; presentation template/brand refs if authorized |
| Review | Missing approvals, stale inputs, owner, proposed next review; no implicit permission to distribute |

Export only what that audience may receive. A whole-source document containing confidential information cannot be made public by changing a visibility flag: create and approve a separate sanitized source projection first. Approved claims can still be stale after their model or assumptions change. Blocks with unsupported claims must be excluded or visibly labelled as questions/hypotheses.

The external AI or presentation tool returns an artifact manifest with brief hash, included claim/asset IDs, actual output files/hashes, build provenance and omissions. DataPass records it as a candidate deliverable. A separate review checks that the rendered document preserves qualifications and numbers. Merely matching the brief hash does not prove the AI used every claim correctly. Publication or sending to a recipient requires a distinct action/approval.

## React website as a contracted consumer

A website content brief is another PublicationBrief plus an App request, not a copy of the private programme database. Version the approved public text, localized content, images and model-derived claims separately from the website's implementation/build/deployment. The client application must not receive Mongo credentials, private source locators or raw unpublished financial assumptions.

The user can continue working in ChatGPT chat and GitHub. DataPass observes the resulting commit/CI/deployment refs and changed input/output contract. It does not need Codex, an agent or an embedded web IDE. Whether a site is static or uses an API, the boundary declares its allowed public projection and content schema.

## Acceptance examples

1. Change an economic assumption in a candidate; accepted revision stales LCOE and the dependent brief, not unchanged CAD.
2. Change geometry/pose; corresponding CAD/2D consumers become stale; original outputs remain recoverable.
3. Generate an internal review brief with model assumptions and exclusions intact.
4. Try public export of a confidential/unapproved claim; block it without auto-redaction-by-guessing.
5. Import an external PPTX/website artifact manifest; show 'output received, not publication-approved'.
6. Use the same brief/claim mechanism for a synthetic retail BI project without installing the FOIL pack.

No scientific, financing, business-approval or authority transition is performed by this specification pass.
