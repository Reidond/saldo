// The repository root is not a Worker project. Its presence stops cf's
// automatic configuration from turning the workspace root into one; each
// deployable has its own cloudflare.config.ts in apps/api, apps/web and
// apps/bridge. Run cf commands from those directories.
throw new Error(
  "Run cf from apps/api, apps/web or apps/bridge, not the repository root.",
);
export default {};
