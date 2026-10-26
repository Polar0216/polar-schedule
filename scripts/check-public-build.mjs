import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const report = [];
for (const directory of ['dist', 'dist-pages']) {
  const base = directory === 'dist-pages' ? '/polar-schedule/' : './';
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, base); assert.equal(manifest.start_url, base); assert.equal(manifest.display, 'standalone');
  assert(manifest.icons.some((icon) => icon.sizes === '192x192')); assert(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { assert.equal(entry.name, 'assets' === entry.name ? 'assets' : 'icons'); await walk(file); }
      else {
        assert(!/\.env|\.map$|backup|recovery|phase3-e2e|test-pat|\.test\./i.test(entry.name), `Nonpublic file: ${file}`);
        assert((await stat(file)).size < 5 * 1024 * 1024);
        if (/\.(?:js|css|html|json|webmanifest|svg)$/.test(file)) {
          const text = await readFile(file, 'utf8');
          assert(!/(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})/.test(text), 'Credential pattern detected');
          assert(!text.includes('mock-phase3-token') && !text.includes('visual-mock-placeholder'), 'Test credential found');
          assert(!/(?:src|href)=["'](?:http:\/\/(?:127\.0\.0\.1|localhost)|\/assets\/)/.test(text), 'Invalid release URL');
        }
      }
    }
  }
  await walk(directory);
  const worker = await readFile(path.join(directory, 'sw.js'), 'utf8');
  assert(worker.includes("event.request.headers.has('authorization')")); assert(!worker.includes('skipWaiting'));
  report.push({ directory, base, result: 'passed' });
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
