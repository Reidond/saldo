# Deploying privately on Cloudflare

Deployment is not performed by these files. Placeholder resource IDs must be replaced by the owner. Creating resources, persistent OAuth access, accepting terms or activating a paid plan requires the owner's authorization.

1. Create a private GitHub repository or publish only this audited MIT source. Never commit inventory CSVs, screenshots, `.dev.vars`, token stores, or environment secrets.
2. In the owner's Cloudflare account, create a D1 database and private R2 bucket. Replace the placeholder ID in `apps/api/wrangler.jsonc`. Apply `apps/api/migrations/0001_core.sql` remotely only after confirming the correct account/database.
3. Configure an owner-only Cloudflare Access self-hosted application for the intended hostname (for example `saldo.sands.red`). Protect all paths. Add only the owner to the allow policy; do not create a public bypass.
4. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_SUB` and `APP_ORIGIN` for the Worker. `OWNER_SUB` is the verified subject from the owner's Access session, not an arbitrary email header. Set all identity configuration privately. Never expose Cloudflare management credentials to the app.
5. Build and deploy static assets plus the Worker. Disable any unprotected alternate hostname/routes; the application also independently rejects missing or invalid Access JWTs. Verify unauthorized requests receive 401 and cross-origin mutations receive 403 before loading private records.
6. Connect the private AI service using the SIWC guide. UI/CRUD must remain on Workers; only chat should activate inference. Never route a public request directly to an OAuth-bearing Container. Persist encrypted rotating token state independently of ephemeral Container disks before enabling production AI.
7. Import records through review after signing in. Inspect counts, currencies, uncertainty and duplicate suggestions before saving.

## Release checklist

- [ ] Build, lint, type checks, unit tests and browser smoke tests pass.
- [ ] Real production Access login and owner subject verified.
- [ ] Unauthenticated and other-account access denied, including asset and API paths.
- [ ] D1 migrations applied to intended private database; R2 bucket has no public access.
- [ ] SIWC OAuth bootstrapped by the user; encrypted store and stable host identity survive restart.
- [ ] Refresh-token rotation tested under concurrency and interrupted network requests.
- [ ] Request and response bodies, tokens and financial records excluded from logs/tracing.
- [ ] Same-origin/CSRF behavior, duplicate imports, repeated saves and interrupted image requests tested.
- [ ] D1/R2 backup, export and deletion policy selected by owner.
- [ ] Actual account costs/quotas checked and any new paid commitment approved.

Until these are checked, treat the deployment as an unverified development build, not a production-ready financial record system.
