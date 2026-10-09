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

`apps/api` is an [Elysia](https://elysiajs.com) app on Elysia's Cloudflare Worker adapter. It is split into strict layers. `apps/api/tests/architecture.test.ts` fails on any import or SQL that crosses them. The HTTP contract, tests and configuration are documented in [apps/api/README.md](apps/api/README.md).

1. **HTTP handlers** (`src/http/routes/*`, with guards in `src/http/context.ts`). Each handler reads and validates input, takes the authenticated `actor` from the guard, calls one service method, and returns `json(...)`. Errors are thrown and mapped in one place, `src/http/errors.ts`. Handlers never import `repositories/*` or `infrastructure/*`, never touch D1 or SQL, and hold no business logic. Read bodies only with `readBody` (it enforces the upload limit after authentication). Never use Elysia's `body`.

   ```ts
   app.post("/api/review", async ({ request, scope, actor }) => {
     const review = reviewSchema.parse(await readBody(request));
     return json(await scope.services.reviews.apply(actor, review));
   });
   ```

2. **Services** (`src/services/*`). There is one class per business capability: `IdentityService`, `SubscriptionService`, `ReviewService` and `ChatService`. Each use case is a method that takes the `Actor` it acts for. Services hold the business rules, compose repository functions, and own transactions (`db.batch`). They receive every dependency through their constructor: `db`, the repository functions, `Clock`, `IdGenerator`, `AccessTokenVerifier` and `AiProvider` (ports in `src/services/ports.ts`). They import repositories only as types, so tests can pass the fakes in `tests/support/fakes.ts`. Business outcomes are error classes in `src/services/errors.ts`. Only the chat service may depend on `AiProvider`; manual workflows must keep working when AI is disabled.

   ```ts
   await db.batch([
     repos.insertReviewStatement(db, actor.accountId, review.requestId),
     ...changed.map((s) => repos.upsertSubscriptionStatement(db, row(s))),
   ]);
   ```

3. **Repositories** (`src/repositories/*`). This is the only code that contains SQL. Each statement is its own named, exported and typed function that takes `db` first: `listSubscriptionsByAccount(db, accountId)` or `findUserByIdentity(db, identity)`. A write that services batch is exposed as a statement builder, `…Statement(db, row)`, that returns a `D1PreparedStatement`. Repositories map rows to typed objects and contain no business logic. Register new functions in `src/repositories/index.ts`.

   ```ts
   export function insertReviewStatement(
     db: D1Database,
     accountId: string,
     requestId: string,
   ) {
     return db
       .prepare("INSERT INTO reviews(account_id, request_id) VALUES (?, ?)")
       .bind(accountId, requestId);
   }
   ```

4. **Pure domain logic** (money, recurrence, validation, review rules) stays in `packages/domain`. Every layer may import it.

Infrastructure adapters (`src/infrastructure/*`) implement service ports: the jose Access verifier, the bridge and disabled AI providers, and the clock and ids. They may import service ports and errors, never HTTP or repositories. `src/worker.ts` is the composition root and the only module that reads `Env`. It builds the adapters and services for each request and hands them to the Elysia app, which is compiled once at startup.

More rules:

- **Fail closed.** Authentication accepts only a verified `Cf-Access-Jwt-Assertion` whose subject is exactly `OWNER_SUB`, and it never trusts email or other identity headers. Every account query is scoped by `actor.accountId`.
- **Migrations are additive.** `scripts/ci/migrations.ts` accepts only a small additive SQL subset. A new table also goes into the `deleteOrder` list in `tests/support/d1.ts`.
- **Tests.** Handler tests use fake services, service tests use the in-memory fakes, and repository tests run against the local D1 from `tests/support/d1.ts`. A change to the HTTP contract also updates `tests/http-contract.test.ts` and `apps/api/README.md`.

## Frontend (apps/web)

apps/web is its own Cloudflare Worker (`saldo-web`, `apps/web/wrangler.jsonc`): React 19 Server Components with streaming SSR through `@vitejs/plugin-rsc` and `@cloudflare/vite-plugin`, styled with Tailwind CSS v4. It stores nothing; all data comes from the API Worker over the `API` service binding. `vp build` writes the Worker to `dist/rsc` (SSR in `dist/rsc/ssr`) and the static assets to `dist/client`.

| Path                     | Contents                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/framework`          | RSC, SSR and browser entries, the RSC request protocol, client navigation. Keep app logic out of here.                                    |
| `src/server`             | Server-only code: `gate.ts` (runs first on every request), `access.ts`, `config.ts`, `context.ts`, `actions.ts`, route handlers, the API. |
| `src/server/api`         | The `ApiClient` interface, the service-binding client and the synthetic client. The only code that talks to the API.                      |
| `src/app/pages`, `shell` | Server components, one per screen, plus the app shell.                                                                                    |
| `src/app/client`         | `"use client"` components and the tab-only drafts store.                                                                                  |
| `src/app/ui`             | Server-safe primitives (no hooks) and class helpers, usable from both sides.                                                              |
| `src/lib`                | Pure logic shared by server and client: formatting, totals, issues, filters, form parsing, preferences.                                   |

**Request flow and security.** `src/server/gate.ts` runs before anything renders, static assets included (`run_worker_first`). It resolves the configuration and fails closed with a static 503 page when the `API` binding, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `APP_ORIGIN` is missing. It then verifies the Cloudflare Access JWT itself (RS256, issuer, audience, expiry, non-empty `sub`, `type: "app"`) and answers anything unverified with a static 401 page that holds no data. Only then does it create the request context. Server actions and `POST /chat/messages` require `Origin` to equal `APP_ORIGIN` and a bounded `Content-Length`. HTML gets a nonce-based CSP in production builds. Never render, log or return record contents outside an authenticated request.

**RSC boundaries.**

- Components are server components by default. Add `"use client"` only for interaction (forms with `useActionState`, the chat composer and attachment picker, review cards, filters, menus), and keep those components small.
- Server components read data with `getRequestContext().load.*` (memoized per request) and render failures with `attempt()` and `LoadError` from `src/app/pages/shared.tsx`; never let an API error throw out of a page.
- Pass server actions to client components as props from server components. Client components never import `src/server/*`, except types.
- Never export non-component values from a `"use client"` module for server code to use: constants shared with the server live in `src/lib` or `src/app/routes.ts`.
- Mark server-only modules with `import "server-only"`; the plugin then fails the build if the client imports them.

**Data access.** Only `src/server/api` calls the API, through the `ApiClient` interface. The binding client forwards the verified `Cf-Access-Jwt-Assertion` and an `X-Request-Id`, sends `Origin: APP_ORIGIN` on writes, never forwards cookies, and validates every response with zod (the `@saldo/domain` schemas). Its errors are `ApiError`s whose message is safe to show. Mutations are server actions in `src/server/actions.ts`, which return result objects instead of throwing and call `invalidate()` after writing. Chat is a route handler so the browser can cancel it. Review saves are idempotent per `requestId`: a retry reuses it and an edit replaces it.

**Development and tests.** `pnpm dev` serves synthetic, fictional data from the in-memory `SyntheticApiClient`. The dev server sets `SALDO_DATA_SOURCE=synthetic`, and the runtime refuses that value outside a Vite dev server or a test, so production bundles don't contain the synthetic module. Set `SALDO_SYNTHETIC_AI=unavailable` to see the AI-unavailable state, and `SALDO_SYNTHETIC_SCENARIO=empty` or `api-down` to see the empty and error states. Tests in `apps/web/tests` call server modules directly with a synthetic or recording client (`server.test.ts`, `actions.test.ts`, `lib.test.ts`) and render client components in jsdom with a `NavigationContext` provider (`ui.test.tsx`). Vitest loads only `@vitejs/plugin-react`, and aliases `server-only` to a stub.

**Tailwind tokens.** `src/styles.css` defines semantic tokens once for light and dark mode (dark follows the system): `canvas`, `surface`, `surface-hover`, `surface-sunken`, `ink`, `ink-muted`, `ink-faint`, `line`, `line-strong`, `brand`, `brand-soft`, `warn-*`, `danger-*`, `info-*` and `chart-1`…`chart-6`, plus the `shadow-card`, `shadow-card-hover` and `shadow-pop` shadows and the `ease-out` and `ease-snappy` curves. Use these, never raw palette colors or hex values. Build buttons and fields with `buttonClass`, `inputClass` and `selectClass` from `src/app/ui/styles.ts`.

**Design rules** (from the owner's better-ui and emil-design-eng guidance):

- **Mobile first.** Every main action works at 375px without horizontal scroll. Tables become cards below `md`. Controls are 44px tall on phones and 40px from `sm`, and text inputs use 16px text on phones.
- **Surfaces.** Raised surfaces use a shadow ring rather than a border, and borders are only for dividers. Radii are concentric: a 16px card holds 8px rows with an 8px inset.
- **Motion.** Transition named properties only (never `transition: all`). Use 150ms `ease-out` for hover and color. Pressable controls scale to `0.96` on `:active`, under `motion-safe`. Use `@starting-style` (`starting:`) for enter states. An icon swap cross-fades with scale 0.25→1, blur 4px→0 and opacity using `ease-snappy`. Never animate navigation or keyboard actions. Every state also has a non-motion cue.
- **Icons.** One library (lucide). Use `absoluteStrokeWidth` with 1.5 next to regular text and 2 next to medium or semibold text.
- **Numbers.** Money is `tabular-nums` and formatted per native currency. Never add currencies together. Date-only values never shift with timezone.
- **Honesty.** Every list and screen has explicit empty, loading, error and AI-unavailable states. Unknown values say "Unknown" or "Not confirmed". Copy never implies AI is connected, or that tracking cancels anything.

## Deployment

<!-- Filled in by the deployment layer. -->
