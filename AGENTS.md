# Saldo agent guide

Saldo is a private, owner-only personal finance workspace (subscriptions first). The source is public under MIT; all data stays private. Production runs on the owner's Cloudflare account, and every merge to `main` deploys through GitHub Actions, so keep CI and deployment configuration correct. The intended product is described in [docs/PRODUCT-SPEC.md](docs/PRODUCT-SPEC.md).

Never commit secrets, tokens, account or resource IDs, `.dev.vars`, real financial records or screenshots. Tests and samples use synthetic data only.

## Repository layout

| Path              | Package             | Contents                                                                                                                                                                   |
| ----------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | `@saldo/api`        | Cloudflare Worker: owner authentication, `/api`, and the web build served as protected static assets. `wrangler.jsonc`, D1 migrations in `migrations/`, tests in `tests/`. |
| `apps/web`        | `@saldo/web`        | React client SPA built with Vite into `apps/web/dist`. Tests in `tests/`.                                                                                                  |
| `apps/bridge`     | `@saldo/bridge`     | Private AI bridge: Worker (`cloudflare.ts`), Node container (`container.ts`, `Dockerfile`), owner-run SIWC helper (`bootstrap.ts`), `wrangler.jsonc`.                      |
| `packages/domain` | `@saldo/domain`     | Framework-free schemas and finance logic (zod) shared by the apps, exported as TypeScript source.                                                                          |
| `deployment`      | `@saldo/deployment` | Isolated Cloudflare `cf` CLI build definitions. Its manifest lists only `cf` and Wrangler; keep it that way.                                                               |
| `scripts/ci`      |                     | CI safety scripts (additive-migration policy, deployment preflight and verification, image smoke test), run with plain `node`.                                             |
| `tests`           |                     | Repository-level tests for the CI workflow, CI scripts and deployment configuration.                                                                                       |
| `docs`            |                     | Product specification, deployment, GitHub delivery and SIWC guides.                                                                                                        |

## Commands

Run from the repository root:

| Command          | What it does                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm install`   | Install the workspace (CI uses `--frozen-lockfile`).                                               |
| `pnpm dev`       | Web dev server on `127.0.0.1:5173`; `/api` is proxied to `127.0.0.1:8787`.                         |
| `pnpm dev:api`   | `wrangler dev` for the app Worker. Run `pnpm build` and `pnpm db:migrate` first.                   |
| `pnpm build`     | Build every package that has a build: web assets and the bridge container bundle.                  |
| `pnpm test`      | Every Vitest project (all apps, packages and repository tests) in one `vp test` run.               |
| `pnpm lint`      | Oxlint with type-aware rules (`vp lint`).                                                          |
| `pnpm format`    | Format with Oxfmt (`vp fmt`).                                                                      |
| `pnpm typecheck` | Strict `tsc --noEmit` for each package plus the repository-level files.                            |
| `pnpm check`     | What CI runs: `vp check` (format check, lint, type-aware checks), typecheck, tests and all builds. |

Target one package with `vp run --filter @saldo/<name> <script>` (for example `vp run --filter @saldo/api test`), or run a built-in command in a package with `vp -C apps/web build`. Other root scripts: `preview`, `db:migrate`, `cf:build:app`, `cf:build:bridge`, `cf:check:app`, `cf:check:bridge`.

## pnpm and Vite+ conventions

- Use pnpm only. `packageManager` pins the exact version; CI enables it through Node 24's Corepack. Never add npm or yarn lockfiles.
- Declare every dependency in the package that imports it. Versions live in the `catalog` of `pnpm-workspace.yaml` as exact versions, and manifests reference them as `catalog:`. Internal packages use `workspace:*`.
- pnpm blocks dependency install scripts unless they are listed in `allowBuilds`, and it refuses versions younger than its minimum release age unless they are listed in `minimumReleaseAgeExclude`. Change either only deliberately.
- Vite+ (`vite-plus`, CLI `vp`) is the toolchain: `vp dev`, `vp build`, `vp test`, `vp lint`, `vp fmt`, `vp check`, `vp pack` and `vp run`. Do not add ESLint, Prettier, Vitest or a standalone Vite. The catalog aliases `vite` to `@voidzero-dev/vite-plus-core` for plugins that import it.
- Import test APIs from `vite-plus/test` and config helpers from `vite-plus`.
- `vp <name>` is always the built-in command; `vp run <name>` runs a `package.json` script. Package scripts call `vp`.
- Lint and format settings live only in the root `vite.config.ts`; use its `overrides` for package-specific rules. Each package's `vite.config.ts` holds only Vite, Vitest and pack settings. The root `test.projects` list picks up every app and package automatically.
- Type checking stays strict in two layers: `tsc --noEmit` per package (`tsconfig.base.json` is the shared base) and the type-aware lint in `vp check`. Both must pass.
- `@saldo/domain` is consumed as TypeScript source. Keep it free of React, Worker and Node APIs, and use `.js` extensions in its relative imports because the bridge container type-checks it under NodeNext resolution.
- The bridge container image runs one bundle produced by `vp pack` (`apps/bridge/dist/container.mjs`, with domain code and zod inlined). The Docker build context is the repository root, filtered by an allow-list `.dockerignore`; add a file there before the image needs it.
- CI and deployment configuration are covered by `tests/ci-*.test.ts` and `tests/deployment.test.ts`. Change the workflow, Wrangler configs, `deployment/` or `scripts/ci` together with those tests.

## Backend architecture (apps/api)

<!-- Filled in by the backend layer. -->

## Frontend (apps/web)

<!-- Filled in by the frontend layer. -->

## Deployment

<!-- Filled in by the deployment layer. -->
