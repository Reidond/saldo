// Prevent cf auto-init from replacing the legacy protected Worker configuration.
// The React/Vite package is not the cf Worker build package.
throw new Error(
  "Use the deployment package: npm run cf:build:app or npm run cf:build:bridge.",
);
export default {};
