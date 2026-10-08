# GitHub Actions delivery

The `Check and deploy Saldo` workflow checks pull requests and deploys both existing Workers after successful checks on `main`. It also supports manual dispatch from `main`. Fork/PR checks have no production Environment or Cloudflare token. No Cloudflare Builds connection, GHCR publishing, paid/larger runner or DNS management is used.

## Protected configuration

Use the GitHub Environment `saldo-production`, restricted to the `main` branch and no tags.

- Environment secret: `CLOUDFLARE_API_TOKEN`, entered directly by the owner.
- Environment variables: `CLOUDFLARE_ACCOUNT_ID` and `SALDO_D1_DATABASE_ID`.

The owner-reviewed token needs Worker Editor access limited to the existing `saldo` and `saldo-ai-bridge` Workers, plus account-level Containers Write and D1 Write. Those last two permissions are broader than Saldo alone. Use a short expiry and rotate/revoke it when appropriate. A permission failure stops the workflow; it must never silently broaden the token. There is no R2-write, DNS, Custom Domains or account-wide Worker-edit requirement merely to retain the existing bindings/routes.

Access origin, issuer, audience and owner subject are read from the current app settings and validated before deployment. They are not placed in public source. The workflow snapshots existing bindings privately in the ephemeral runner, masks existing string values, and deletes the snapshot/config on completion. It never reads OAuth vault contents or copies live secret values. Missing/unreadable Access settings stop deployment rather than inventing replacements.

## Delivery sequence

1. Run locked dependency installation, type checks, lint, tests, production asset build and bridge compilation.
2. Require the conservative additive-only migration grammar. Unsupported or destructive SQL is rejected. Always add a new numbered migration; do not edit already-applied migrations.
3. Build a `linux/amd64` image on the standard `ubuntu-latest` runner. Smoke-test it with no network and a synthetic bridge secret, checking rejection paths only.
4. In a serialized production job, repeat checks/builds, verify private live settings and disabled public alternate endpoints, and obtain a D1 Time Travel recovery bookmark. Record the pre-migration UTC time in the run summary. Database contents are never exported into GitHub or uploaded as artifacts.
5. Apply the numbered D1 migrations sequentially. On failure, stop; no automatic destructive restoration is attempted. D1 Time Travel recovery is an owner-controlled operation using the recorded pre-migration time and Cloudflare's retention window.
6. Deploy `saldo-ai-bridge` with the existing private JSONC configuration, one lite Container and its SQLite Durable Object. Existing bridge variables and secrets are retained.
7. Upload an immutable app version and switch traffic to that exact unique run tag. This avoids reapplying the existing custom domain or requiring DNS permissions. The app configuration contains the built assets and approved D1/R2/private bridge bindings, with all requests routed through authentication.
8. Compare live settings/binding identities with the snapshot, including pre-existing secret binding names and any existing Durable Object namespace ID. Confirm Workers.dev/preview endpoints are disabled and anonymous app access is blocked.

The app intentionally omits `vars` from its generated deployment config and uses `--keep-vars`. This avoids overwriting live Access identifiers. The pinned Wrangler implementation carries `plain_text`/`json` with that flag and preserves `secret_text`/`secret_key` by default. Both deployment actions use it; no action `secrets`/`vars` upload feature is used.

Production jobs use one concurrency group without cancellation. Later pushes cannot interrupt an in-progress migration/deployment. Avoid manual Cloudflare configuration edits during a deployment; unexpected changes cause verification to fail. A failed post-deployment check is not automatically rolled back, because database/Container changes can require deliberate recovery.

## Pinned tools and remaining acceptance

The official checkout, setup-node and Cloudflare Wrangler actions use full release commit hashes. Wrangler is pinned to 4.148.0 for deployment. Docker image construction still uses the repository Dockerfile; no production credential is passed into the image build or test container.

Local source tests do not prove a GitHub run or live rollout succeeded. This VM cannot run Docker, so the first Actions run verifies the actual image build. Owner login, live ChatGPT authorization, Container rollout/health and end-to-end inference remain separate acceptance checks. A healthy deployed bridge may correctly report disconnected until owner-operated SIWC setup is complete.

Sources: [Cloudflare GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [official Wrangler action](https://github.com/cloudflare/wrangler-action), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
