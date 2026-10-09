// "server-only" is resolved by @vitejs/plugin-rsc (and aliased in tests): it
// fails the build if a server module is imported into the client bundle.
declare module "server-only" {}
