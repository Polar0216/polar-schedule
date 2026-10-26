import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig(base, {
  testMatch: '**/pages-phase4.spec.ts', testIgnore: [],
  outputDir: 'test-results/pages',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174/polar-schedule/' },
  webServer: [
    { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
    { command: 'npm run preview -- --port 4174 --strictPort --outDir dist-pages --base=/polar-schedule/', url: 'http://127.0.0.1:4174/polar-schedule/', reuseExistingServer: !process.env.CI },
  ],
});
