# Saldo Personal Finance Manager

Product specification · 8 October 2026

Saldo is a private, mobile-first personal finance manager. Subscription management is its first useful feature: bring recurring payments into one place, understand upcoming renewals and costs, and add or update records by chatting or attaching a screenshot. The product should grow into other finance workflows as its owner defines them.

The intended experience is a hosted web application at saldo.sands.red, with a browser-native Sign in with ChatGPT connection that uses the owner's eligible ChatGPT plan for AI inference. This authentication and inference integration remains an external dependency; a local helper or a permanently running desktop is not part of the desired product. Until OpenAI approves the hosted flow, the owner has approved a one-time paired connect step from a computer as an interim exception (§7).

> **Current direction:** development is paused at the owner's request. This document preserves the full product idea for a future restart. It does not authorize new implementation, resource changes, paid services, or account access.

## 1. Product identity and ownership

- **Name:** Saldo
- **Repository:** Reidond/saldo
- **License:** MIT for the application source
- **Hosting:** the owner's Cloudflare account
- **Production address:** saldo.sands.red
- **Initial audience:** the owner only
- **First module:** subscription management
- **Long-term purpose:** one extensible home for personal financial information and useful AI assistance

Public source code must remain separate from private application data. The repository can be public without exposing subscriptions, screenshots, conversations, credentials, or financial records. Public code also does not by itself establish eligibility for a hosted ChatGPT authentication or inference integration.

## 2. Problem and outcomes

Subscription information is scattered across email receipts, app stores, websites, billing pages, screenshots, and memory. A payment receipt does not necessarily mean a subscription is still active. A cancellation does not necessarily mean access has already ended. Different currencies and billing intervals make totals easy to misread.

Saldo should make it easy to answer:

- Which subscriptions do I have, and which still need verification?
- What will renew next, for how much, and in which currency?
- What is my known recurring spend each month and year?
- Which account or billing platform manages a subscription?
- What changed after I uploaded a new screenshot or receipt?
- Which records may be duplicates, stale, canceled, or historical?

Success means the owner can add a subscription from a phone in under a minute when the evidence is clear, inspect every extracted fact before saving, and understand the limits of any total or recommendation.

## 3. Scope boundaries

### Required first release

1. Owner-only access to a hosted, responsive application.
2. Subscription list, subscription detail, renewal view, and spending overview.
3. Manual creation and editing.
4. Chat with image attachments for assisted extraction and updates.
5. A review step before AI-proposed data changes are committed.
6. Source provenance, duplicate review, and explicit uncertain states.
7. Reliable multi-currency and billing-period handling.
8. Browser-native ChatGPT connection with plan-funded inference, subject to official access and technical eligibility.
9. Export and recovery of the owner's data.
10. GitHub Actions checks and repeatable deployment of the entire application to Cloudflare.

### Outside the first release

- Bank connections, payment initiation, trading, or automatic transfers.
- Autonomous subscription purchasing, cancellation, or negotiation.
- Financial advice presented as professional advice.
- Multi-user organizations, household permissions, or commercial SaaS billing.
- Continuous inbox access without a separately approved integration.
- Automatic reliance on undocumented authentication endpoints.
- A permanently required local helper, desktop browser extension, or Mac background process. The one-time paired connect step in §7 is the approved interim exception.

The product should support later expansion without building all possible finance modules now.

## 4. Core user experience

### Onboarding

1. The owner opens Saldo and passes its owner-access gate.
2. The app explains where data is stored and how AI requests use supplied information.
3. The owner connects ChatGPT through the supported browser sign-in flow when that integration is available. In the interim, the owner uses the paired connect step from a computer (§7).
4. The owner chooses display currency, locale, and timezone.
5. They add a subscription manually, attach a screenshot, or review an explicitly imported candidate list.

Manual subscription management must remain available when AI is disconnected, unavailable, rate-limited, or not yet configured. The interface must never imply that a successful app login automatically enables AI inference.

### Add from a screenshot

1. Tap the attachment button in chat and choose an image.
2. Preview it, remove it if necessary, and optionally add instructions.
3. Saldo extracts candidate fields such as provider, plan, amount, currency, interval, renewal date, billing account, and status.
4. A review card shows proposed fields, missing information, source evidence, and possible duplicates.
5. The owner corrects the proposal and chooses Create, Update existing, or Discard.
6. Saldo saves the accepted change and records its source and time.

If one image contains several subscriptions, show separate candidates. If an amount or date is unreadable, ask for clarification or leave it unknown. Do not manufacture missing values.

### Chat with existing records

Examples of intended interactions:

- “Add this subscription.”
- “This is the new price for my existing plan.”
- “Show renewals in the next two weeks.”
- “Which subscriptions have an unknown next payment date?”
- “Mark this as canceled, with access until the end of the month.”
- “Show my recurring costs separately in each currency.”

Read-only questions can return results directly. Proposed record mutations must be presented clearly before saving. Any future action against an external provider requires its own explicit authorization and is outside the initial feature set.

### Main screens

- **Overview:** confirmed recurring costs, upcoming renewals, and records needing attention.
- **Subscriptions:** searchable, filterable list with status, amount, currency, interval, and next renewal.
- **Subscription detail:** current facts, source evidence, change history, billing location, and notes.
- **Chat:** conversations, image uploads, extraction progress, review cards, and failure recovery.
- **Review inbox:** uncertain candidates, possible duplicates, stale evidence, and incomplete imports.
- **Settings:** ChatGPT connection, display preferences, export, retention, and account controls.

On mobile, the main actions must remain reachable without horizontal scrolling. Tables should become readable cards or compact rows. Upload progress, empty states, disabled AI states, and errors must be explicit.

## 5. Subscription semantics

### Lifecycle and confidence are separate

Suggested lifecycle values are `active`, `trial`, `paused`, `canceled`, `expired`, and `unknown`. A canceled subscription may retain access until a known end date.

Separately track evidence state: confirmed, needs review, or historical evidence only. Old receipts must not silently become confirmed active subscriptions. “No new payment found” is not proof of cancellation or nonpayment.

### Billing fields

Each record should support:

- Provider and plan name
- Optional account label and billing platform
- Amount and currency
- Billing interval and interval count
- Optional trial end, next renewal, cancellation date, and access end
- Auto-renew setting, including unknown
- Category, tags, and owner notes
- Source links or attachments and last verified time
- Price history rather than destructive replacement of prior prices

Use decimal-safe money handling. Preserve the original currency and original evidence. Date-only renewals must remain date-only; avoid changing their calendar day through timezone conversion.

### Cost calculations

- Show native-currency totals by default.
- Normalize known recurring prices to monthly and yearly equivalents using a documented convention; clearly label these as estimates, not actual invoices.
- Keep one-time payments separate from recurring costs.
- Exclude uncertain amounts or statuses from confirmed totals and show how many records were excluded.
- Annual prepayments should appear as annual cash outflows and normalized monthly equivalents without being double counted.
- If converted totals are enabled, show the exchange-rate source, rate date, target currency, and estimate label.
- Do not sum mixed currencies without a stated conversion method.
- Distinguish expected renewal cost from historical amounts actually paid.

Calendar recurrence needs tests for month ends, leap years, annual billing, trial conversion, and cancellation with remaining access.

### Duplicate handling

Use provider, account label, plan, billing platform, amount, and evidence dates to suggest possible matches. Do not automatically merge merely because two records share a provider. A duplicate review must let the owner preserve distinct plans, update an existing record, merge selected evidence, or discard a candidate.

## 6. Data and provenance model

These are conceptual entities, not a mandated database schema.

| Entity              | Purpose and essential information                                                          |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Owner               | Identity mapping, preferences, locale, timezone, display currency                          |
| Subscription        | Provider, plan, lifecycle, billing details, renewal and access dates, verification state   |
| Price version       | Amount, currency, interval, effective date, linked evidence                                |
| Source evidence     | Source type, received or captured time, private reference, content hash, retention state   |
| Attachment          | Private object key, media type, size, upload state, owner, associated evidence             |
| Import candidate    | Extracted values, confidence or uncertainties, duplicate suggestions, review outcome       |
| Conversation        | Owner, messages, linked attachments, AI availability and request state                     |
| Change proposal     | Intended create or update, before and after values, review status                          |
| Audit event         | Actor, action, affected record, timestamp, and safe change summary                         |
| Provider connection | Provider identity, connection status, granted capabilities, expiry and revocation metadata |

Credentials belong in protected storage, never ordinary record fields, browser-readable data, chat logs, or audit payloads. Every data access must enforce ownership server-side.

## 7. AI and Sign in with ChatGPT

### Intended behavior

The owner signs in to ChatGPT inside the hosted web experience and authorizes the supported connection. Saldo then uses the capabilities actually granted to that integration for text and image understanding, with usage accounted for under the eligible ChatGPT plan as supported by OpenAI.

The app should disclose connection status, capability availability, usage-limit failures, and reconnection requirements. It must not silently substitute separately billed API inference or another AI provider.

### External dependency

A generic identity sign-in is not sufficient to promise inference access. The hosted website needs the appropriate official client registration, exact HTTPS callback, and approval or availability for plan-backed AI requests. These are unresolved prerequisites for Saldo's intended integration.

The official open-source token-sharing route and its loopback sign-in flow do not automatically provide an approved callback for a public hosted application. Making the source repository public is therefore insufficient on its own. The official interest form includes the option _Sign in and ChatGPT plan use for AI requests_; submitting interest is not a guarantee of access.

Reference documentation:

- Sign in with ChatGPT for websites
- Open-source token sharing overview
- [Open-source sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- OpenAI implementation article
- Official interest form

Provider requirements can change. Revalidate these prerequisites against official documentation before restarting implementation.

### Interim connection path

Owner decision, 8 October 2026.

Until OpenAI approves a hosted client, Saldo connects through a **paired local connect** that follows OpenAI's documented open-source sign-in and self-hosted credential-transfer procedure:

1. In Settings, the owner creates a short-lived, single-use pairing.
2. On a computer, the owner runs a small helper that completes OpenAI's loopback sign-in locally.
3. The helper encrypts the credentials to that pairing and hands them to Saldo.
4. From then on, the hosted runtime alone refreshes and uses them.

The step is needed only to connect or reconnect. Day-to-day use, including on a phone, needs no local software.

The hosted browser flow remains the target. The owner also asks OpenAI, through the interest form, to confirm that this interim pattern is acceptable, and will revisit the decision when OpenAI answers. The design is in [the ChatGPT connect plan](plans/chatgpt-connect-and-login.md).

### Integration architecture

Define an AI-provider boundary so extraction, chat, and review UI do not depend on a particular transport. The desired hosted ChatGPT provider implements that boundary when supported. In the meantime, the product must honestly show AI as unavailable and retain manual workflows.

If the approved integration requires a server-side bridge, treat it as a private implementation detail. Deploy it with the application, enforce narrow authentication, and prevent it becoming a general-purpose public AI proxy. A bridge is not permission to reuse unrelated credentials or circumvent provider eligibility.

### AI safety and reliability

- Treat screenshot text, receipts, and imported content as untrusted data.
- Ignore embedded instructions that ask the system to reveal secrets, change access, or perform unrelated actions.
- Validate structured outputs against schemas before creating a proposal.
- Use deterministic code for money calculations and recurrence.
- Send only the context needed for a request.
- Keep extraction provenance and uncertainty visible.
- Handle timeouts and retries without creating duplicate records or charges.
- Do not execute arbitrary code or external transactions from chat.

## 8. Cloudflare architecture

The owner permits use of Cloudflare services for the project. That flexibility is not an unlimited spending commitment or blanket approval for new persistent credentials.

A suitable proposed architecture is:

- **Web application:** responsive frontend served through Cloudflare.
- **Application API:** Cloudflare Workers with server-side authorization and validation.
- **Structured data:** Cloudflare D1 for subscriptions, evidence metadata, proposals, and audit history.
- **Private attachments:** Cloudflare R2, accessed only through authorized application routes or appropriately scoped temporary access.
- **Access protection:** Cloudflare Access and/or an application session layer, with owner-only enforcement throughout.
- **AI integration:** approved hosted ChatGPT flow and an optional private bridge only where technically required.
- **Background work:** queues or scheduled execution only for explicitly adopted workflows such as extraction jobs or renewal reminders.

A TypeScript monorepo is a reasonable implementation baseline, with shared validation and domain logic. Exact framework choices should follow the existing repository and be reviewed on restart rather than triggering an unnecessary rewrite.

Keep the domain model independent of Cloudflare bindings where practical. New finance modules should reuse ownership, money, evidence, imports, chat, and audit capabilities without requiring a speculative plugin framework.

## 9. Security and privacy

- **Public repository:** source, synthetic examples, documentation, and safe configuration only.
- **Private storage:** subscription inventory, financial details, screenshots, email evidence, conversations, and exports.
- No real financial records in fixtures, issues, screenshots, CI artifacts, or public deployment previews.
- No secrets in commits, frontend bundles, Docker layers, logs, or downloadable archives.
- Protect the main app, APIs, upload endpoints, and any bridge. Blocking only the homepage is insufficient.
- Enforce ownership even when Cloudflare Access already protects the perimeter.
- Use least-privilege deployment credentials and documented rotation/revocation procedures.
- Encrypt sensitive connection material using an appropriate managed mechanism and protect key access.
- Validate file type, size, and ownership; reject unsupported or malformed uploads safely.
- Define retention and deletion behavior for original images, conversations, exports, and derived evidence.
- Provide a usable export and a verified backup/restore procedure.
- Redact operational logs and keep request diagnostics useful without retaining financial content unnecessarily.

Connecting a mailbox, adding a provider, creating persistent credentials, or increasing paid resource usage must be handled as a distinct setup decision with the required approval. Do not ask users to paste API secrets into chat.

## 10. GitHub Actions development cycle

The requested workflow is a normal repository-driven development cycle for the whole application, including any required bridge.

### Pull requests

Run reproducible installation, linting, type checking, unit tests, domain tests, integration tests, production builds, and appropriate security checks. Test changes using synthetic data. Untrusted fork workflows must not receive deployment secrets or production data.

### Main branch deployment

After merge to the protected main branch:

1. Repeat required checks.
2. Build the web app, Worker, and any required bridge or container image.
3. Validate environment configuration and bindings.
4. Apply reviewed, backward-compatible database migrations in a safe order.
5. Deploy all changed production components to Cloudflare.
6. Run smoke checks that verify both availability and access protection.
7. Record the source commit, deployed versions, and run result.

Use deployment concurrency controls so competing runs do not corrupt rollout order. Keep staging or preview environments isolated if introduced. A failed component deploy must make the overall result visibly failed or partial; a successful frontend upload must not conceal a broken backend.

### Rollback and recovery

Retain known-good deployment versions, document component rollback, and design schema migrations so ordinary code rollback remains safe. Destructive migrations need separate review and backups. The workflow should be runnable again without duplicate infrastructure or data writes.

Deployment credentials belong in the appropriate GitHub and Cloudflare secret mechanisms. Choosing and authorizing the exact credentials is a setup gate, not a reason to publish them in this document.

## 11. Importing the initial inventory

A separate private email-based audit has identified 53 current and historical subscription candidates. This is a candidate inventory, not 53 confirmed active subscriptions, and it has not been imported into the application.

A future import should:

1. Validate its schema and preserve original source references.
2. Classify current, historical, uncertain, and canceled evidence.
3. Present duplicates and incomplete records for review.
4. Import only the owner-approved records.
5. Record the import batch and source provenance.
6. Be idempotent so retrying does not duplicate subscriptions.

No personal subscription details or account-specific source messages belong in the public repository or this product specification. An initial audit does not authorize ongoing inbox synchronization. A later mailbox integration needs explicit scope, provider setup, and retention decisions.

## 12. Acceptance criteria

The first release is ready only when these outcomes are demonstrated:

- The owner can sign in to the app; an unauthorized visitor cannot retrieve any private record, attachment, or chat content.
- The supported hosted ChatGPT connection completes and a real text-and-image inference request succeeds using the intended entitlement, or the release clearly remains an AI-incomplete milestone. A release whose AI depends on the interim paired connect (§7) must say so.
- A screenshot creates a reviewable proposal with accurate visible fields and explicit unknowns.
- Confirming a proposal creates or updates exactly one intended record; retrying does not duplicate it.
- Duplicate candidates can be resolved without losing source evidence.
- Manual CRUD works without AI connectivity.
- Canceled access, trials, unknown renewals, historical receipts, and price changes behave correctly.
- Native-currency totals are correct; converted or normalized totals disclose their assumptions.
- Month-end and leap-year recurrence tests pass.
- Chat cannot modify unrelated records or access another owner's data.
- Upload validation, prompt-injection cases, and unauthorized API calls are tested.
- An export can be produced and a backup can be restored in a controlled test.
- A change merged to main deploys the entire required stack through GitHub Actions and passes protected smoke checks.
- The owner completes the main workflows on a phone, including actual screenshot upload and review.

Passing automated tests is necessary but does not substitute for real owner-session, visual, authentication, and end-to-end validation.

## 13. Roadmap for a future restart

### Phase 0 — Resolve the hosted AI dependency

Confirm official hosted client eligibility, callback registration, plan-backed inference access, supported image inputs, and server-side credential requirements. Decide whether to wait if unavailable. Do not replace this requirement with a local helper without a new product decision. That decision was made on 8 October 2026 for the interim paired connect (§7); the hosted flow remains the target.

### Phase 1 — Establish the reliable subscription core

Review the existing application, complete owner sessions and authorization, verify manual data management, recurrence, multi-currency calculations, private storage, export, and full-stack deployment. Use synthetic data until these protections are verified.

### Phase 2 — Complete chat and screenshot entry

Integrate the approved AI provider, implement structured extraction and review, provenance, deduplication, connection status, and graceful failures. Validate with real owner-approved examples.

### Phase 3 — Review and import initial records

Privately review the candidate inventory, import approved records, and verify totals and upcoming renewals with the owner. Resolve uncertain records instead of forcing a complete-looking list.

### Phase 4 — Add the next owner-selected finance feature

Choose a concrete problem, define its scope and permissions, and extend the shared foundation. Do not treat speculative ideas as an approved backlog.

## 14. Possible later directions

The following are illustrative possibilities only. The owner will supply and prioritize future ideas:

- Expense and receipt tracking
- Budgets and category-level spending views
- Income and invoice records
- Savings goals and planned purchases
- Renewal reminders and price-change reviews
- Account-level summaries or net-worth tracking
- Carefully scoped financial-data imports

Each extension needs its own acceptance criteria, data requirements, privacy review, and authorization boundaries. Saldo should remain useful as a subscription manager even if none of these are added.

## 15. Open decisions

1. **Hosted ChatGPT eligibility:** can this application obtain the official website client and plan-backed inference access it needs? Still open; ask OpenAI through the interest form.
2. **Release boundary:** should a manual-only milestone be used while that dependency is unresolved? Decided 8 October 2026: no. Use the interim paired connect (§7), and label releases that depend on it.
3. **App identity:** what owner-session design should sit behind or alongside Cloudflare Access?
4. **Preferences:** which display currency, timezone, and locale should be the defaults?
5. **Retention:** how long should original screenshots and conversations be retained?
6. **Imports:** which candidate records should be accepted, and is ongoing email import wanted later?
7. **Reminders:** are notifications wanted, on which channel, and with which frequency?
8. **Operations:** what paid Cloudflare services and spending limits are acceptable?
9. **Future scope:** which finance problem should follow subscriptions?

These decisions should not block documenting or preserving the project. They do block making unsupported claims about readiness or taking consequential setup actions.

## Appendix — Implementation snapshot

As of 8 October 2026; distinct from the intended product above.

- Public repository: Reidond/saldo.
- Recorded main revision: `0ec17254a706ee2cbc0b08deb8e236d94bd7d0b5`.
- Recorded successful full-stack GitHub Actions deployment: run 37776471857, attempt 2.
- App and bridge/private-container infrastructure were deployed and protected with Cloudflare Access.
- Recorded checks include 158 automated tests and a Docker smoke test.
- No real AI provider is connected. The desired in-app Sign in with ChatGPT button is not implemented.
- The private subscription candidate inventory has not been imported.
- Owner-session end-to-end validation and visual QA are not verified.
- The deployed bridge/container approach is implementation history, not a requirement to retain it or a substitute for the requested hosted sign-in experience.

**Pause state:** no further development, deployment changes, or teardown is requested. Existing resources are not automatically removed and CI is not automatically changed by this pause. Restart only after the owner chooses to continue and the relevant unresolved decisions are addressed.
