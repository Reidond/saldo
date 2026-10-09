// Prevent cf auto-init from replacing the legacy protected Worker configuration.
// Both cf Workers are defined in deployment/.
throw new Error(
  "Use the deployment package: pnpm run cf:build:app from the repository root.",
);
export default {};
