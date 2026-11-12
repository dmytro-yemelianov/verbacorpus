// Binding configured by vitest.config.ts for the fixture asset directory.
declare module "cloudflare:test" {
  interface ProvidedEnv {
    ASSETS: Fetcher;
  }
}
