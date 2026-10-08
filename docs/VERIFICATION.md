# Verification report — 2026-10-08

This is a pre-release source deliverable, not a deployed or production-accepted service.

## Passed locally

- TypeScript strict checking for the frontend, main Worker, SIWC gateway and Node container targets.
- ESLint.
- Vite production build.
- 46 automated tests across 7 files.
  - Owner JWT signature/issuer/audience/expiration isolation and fail-closed asset/API behavior.
  - Same-origin mutation checks, bounded body reads, image encoding/signature validation and malformed extracted field rejection.
  - Currency-separated estimates, unknown values, CSV parsing, duplicate/update checks, real SQLite uniqueness and transaction rollback.
  - Encrypted vault integrity, serialized refresh, persisted interruption marker, import replay protection and stable VM identity.
  - Model allowlisting, namespaced structured proposals, complete versus interrupted SSE streams, and cancellation propagation.
  - Six DOM integration flows: disconnected saves; cancelled edits and sample isolation; CSV review and duplicate prevention; valid manual API records; repeated/interrupted chat; identical request IDs on uncertain-save retry.
  - Long chat context bounded to individual and total server limits.
- Main Worker deployment dry-run/bundling (no deployment).
- Bridge Worker-only dry-run with container rollout disabled (no deployment).
- Node bridge smoke checks using synthetic credentials: unauthorized requests 401, malformed requests 400, nonexistent route 404, no provider request.
- npm audit reports 0 known vulnerabilities including development dependencies at the time checked. The patched sharp override addresses the transitive Wrangler/Miniflare advisory.

## Not verified / blocked

- Desktop/mobile visual browser QA and screenshots. Local Chromium could not create required OS sockets in this execution environment, including after a reviewed escalation; the supported cloud browser could not reach executor localhost. It also rejected in-memory data URLs. No security restriction was bypassed and no public preview was deployed. DOM tests do not replace visual QA.
- Docker image build: Docker CLI/daemon unavailable. TypeScript output and Worker bundling do not prove a container image starts on Cloudflare.
- Live Cloudflare Access configuration, custom domain, D1/R2 resources, production migrations, and restart/load behavior.
- Live owner-operated ChatGPT OAuth grant, durable import, actual plan inference, and refresh behavior against OpenAI.
- Container memory/latency under production load. The configuration uses one lite instance, 5-minute sleep, a 12 MB body limit and a 7 MiB combined screenshot UI limit. Capacity is not benchmarked.
- GitHub publication and Cloudflare deployment: access/setup remain pending.

## Known functional limits

- Single-owner deployment. Simultaneous edits to the same record in multiple tabs do not have optimistic version conflict detection; avoid concurrent editing.
- Screenshot attachments are transient request inputs, not a retained document archive. R2 and attachment metadata are extension points.
- Demo records exist only in browser memory and reset on reload. They are synthetic and never seed the private ledger.
- AI suggestions require explicit review before a separate save; Saldo never purchases or cancels a service.

No actual subscription inventory, private screenshot, OAuth grant, account token or payment credential was included in the source or tests. The real inventory was not imported or deployed.
