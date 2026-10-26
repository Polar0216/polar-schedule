import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// defineConfig(base, overrides) concatenates webServer entries. Spread first so
// this suite owns exactly one root preview and one project-path preview in CI.
export default defineConfig({ ...base,
  testMatch: '**/pages-phase4.spec.ts', testIgnore: [],
  outputDir: 'test-results/pages',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174/polar-schedule/' },
  webServer: [
    { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
    { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort --outDir dist-pages --base=/polar-schedule/', url: 'http://127.0.0.1:4174/polar-schedule/', reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
  ],
});
