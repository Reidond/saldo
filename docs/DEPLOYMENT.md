# Deploying Saldo with the Cloudflare CLI

Saldo deploys to the owner's Cloudflare account with [`cf`](https://developers.cloudflare.com/cf/), the Cloudflare CLI. Wrangler is no longer a dependency; the few tasks `cf` cannot do yet are listed in [Gaps](#gaps-what-cf-cannot-do-yet). Every merge to `main` deploys through GitHub Actions. Creating resources, persistent OAuth access, accepting terms or activating a paid plan stay owner actions.

No account ID, resource ID, credential or private record belongs in the repository. Release builds read the account's identifiers from the protected GitHub Environment.

## Projects

Each deployable is its own `cf` project with a typed `cloudflare.config.ts`. `cf` and the Cloudflare Vite plugin are pinned in the `pnpm-workspace.yaml` catalog (`cf` 1.0.0-beta.13, `@cloudflare/vite-plugin` 2.0.0-beta.sha-52b0dc0e9, the 2.0 beta that `cf` uses).

| Directory     | Worker            | Contents                                                                                                                                                                                                                                                   |
| ------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`    | `saldo-web`       | The only public entry: React Server Components with SSR and the protected static assets (`runWorkerFirst`). Service binding `API` to `saldo-api`. Holds the custom domain (for example `saldo.sands.red`) behind Cloudflare Access.                        |
| `apps/api`    | `saldo-api`       | Elysia app: `/api` only. No route, custom domain, workers.dev or Preview URL, and no static assets. Reachable only through the web's `API` binding; it verifies the forwarded Access token again. D1 `DB`, R2 `FILES`, service binding `AI` to the bridge. |
| `apps/bridge` | `saldo-ai-bridge` | Private AI bridge: the `SaldoAI` SQLite Durable Object with one lite Container (`saldo-ai-bridge-saldoai`).                                                                                                                                                |

```text
Browser ─ Access (saldo.sands.red) ─▶ saldo-web ─ API binding ─▶ saldo-api ─ AI binding ─▶ saldo-ai-bridge ─▶ Container
                                       └ static assets            ├ D1 (DB)
                                                                  └ R2 (FILES)
```

All three build with Vite and the Cloudflare Vite plugin. `cf build` writes Build Output to `<app>/.cloudflare/output/v0/` (gitignored), and `cf deploy --prebuilt --mode production` uploads exactly that output. The bridge build also builds the Container image with Docker and records its local reference in the Build Output.

Every Worker keeps `workersDev: false`, `previewUrls: false` and observability off, and refuses to evaluate for a Worker Preview. No configuration declares routes or custom domains: those are owner-managed, and a release never moves them.

The repository root keeps a `cloudflare.config.ts` that throws. It is not a Worker; it stops `cf`'s automatic configuration from rewriting the workspace root. Run `cf` from an app directory, through that package's scripts.

## Commands

| Command                              | What it does                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                         | `cf build` for every Worker (the bridge also runs `vp pack` for the container bundle and needs Docker).                            |
| `pnpm deploy:check`                  | `cf deploy --dry-run --prebuilt --mode production` for every Worker. No credentials and no API requests. Run `pnpm build` first.   |
| `pnpm dev`                           | Web dev server (`vp dev`) with synthetic data on `127.0.0.1:5173`.                                                                 |
| `pnpm db:migrate`                    | Applies `apps/api/migrations` to the local D1 with `cf d1 migrations apply … --local --persist-to .cloudflare/state`.              |
| `pnpm dev:api`                       | `cf dev` for the API on `127.0.0.1:8787`, using that local D1. It fails closed (401) until Access settings are configured locally. |
| `vp run --filter @saldo/<app> types` | `cf workers types`: writes `.cloudflare/types/index.d.ts` from the configuration. The code keeps its own `Env` interfaces.         |

Never run `cf dev`, `cf build` or `cf deploy` in a directory without a `cloudflare.config.ts`: `cf` would configure the project itself and edit `package.json`, the lockfile, `.gitignore` and `vite.config.ts`.

## Release settings

`cf deploy` replaces every var that a version does not declare; there is no `keep_vars`. So the Access identifiers and the D1 database are part of each release build instead of being kept from the live Worker:

- `SALDO_RELEASE=production` switches `cloudflare.config.ts` to release mode. It then requires `SALDO_APP_ORIGIN`, `SALDO_ACCESS_TEAM_DOMAIN`, `SALDO_ACCESS_AUD`, `SALDO_OWNER_SUB` and `SALDO_D1_DATABASE_ID`, and refuses to build without them.
- Any other build uses local placeholders and no Access settings, so a stray deploy of it fails closed: every protected request is refused.
- Before anything changes, the deploy job checks that every live Worker already carries the same values: `saldo-api` and `saldo-web` once they exist, and the legacy `saldo` app Worker while it exists. A mistyped Environment value therefore stops the run instead of replacing a working Access configuration. To change one deliberately, update the live Workers and the Environment together.

Secrets (`AI_BRIDGE_SECRET`, `SIWC_STATE_KEY`, the SIWC import chunks) are not in the configuration. `cf` keeps a Worker's secrets across deploys.

## Secrets

Set secrets with `cf workers secrets bulk`, which takes a JSON Merge Patch file: a secret object sets a secret, `null` deletes it, and anything else is left unchanged. Keep the file owner-only and outside the repository, and delete it afterwards:

```json
{
  "secrets": {
    "AI_BRIDGE_SECRET": {
      "name": "AI_BRIDGE_SECRET",
      "type": "secret_text",
      "text": "<value>"
    }
  }
}
```

```sh
cd apps/bridge && pnpm exec cf workers secrets bulk --worker saldo-ai-bridge --file /private/path/bridge-secrets.json
```

Never pass a secret value as a command-line argument (`--text`, `--body`): it ends up in shell history and process listings. [docs/SIWC.md](SIWC.md) describes the AI bridge secrets.

## GitHub Actions delivery

The `Check and deploy Saldo` workflow checks every pull request and deploys after successful checks on `main` (also on manual dispatch from `main`).

### Checks (every pull request)

No secrets, variables or Environment. Pull requests from forks therefore run with nothing to leak.

1. Install the locked workspace with the pinned pnpm (Node 24 Corepack).
2. `pnpm run check`: format, lint and type-aware checks, strict types, every test, and `cf build` for every Worker, including the `linux/amd64` bridge image.
3. Require the additive-only migration grammar (`scripts/ci/migrations.ts`).
4. `pnpm run deploy:check`: `cf` validates each Build Output without credentials.
5. Smoke-test the bridge image that `cf build` produced, with no network and a synthetic secret (rejection paths only).

### Protected configuration

The GitHub Environment `saldo-production` is restricted to `main` and holds:

- Secrets: `CLOUDFLARE_API_TOKEN`, `SALDO_ACCESS_AUD`, `SALDO_OWNER_SUB`.
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `SALDO_D1_DATABASE_ID`, `SALDO_APP_ORIGIN`, `SALDO_ACCESS_TEAM_DOMAIN`.

Step environments, not the job, carry the secrets, and only the steps that need them get them. The audience and the owner subject are secrets so that GitHub masks them in public logs.

The owner-reviewed token needs Workers Scripts edit access (it creates `saldo-api` and `saldo-web` on the first deploy and reads settings, deployments, versions and custom domains) plus account-level Containers write and D1 write, with a short expiry. A permission failure stops the workflow; never broaden the token automatically. It needs no R2 write, DNS, route or custom-domain permission.

### Deployment (main only)

The deploy job runs in one concurrency group without cancellation, so a later push never interrupts a migration or a deploy. Each Worker deploys in its own step, in the order bridge, API, web: the web never binds to an API that is not there, and a failed step stops the ones after it.

1. Mask and validate the release settings.
2. Repeat the checks, and refuse a commit that is no longer the latest `main`.
3. Build every Worker in release mode, run `cf`'s dry-run validation and the image smoke test again.
4. `prepare`: verify each Build Output (production mode, Worker name, no workers.dev or Preview URLs, no routes or domains, exactly the approved bindings, assets only on the web with `runWorkerFirst`, the unchanged Durable Object and Container), scan uploaded code and assets for the token and identifiers, verify the live Workers' private settings and identifiers, and take a D1 Time Travel recovery bookmark. The pre-migration time goes to the run summary; no database contents leave Cloudflare.
5. `migrate`: `cf d1 migrations apply <DATABASE_ID> --dir migrations`. On failure the run stops; recovery is a deliberate owner action with the recorded time.
6. `deploy bridge`, `deploy api`, `deploy web`: `cf deploy --prebuilt --mode production --no-provision` (the bridge with `--containers-rollout immediate`), tagged with the commit, run and attempt. `--no-provision` means a release never creates resources. Each version also records a hash of its Build Output (for the bridge, of the image's sources). A Worker whose active version already has that hash is skipped, so the bridge only rolls out when it changed, and a re-run of the same commit redoes nothing that already succeeded. After each deploy, the new version must be the one serving all traffic.
7. `verify`: compare live bindings with the snapshot (pre-existing secrets and the Durable Object namespace survive) and with the release, and run the smoke checks below.
8. `record` (always, even after a failure): the job summary lists the commit, the tag and each Worker's outcome (`deployed`, `unchanged`, `failed`, `not attempted`) and active version. A run where some Workers changed before a failure is marked partial, and the job fails.

A failed check after deployment is not rolled back automatically; database and Container changes can need deliberate recovery.

### Smoke checks

- Anonymous `GET /` and `GET /api/status` on the app origin get the Access login redirect (to the team domain) or 401.
- `saldo-api`, `saldo-web` and `saldo-ai-bridge` have workers.dev and Preview URLs disabled, and their workers.dev URLs answer 404.
- `saldo-api` and `saldo-ai-bridge` have no custom domain. The app hostname is served by `saldo-web` or, until the cutover, by the legacy `saldo` Worker, which the summary reports as pending. Workers routes are zone-level and never deployed: no configuration declares one.
- Before upload, no Build Output file other than binding metadata contains the API token, the Access audience or the owner subject, and no `.dev.vars`, `.env`, key or secrets file is uploaded.

### Roll back one Worker

Each Worker rolls back on its own. Find the previous version, then send all traffic to it:

```sh
cd apps/web   # or apps/api, apps/bridge
pnpm exec cf workers deployments list --worker saldo-web
pnpm exec cf workers deployments create --worker saldo-web --strategy percentage --versions '[{"version_id":"<previous version>","percentage":100}]'
```

Versions carry the release tag (`<commit>-<run>-<attempt>`), so each version's commit is known. Roll back the web before the API when the API's contract changed. A rollback past a secret change needs `--bypass-deployment-checks`. The bridge cannot roll back past a Durable Object lifecycle change; roll it back only to a version deployed with `cf`. D1 has no per-Worker rollback: migrations are additive, so older versions keep working, and `cf d1 time-travel restore` to the recorded pre-migration time is a deliberate, destructive owner action. The next merge to `main` deploys whatever `main` holds, so fix forward or revert there too.

## Moving production to saldo-web and saldo-api

Before this change, one Worker, `saldo`, served the pages, the assets and `/api` on `saldo.sands.red`. The cutover moves the hostname to `saldo-web` without downtime and without an unprotected moment:

- Cloudflare Access protects the hostname, not a Worker, so the Access application keeps protecting every path while the hostname changes Workers. Both new Workers also verify the Access JWT themselves.
- The first deploy creates `saldo-api` and `saldo-web` next to `saldo`. Neither has a route, a domain or workers.dev, so production traffic stays on `saldo` until the owner moves the hostname.
- Moving a Workers custom domain switches its origin in one step; the DNS record stays the same.
- `saldo` and `saldo-api` share the D1 database. Migrations are additive, so `saldo` keeps working, and moving the hostname back is the rollback.

Steps:

1. Before merging: fill the Environment (see [Protected configuration](#protected-configuration)) with values equal to the live `saldo` Worker's, and confirm the token can create Workers.
2. Merge. The run deploys the bridge with `cf` for the first time (same Durable Object namespace and Container application), creates `saldo-api` and `saldo-web`, and reports the cutover as pending.
3. Move the domain: Cloudflare dashboard → Workers & Pages → `saldo-web` → Settings → Domains & Routes → Add → Custom domain `saldo.sands.red`, and confirm moving it from `saldo`. (`cf` has no command for Workers custom domains yet.)
4. Verify as the owner: sign in through Access, load the overview and a subscription, and check that saving works. Anonymous requests still get the Access login.
5. Re-run the workflow from `main` (manual dispatch). Every Worker reports `unchanged`, and the summary says the web serves the hostname.

Roll back the cutover by moving the custom domain back to `saldo`. Keep `saldo` until the new Workers have run in production for a while. Deleting it (`cf workers delete`) is a separate owner decision; it does not delete the D1 database or the R2 bucket.

## Gaps: what `cf` cannot do yet

`cf` is in beta. Each gap below keeps the minimum Wrangler (none installed) or works around it:

| Gap                                                                                                                             | What Saldo does                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live logs.** `cf` cannot stream logs.                                                                                         | Observability is off. For an incident, the owner runs `npx wrangler@4.149.0 tail <worker>` once (its own login); Wrangler is not a dependency and CI never uses it.                                                               |
| **Single secrets.** `cf` has no `wrangler secret put` (no value from standard input).                                           | `cf workers secrets bulk --file` with an owner-only JSON file (see [Secrets](#secrets)). `cf workers secrets update <name>` prompts for one value interactively; never pass `--text`.                                             |
| **No `keep_vars`.** A deploy drops vars it does not declare.                                                                    | Release builds declare them from the protected Environment, checked against the live Worker first.                                                                                                                                |
| **Containers and Durable Object migrations** are not converted by `cf migrate`.                                                 | Written by hand: `defineContainer` (keeping the existing application name), `exports.durableObject({ storage: "sqlite", container })` for the live `SaldoAI` class instead of the `v1` migration, and the top-level `containers`. |
| **The Vite plugin 1.x needs Wrangler** as a peer dependency.                                                                    | All Workers use the 2.0 beta that `cf` uses, which has no Wrangler dependency. Both betas are pinned exactly.                                                                                                                     |
| **`cf` runs `npx vite build`** when a package declares `vite`, downloading an unlocked Vite.                                    | No Worker package declares `vite`; `cf` then uses the plugin's `cf-vite`, which resolves the workspace's Vite+ core. `tests/deployment.test.ts` enforces this.                                                                    |
| **`cf dev` forbids code generation**: it evaluates the Worker inside a runner object.                                           | The API detects this and uses Elysia's dynamic handlers in development only; deployed Workers compile at startup as before.                                                                                                       |
| **No platform proxy** like Wrangler's `getPlatformProxy()`.                                                                     | API tests start a local D1 with Miniflare 5, the runtime under `cf`.                                                                                                                                                              |
| **Custom domains in non-interactive deploys.** `cf deploy` in CI silently moves a configured custom domain from another Worker. | No configuration declares domains; moving a domain is an owner action.                                                                                                                                                            |
| **No custom-domain command.** `cf` cannot list, attach or move Workers custom domains.                                          | The owner moves the domain in the dashboard once (see the cutover). CI reads domains through the API to check them.                                                                                                               |
| **Previews** cannot run Durable Object Containers.                                                                              | Every configuration refuses Worker Previews.                                                                                                                                                                                      |

## First-time setup (owner)

1. Publish only this audited source. Never commit inventory CSVs, screenshots, `.dev.vars`, `.env`, token stores or Environment values.
2. Sign in with `cf auth login` (`--no-browser` on a remote machine). `cf` keeps its own credentials.
3. Create the D1 database and the private R2 bucket `saldo-private`, and confirm costs. Releases never provision resources.
4. Configure an owner-only Cloudflare Access self-hosted application for the hostname (for example `saldo.sands.red`). Protect all paths, allow only the owner, add no bypass. Keep the binding cookie off and the SameSite setting at Lax or None.
5. Fill the `saldo-production` Environment (see [Protected configuration](#protected-configuration)). `SALDO_OWNER_SUB` is the verified subject of the owner's Access session, not an email.
6. Set the bridge and AI secrets ([docs/SIWC.md](SIWC.md)), then merge to `main`. Verify that unauthorized requests get 401 or the Access login before loading private records.

## Release checklist

- [ ] Build, lint, type checks, unit tests and browser smoke tests pass.
- [ ] Real production Access login and owner subject verified.
- [ ] Unauthenticated and other-account access denied, including asset and API paths.
- [ ] D1 migrations applied to the intended private database; R2 bucket has no public access.
- [ ] SIWC OAuth bootstrapped by the user; encrypted store and stable host identity survive restart.
- [ ] Refresh-token rotation tested under concurrency and interrupted network requests.
- [ ] Request and response bodies, tokens and financial records excluded from logs and tracing.
- [ ] Same-origin/CSRF behavior, duplicate imports, repeated saves and interrupted image requests tested.
- [ ] D1/R2 backup, export and deletion policy selected by the owner.
- [ ] Actual account costs and quotas checked, and any new paid commitment approved.

Until these are checked, treat the deployment as an unverified development build, not a production-ready financial record system.

## References

- [cf for Wrangler users](https://developers.cloudflare.com/cf/wrangler/), [Migrate a Wrangler project](https://developers.cloudflare.com/cf/wrangler/migrate/), [Wrangler to cf reference](https://developers.cloudflare.com/cf/wrangler/reference/)
- [Develop, build, and deploy](https://developers.cloudflare.com/cf/projects/), [Programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/), [Use cf in CI](https://developers.cloudflare.com/cf/ci/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Bulk secrets API](https://developers.cloudflare.com/changelog/post/2026-06-03-bulk-secrets-api/)
