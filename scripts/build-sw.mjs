import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const base = process.argv[3] ?? './';
if (!['./', '/polar-schedule/'].includes(base) || !['dist', 'dist-pages'].includes(path.basename(root))) throw new Error('Unsupported public build target');
const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
await writeFile(path.join(root, 'manifest.webmanifest'), JSON.stringify({ ...manifest, id: base, start_url: base, scope: base }, null, 2));
const appVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}
const files = (await walk(root)).filter((file) => !['sw.js', 'build-info.json'].includes(path.basename(file))).sort();
const digest = createHash('sha256');
for (const file of files) digest.update(await readFile(file));
const version = `${appVersion}-${digest.digest('hex').slice(0, 16)}`;
await writeFile(path.join(root, 'build-info.json'), JSON.stringify({ version: appVersion, cacheVersion: version, base }));
const urls = files.map((file) => path.relative(root, file).split(path.sep).join('/')).concat('build-info.json');
const worker = `// Generated from this build. Cache only this application's public static assets.
const PREFIX = 'polar-schedule:' + self.registration.scope + ':';
const CACHE = PREFIX + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(urls)}.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('authorization')) return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(new URL('index.html', self.registration.scope).href))));
  } else if (ASSETS.includes(url.href)) {
    // Static dev/preview servers may send Vary: Origin. Every URL here is an
    // explicitly precached public build asset, so CORS request mode must not
    // prevent cache hits when the same module is loaded offline.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request)));
  }
});
`;
await writeFile(path.join(root, 'sw.js'), worker);
process.stdout.write(`Offline shell: ${urls.length} assets, ${version}\n`);
