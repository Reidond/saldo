# Saldo

A private, self-hosted personal finance workspace. Subscriptions are the first module; accounts, review proposals, and attachment boundaries are reusable for future modules.

## Current status

Local implementation. Not deployed. Real AI requires an explicitly configured private inference bridge and user-controlled ChatGPT sign-in. No API key or paid API fallback is silently enabled. The app starts without personal records; the optional sample workspace contains synthetic examples only.

## Run locally

```sh
npm ci
npm run dev
```

Vite opens the synthetic/local UI on localhost:5173. The API proxy points at localhost:8787. A local UI is not a production authentication boundary. For backend development, build first, apply the local migration, then run `npm run worker:dev`. The Worker deliberately fails closed until Cloudflare Access verification is configured, even in development.

```sh
npm run build
npm test
npm run lint
npm run typecheck
```

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

See [deployment guide](docs/DEPLOYMENT.md) and [ChatGPT setup](docs/SIWC.md). Before exposing any instance, configure an owner-only Cloudflare Access application and its verified audience, issuer domain and subject. Access email headers alone are never trusted. The application verifies the signed Access JWT and exact owner subject on every protected request; all queries are scoped by subject.

This repository includes no tokens, account IDs, real subscriptions, imported screenshots, or private data. Keep configuration in Cloudflare secrets and protected runtime storage. GitHub publication and private deployment are separate actions.

## Cloudflare `cf` CLI

Use the isolated `deployment/` package to retain the protected Worker while Vite builds the frontend. Run `npm run cf:setup`, then `npm run cf:build:app`; the bridge build also requires Docker. See [the cf deployment guide](docs/CF-DEPLOYMENT.md) for verified behavior, private configuration, legacy Wrangler support and pending deployment checks. Do not run `cf init` in the root or bridge source directory.

## Continuous delivery

[GitHub Actions delivery](docs/GITHUB-DEPLOYMENT.md) checks PRs without production secrets and deploys the private bridge and app after successful main-branch checks. The protected `saldo-production` Environment holds the owner-supplied token and resource identifiers. Database changes are additive-only and preceded by a verified D1 recovery point; existing Access settings, secrets and domain routing are preserved.
