// Prevent cf auto-init in the web package. Its Worker is configured in
// wrangler.jsonc and built by `vp build` (@cloudflare/vite-plugin); deployment
// definitions live in deployment/.
throw new Error(
  "Use the deployment package: pnpm run cf:build:app from the repository root.",
);
export default {};
