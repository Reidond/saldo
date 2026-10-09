// Prevent cf auto-init in the React/Vite package. It is not a cf Worker build
// package; the protected app Worker serves its build output (see deployment/).
throw new Error(
  "Use the deployment package: pnpm run cf:build:app from the repository root.",
);
export default {};
