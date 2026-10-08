# Private ChatGPT connection

Saldo uses the official Sign in with ChatGPT (SIWC) open-source flow. There is no API-key fallback, copied Codex login, browser-session extraction, or public token endpoint. **A disconnected app remains usable for manual tracking and imports.** AI becomes available only after the owner authorizes their own registration and explicitly installs it in their own Cloudflare account.

This repository contains the implementation and deployment configuration. No ChatGPT account has been connected, no secrets have been installed, and no cloud deployment or paid resource has been created as part of building this source.

## Architecture and trust boundaries

1. The public Saldo application validates Cloudflare Access JWT signature, issuer, audience and the exact owner subject before handling private data.
2. The app calls its private `AI` service binding. That separate Worker has `workers_dev: false`, `preview_urls: false`, no public routes, and requires a strong `AI_BRIDGE_SECRET` on every request.
3. A fixed, single-owner `SaldoAI` Durable Object holds an AES-256-GCM-encrypted vault. The encryption key is a Worker secret, outside the database. Its stable runtime host ID and account/client mapping survive sleep, process loss, and container rebuilds.
4. The Durable Object serializes token refresh and commits the complete replacement credentials before returning an access token. A durable “refresh in progress” marker means a crash or uncertain token exchange forces reauthorization instead of replaying an old rotating token.
5. A private Node container performs inference. It receives only the current short-lived access token and request data over its internal authenticated connection. It never receives refresh tokens, ID tokens, or the encryption key. It writes no credentials or financial data to disk.
6. Only validated draft proposals return to the app. The bridge has no ledger/database write, payment, cancellation, shell, or outbound messaging tool. The owner must review and confirm changes separately.

Cloudflare Container disk is ephemeral. The OAuth vault is deliberately stored in Durable Object storage, not in the container filesystem. Do not replace this with a filesystem-only credential store. The deployment is single-owner, single-container (`lite`, 256MiB), and allows one inference request at a time. The UI caps total image files at 7MiB per message, and each gateway/container request has a 12,000,000-byte body cap. A large ledger plus images may exceed that cap and returns an explicit size error. These bounds reduce memory pressure but have not been live load-benchmarked; do not treat them as a performance guarantee. It is not a multi-tenant gateway.

## Owner-operated setup

These steps create persistent access and deploy billable infrastructure. The owner must perform them in a trusted local terminal after reviewing the scopes and Cloudflare costs. Do not paste keys, tokens, credential files, or authorization URLs into a chat or an issue. Never ask an assistant to read or transmit them.

Prerequisites: Node 24, dependencies installed with `npm ci`, a Docker-compatible engine for Cloudflare image builds, an authenticated Wrangler session, Cloudflare Workers/Containers availability, and an eligible ChatGPT account. Use the same Saldo source for local authorization and the remote runtime.

### 1. Create protected local state

Run on the same computer as your browser:

```sh
npx tsx bridge/bootstrap.ts init
npx tsx bridge/bootstrap.ts login --new "Personal"
```

The helper creates an owner-only state directory at `~/.config/saldo/`, a private `state.key`, and encrypted `oauth.enc.json`. `SALDO_STATE_DIR` and `SALDO_KEY_FILE` can override these locations. Keep them outside the repository and shared/synced folders. Back up the key separately from encrypted state if you need recovery.

Open the one-time **local** “Continue with ChatGPT” URL printed in the terminal. It redirects your browser to OpenAI. Approve only the intended account/workspace and Saldo registration. The callback listens on `127.0.0.1` with a five-minute timeout. The helper validates state, PKCE, signature, issuer, audience, expiry, nonce, account identity, and granted plan-use scope before replacing any account credentials. Tokens never appear in the success page or terminal. A fresh sign-in attempt is saved encrypted and kept separate from the active registration until validated.

The requested scopes are `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`; inference uses `https://api.openai.com/v1`. This grants renewable access to the selected ChatGPT plan. OpenAI's consent screen is the authoritative permission review. The public client receives its own issued client ID; no client secret or partner key is required.

For a saved registration:

```sh
npx tsx bridge/bootstrap.ts accounts
npx tsx bridge/bootstrap.ts login YOUR_ISSUED_CLIENT_ID
```

Reauthorization reuses that registration and this computer's stable host ID. If a new registration was issued but code exchange failed, use `login --resume` rather than creating another registration. An interrupted helper may leave `.bootstrap-lock`; remove it only after confirming no bootstrap process is running. There is no automatic stale-lock bypass.

### 2. Install private runtime secrets

Generate a separate random bridge secret into an owner-only file using a trusted local password manager or local cryptographic utility. It must be 43–128 base64url characters (a randomly generated 32-byte base64url value is sufficient). Use the same value in the application Worker and the bridge Worker. Do not put it in Wrangler variables, browser configuration, a URL, or source control.

The following are **user-run commands**, not automatic setup:

```sh
npx wrangler secret put AI_BRIDGE_SECRET --config wrangler.jsonc < /private/path/bridge-secret
npx wrangler secret put AI_BRIDGE_SECRET --config bridge/wrangler.jsonc < /private/path/bridge-secret
npx wrangler secret put SIWC_STATE_KEY --config bridge/wrangler.jsonc < ~/.config/saldo/state.key
```

Use the overridden key path if applicable. Initial secret installation may require creating/deploying the Worker first; follow Wrangler's prompt only for the intended private Worker in your account. Keep app Access settings and owner subject correct before enabling the application. Runtime secret creation and any OAuth/cloud login are owner actions.

### 3. Deploy the bridge and transfer the selected registration

Review `bridge/wrangler.jsonc`: the service is `saldo-ai-bridge`, with one Container attached to the `SaldoAI` Durable Object. The current image uses the supported `Container` class with its default scheduling policy. Do not switch its scheduling policy to `durable_object` without porting to Cloudflare's direct Container API.

```sh
npx wrangler deploy --config bridge/wrangler.jsonc
```

Bind the app's `AI` service to `saldo-ai-bridge` in the application Wrangler configuration. Use a service binding, not a public bridge URL. Do not add a route, workers.dev endpoint, preview URL, or public container port.

Export a freshly validated registration:

```sh
npx tsx bridge/bootstrap.ts export ~/.config/saldo/transfer.enc.json
npx wrangler secret bulk ~/.config/saldo/transfer.enc.json.secrets.json --config bridge/wrangler.jsonc
```

The helper also writes a protected `.secrets.json` file containing only encrypted bundle chunks and their count. Each chunk stays below Cloudflare’s 5KB secret-value limit; Wrangler imports them together. The bundle is authenticated-encrypted with the state key and has a 30-minute initial import window. Open the owner-authenticated Saldo app and refresh its connection status. The first status/chat request imports the selected registration into durable storage. The app reports connected only after the vault is usable. Never infer import success merely from a successful secret upload.

After the app reports connected, remove all temporary import secrets together using the generated cleanup file (its values are null, which Wrangler bulk interprets as deletion):

```sh
npx wrangler secret bulk ~/.config/saldo/transfer.enc.json.cleanup.json --config bridge/wrangler.jsonc
```

This removes `SIWC_BOOTSTRAP_PARTS` and all chunks generated for that bundle. If a prior import used more chunks, remove any leftover higher-numbered chunk secrets too; they are ignored and hold only encrypted data. Securely remove the transfer/import/cleanup files using your normal operating-system process. Keep your local protected account mapping for reauthorization; it will become stale as the remote runtime rotates tokens. The local helper never performs background refresh or inference. Let the remote runtime be the only refresh owner.

The remote Durable Object generates and persists **its own** host ID before import. It does not copy the laptop's host ID. This follows OpenAI's VM-transfer procedure: same Saldo client, same user/workspace, transferred session, separate persistent runtime identity. A later local reauthorization uses the saved local host ID and issued client ID, and a newly encrypted bundle updates the remote registration without overwriting its host ID. Host-specific usage attribution/revocation for transferred sessions is an upstream preview limitation.

## Runtime contract

The app sends these requests through the private service binding with `Authorization: Bearer <AI_BRIDGE_SECRET>`:

- `GET http://bridge/status` → `{ "connected": true | false }`. No token, email, subject, or account metadata is returned.
- `POST http://bridge/chat` → `{ "reply": "…", "proposals": [...] }`.

Chat JSON contains `message`, `attachments` (`name`, `type`, `dataUrl`), `subscriptions`, and optional bounded `history` (`role`, `content`). Accepted image types are PNG, JPEG and WebP, with shared MIME/base64/signature/size validation. Images are inline inputs; the Files API is not used. There is no remote image-URL fetch, so attachments cannot act as an arbitrary URL fetcher. Current text history is explicitly sent with each request and is not stored by OpenAI Responses.

Before each inference, the container requests the account-specific model catalog and accepts only models marked for listing. `SIWC_MODEL`, if set on the bridge, must be an available slug or the request fails; otherwise it uses the first listed model. No hard-coded “free” model claim is made. The configured model must support the submitted image and tool modalities; unsupported combinations fail visibly.

Responses requests use `store:false`, `stream:true`, an input array, and a single namespaced draft-result function. The bridge consumes the upstream stream privately and returns one JSON result only after `response.completed` with completed status. Interrupted, failed, malformed, incomplete, oversized, and truncated streams return errors and no partial proposals. It never automatically retries inference. Request cancellation propagates through the service binding and container to the provider fetch; a cancelled request never returns proposals. All proposals pass shared schema and duplicate/target checks before returning; the main app validates again before any save.

## Revocation, recovery and limits

Disconnect Saldo in ChatGPT settings to revoke its access. An HTTP 401 disables the stored session; the UI remains usable and shows disconnected. A refresh with an uncertain outcome also requires reauthorization, deliberately favoring security over automatic retries. Reconnect with the existing local registration, export a fresh bundle, import it, verify connected, and remove the temporary import count and chunk secrets again. Do not copy credentials from Codex or another application.

To switch registrations, run the helper's local account-selection/login commands and import the chosen registration. The encrypted remote vault keeps accounts separate by issued client ID plus validated subject. The web interface currently exposes only connection status; account selection and reauthorization are owner-operated in the helper. There is no web-based account-picker or remote OAuth callback in this version.

Set app usage limits and inspect usage in ChatGPT settings. Inference uses the selected plan's limits, not a separate free allowance. Cloudflare hosting is billed separately. This preview uses no hosted web search, connectors, audio, code execution, or automatic provider verification. Screenshot-derived proposals can be wrong; review uncertain fields, dates, and `UNK` currency before saving.

Keep observability/request-body tracing off for this bridge, including any external proxy. Never log Authorization headers, token responses, sign-in URLs containing hints, screenshots, or financial context. Restrict Cloudflare account access and keep the public app's owner-only Access policy enabled. Database encryption does not protect against someone who can access both Worker secrets and the database.

## Verification

```sh
npx tsc -p bridge/tsconfig.json
npx tsc -p bridge/tsconfig.node.json
npx vitest run bridge/siwc.test.ts
```

Automated tests use only synthetic credentials and local streams. A real OAuth round trip, deployed Container startup, durable import, expiry/rotation, and live inference still require an owner-run deployment acceptance check. Tests do not establish live account eligibility or deployment readiness.

## Official references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Self-hosted VM credential transfer](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- [Accounts, sessions, and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Cloudflare Container class and durable storage](https://developers.cloudflare.com/containers/api/container-class/)
- [Cloudflare Container filesystem persistence](https://developers.cloudflare.com/containers/faq/)

- [Cloudflare Worker variable/secret size limits](https://developers.cloudflare.com/workers/platform/limits/)
