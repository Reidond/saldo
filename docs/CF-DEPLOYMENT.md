# Deploying Saldo with the Cloudflare `cf` CLI

The local migration uses `cf` 1.0.0-beta.13 and Wrangler 4.148.0. Legacy JSONC configurations remain unchanged. No account ID, credential or private record is included, and no deployment has run.

## Use the isolated deployment package

Saldo's web app (`apps/web`) builds the React frontend with Vite. The current `cf` beta detects a Vite package and runs only its client build, even with an explicitly migrated Worker config. That produces no Worker Build Output. This behavior was reproduced locally.

The small `deployment/` workspace package (`@saldo/deployment`) instead declares Wrangler as its build tool and selects either Worker with an explicit mode. A root `pnpm install` installs its pinned `cf` and Wrangler; keep its manifest limited to those two tools and free of build scripts so `cf` keeps treating it as a Wrangler project. Its app definition preserves the owner-authenticated entrypoint, `runWorkerFirst`, asset binding, D1/R2 bindings and disabled alternate public endpoints. Its bridge definition preserves the SQLite `SaldoAI` class and attaches one lite Container with the existing source-only Docker context.

The root and each app's `cloudflare.config.ts` files are protective guards. They prevent accidental automatic initialization in the wrong directory. Do not remove them and run `cf init .`: automatic setup ignores the existing Wrangler JSONC configuration.

```sh
pnpm install
pnpm run check
pnpm run cf:build:app
```

The app build runs the checked Vite production build of `apps/web` first, then `cf build --mode app` inside `deployment/`. It produces both the protected Worker and its static assets.

The bridge build requires a working Docker-compatible engine:

```sh
pnpm run cf:build:bridge
```

No package script deploys live traffic. `cf:check:app` and `cf:check:bridge` request dry-run validation only. The bridge check still needs Docker because its build prepares the image.

## Owner-authorized deployment sequence

1. Complete `cf auth login --no-browser` through the CLI's supported device authorization flow. `cf` and Wrangler have separate credential stores. Never copy tokens between them.
2. Confirm the intended account, plan and resource costs. Provision or select only approved private D1/R2 resources. Replace the app definition's D1 placeholder explicitly; do not rely on automatic resource provisioning. Set the intended app origin.
3. Configure owner-only Cloudflare Access before adding the custom domain. Preserve disabled `workersDev`, `previewUrls`, and observability in both Worker definitions. The app must retain all-request `runWorkerFirst`.
4. Review the bridge Container name against any existing deployment before changing it. Keep the existing `SaldoAI` SQLite namespace; do not add rename/delete/transfer declarations. An initial Durable Object lifecycle change must be deployed, not merely uploaded as a version.
5. Build and validate the bridge, then perform its separately authorized production deployment. Worker previews do not support Durable Object-managed Containers. Verify the actual image startup and rollout separately.
6. Apply D1 migrations with the explicit database ID and `--dir ../apps/api/migrations` from `deployment/`, using `--mode app`. The legacy `migrations_dir` field is not a new-config property.
7. Configure the app's private `AI` service binding and approved secrets. Use owner-operated SIWC credential setup; do not send tokens through chat or commit them. The `cf workers secrets bulk` API uses secret objects, whereas the existing Wrangler helper export is a string map: it is not a drop-in command substitution. Verify the exact CLI schema before an owner-operated secret import.
8. Build the app again, then perform its separately authorized deployment and custom-domain activation. Verify unauthorized and wrong-owner access is denied before importing confidential records.

Both modes share `deployment/.cloudflare/output/v0/`. A new build replaces that output. Always build the intended mode immediately before validation/deployment. A prebuilt deployment must specify the exact recorded mode (`app` or `bridge`); never reuse a bridge build for the app or vice versa.

Legacy Wrangler remains available by passing the original configuration explicitly, for example `pnpm exec wrangler dev --config apps/api/wrangler.jsonc` (or `pnpm dev:api`). Existing application/runtime code is unchanged by this migration.

## Verification and limits

- Installed beta types validate both cf definitions and their Wrangler build settings. The aggregate check passes 51 tests across 8 files, lint, strict TypeScript, Vite production build and both bridge compilation targets. Both dependency trees report zero known vulnerabilities.
- `npm run cf:build:app` completed successfully. Its Build Output was inspected: mode `app`, Worker bundle plus index/CSS/JS, correct bindings and private routing flags.
- Bridge local build reaches Wrangler but stops because Docker is unavailable in this environment. It has not produced a verified image.
- The app dry-run deployment step was cancelled by execution review; it was not repeated. No cf deployment validation or upload is claimed.
- After the pnpm/Vite+ workspace restructure, `pnpm run cf:build:app` and `pnpm run cf:build:bridge` were rerun locally with Docker and produced app and bridge Build Output, including the bridge image. No cf deployment or dry-run against Cloudflare was performed.
- Authentication and live deployment remain pending. Migration does not change the production-acceptance limits in [VERIFICATION.md](VERIFICATION.md).

## Official references

- [Develop, build, and deploy](https://developers.cloudflare.com/cf/projects/)
- [Migrate a Wrangler project](https://developers.cloudflare.com/cf/wrangler/migrate/)
- [Command and configuration mapping](https://developers.cloudflare.com/cf/wrangler/reference/)
- [Programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)

The CLI and configuration schema remain in beta; versions are pinned in the deployment package.
