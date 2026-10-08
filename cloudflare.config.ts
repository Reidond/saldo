// Prevent cf auto-init from replacing the legacy protected Worker configuration.
// The workspace root is not the cf Worker build package; see deployment/.
throw new Error(
  "Use the deployment package: pnpm run cf:build:app or pnpm run cf:build:bridge.",
);
export default {};
