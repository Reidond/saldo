# Deploying Saldo with the Cloudflare CLI

Saldo deploys to the owner's Cloudflare account with [`cf`](https://developers.cloudflare.com/cf/), the Cloudflare CLI. Wrangler is no longer a dependency; the few tasks `cf` cannot do yet are listed in [Gaps](#gaps-what-cf-cannot-do-yet). Every merge to `main` deploys through GitHub Actions. Creating resources, persistent OAuth access, accepting terms or activating a paid plan stay owner actions.

No account ID, resource ID, credential or private record belongs in the repository. Release builds read the account's identifiers from the protected GitHub Environment.

## Projects

Each deployable is its own `cf` project with a typed `cloudflare.config.ts`. `cf` and the Cloudflare Vite plugin are pinned in the `pnpm-workspace.yaml` catalog (`cf` 1.0.0-beta.13, `@cloudflare/vite-plugin` 2.0.0-beta.sha-52b0dc0e9, the 2.0 beta that `cf` uses).

| Directory     | Worker            | Contents                                                                                                                      |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`    | `saldo`           | Elysia app: owner authentication and `/api`. D1 `DB`, R2 `FILES`, service binding `AI` to the bridge.                         |
| `apps/web`    | `saldo-web`       | React Server Components with SSR and the protected static assets (`runWorkerFirst`). Service binding `API` to the API Worker. |
| `apps/bridge` | `saldo-ai-bridge` | Private AI bridge: the `SaldoAI` SQLite Durable Object with one lite Container (`saldo-ai-bridge-saldoai`).                   |

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
- Before anything changes, the deploy job checks that the live app Worker already carries the same values. A mistyped Environment value therefore stops the run instead of replacing a working Access configuration. To change one deliberately, update the live Worker and the Environment together.

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

The owner-reviewed token needs Workers Scripts edit access plus account-level Containers write and D1 write, with a short expiry. A permission failure stops the workflow; never broaden the token automatically. It needs no R2 write, DNS, route or custom-domain permission.

### Deployment (main only)

The deploy job runs in one concurrency group without cancellation, so a later push never interrupts a migration or a deploy.

Until the API and the web deploy as separate Workers, `prepare` stops the job before any change: the app Worker no longer serves the web build, and this pipeline does not deploy `saldo-web` yet.

1. Mask and validate the release settings.
2. Repeat the checks, and refuse a commit that is no longer the latest `main`.
3. Build every Worker in release mode, run `cf`'s dry-run validation and the image smoke test again.
4. `prepare`: verify each Build Output (production mode, Worker name, no workers.dev or Preview URLs, no routes or domains, exactly the approved bindings, the unchanged Durable Object and Container), scan uploaded code and assets for the token and identifiers, verify the live Workers' private settings, and take a D1 Time Travel recovery bookmark. The pre-migration time goes to the run summary; no database contents leave Cloudflare.
5. `migrate`: `cf d1 migrations apply <DATABASE_ID> --dir migrations`. On failure the run stops; recovery is a deliberate owner action with the recorded time.
6. Deploy the bridge (`--containers-rollout immediate`), then the app, with `cf deploy --prebuilt --mode production --no-provision`, tagged with the commit, run and attempt. `--no-provision` means a release never creates resources.
7. `verify`: compare live bindings with the snapshot (pre-existing secrets and the Durable Object namespace survive), re-check the private settings and that anonymous requests are refused.

A failed check after deployment is not rolled back automatically; database and Container changes can need deliberate recovery.

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
