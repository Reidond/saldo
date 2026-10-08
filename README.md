# Saldo

A private, self-hosted personal finance workspace. Subscriptions are the first module; accounts, review proposals, and attachment boundaries are reusable for future modules.

The intended product, scope, open decisions, and current pause state are described in the [product specification](docs/PRODUCT-SPEC.md).

## Current status

Local implementation. Not deployed. Real AI requires an explicitly configured private inference bridge and user-controlled ChatGPT sign-in. No API key or paid API fallback is silently enabled. The app starts without personal records; the optional sample workspace contains synthetic examples only.

## Repository layout

Saldo is a [pnpm](https://pnpm.io) workspace that uses [Vite+](https://viteplus.dev) (`vp`) for development, builds, tests, linting and formatting, and the [Cloudflare CLI](https://developers.cloudflare.com/cf/) (`cf`) to build and deploy its Workers.

- `apps/api` (`@saldo/api`): the API Worker that authenticates the owner and serves `/api`. D1 migrations live in `apps/api/migrations`.
- `apps/web` (`@saldo/web`): the web Worker, React Server Components with SSR and the protected static assets. It calls the API over a service binding.
- `apps/bridge` (`@saldo/bridge`): the private AI bridge Worker and its Node container.
- `packages/domain` (`@saldo/domain`): framework-free schemas and finance logic shared by the apps.
- `scripts/ci`, `tests`: CI safety scripts and repository-level configuration tests.

Each app has its own `cloudflare.config.ts`. Contributor and agent conventions are in [AGENTS.md](AGENTS.md).

## Run locally

Requires Node 24.11+ (CI uses Node 24) or Node 26+. On Node 24, `corepack enable pnpm` provides the pnpm version pinned in `package.json`; otherwise install that pnpm version yourself. Then:

```sh
pnpm install
pnpm dev
```

`pnpm dev` serves the web app with synthetic, fictional data on localhost:5173; it is not a production authentication boundary. For backend development, apply the local migrations (`pnpm db:migrate`), then run `pnpm dev:api` (`cf dev` on localhost:8787). The API deliberately fails closed until Cloudflare Access verification is configured, even in development.

```sh
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm check
```

`pnpm check` runs everything CI runs: formatting, lint and type-aware checks (`vp check`), strict TypeScript, all tests and a `cf build` of every Worker. The bridge build also builds its container image, so it needs Docker. `pnpm format` applies the formatter.

## Data and review semantics

- Amounts can be unknown. Currency and cadence are explicit. No foreign-exchange conversions.
- Monthly equivalents are estimates by currency: annual /12, quarterly /3, weekly ×52/12. Unknown and one-time charges are excluded, as are non-active statuses.
- CSV imports and image/chat extraction produce proposals. Nothing is saved until the owner reviews and confirms.
- CSV accepts the inventory columns `service,plan,billing_provider,amount,currency,cadence,status,evidence_date,next_or_end_date,date_type,confidence_in_classification,source_urls,notes,last_checked,account,coverage`.
- A date is considered a renewal only if `date_type` explicitly identifies renewal. Cancellation/end dates are preserved as review warnings.
- Unicode-normalized service name + currency is a conservative duplicate key. Separate same-currency plans need distinct descriptive service names. Update proposals must identify an existing record.
- Saves use atomic D1 batches and a unique request ID for repeat submission protection. Database uniqueness independently prevents concurrent duplicate creation.
- Images are sent inline only to the configured private inference bridge when the user sends the message. They are not uploaded to public storage or committed to the repository. R2/attachment metadata schema is reserved for future owner-approved retention.

## Private Cloudflare deployment

See the [deployment guide](docs/DEPLOYMENT.md) and the [ChatGPT setup](docs/SIWC.md). Before exposing any instance, configure an owner-only Cloudflare Access application and its verified audience, issuer domain and subject. Access email headers alone are never trusted. The application verifies the signed Access JWT and exact owner subject on every protected request; all queries are scoped by subject.

This repository includes no tokens, account IDs, real subscriptions, imported screenshots, or private data. Keep configuration in Cloudflare secrets, the protected GitHub Environment and protected runtime storage. GitHub publication and private deployment are separate actions.

## Continuous delivery

GitHub Actions checks pull requests without production secrets and deploys with `cf` after successful `main` checks. The protected `saldo-production` Environment holds the owner-supplied token and identifiers. Database changes are additive-only and preceded by a verified D1 recovery point; existing secrets and domain routing are preserved. Details, and the tasks `cf` cannot do yet, are in the [deployment guide](docs/DEPLOYMENT.md).
