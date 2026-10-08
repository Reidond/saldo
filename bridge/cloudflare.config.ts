// Prevent cf auto-init in this source directory. Both cf Workers live in deployment/.
throw new Error(
  "Use the deployment package: npm run cf:build:bridge from the repository root.",
);
export default {};
