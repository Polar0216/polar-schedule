import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fixture } from '../src/sync/testSupport';
import { addTask, importFixture, snapshot } from './helpers/phase4';

test('P4 Pages子路径：HTML/JS/CSS/图标/manifest/SW无404且Chromium安装条件通过', async ({ page, context, baseURL }) => {
  const failures: string[] = [], errors: string[] = [];
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./'); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const metadata = await page.evaluate(async () => {
    const manifestURL = new URL(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href);
    const manifest = await (await fetch(manifestURL)).json() as { start_url: string; scope: string; icons: Array<{ src: string; sizes: string }> };
    const icons = await Promise.all(manifest.icons.map((icon) => new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = reject; image.src = new URL(icon.src, manifestURL).href; })));
    const registration = await navigator.serviceWorker.ready;
    return { manifest, manifestURL: manifestURL.href, icons, scope: registration.scope, script: registration.active!.scriptURL, secure: isSecureContext };
  });
  expect(metadata.scope).toBe(baseURL); expect(metadata.script).toBe(new URL('sw.js', baseURL).href); expect(metadata.manifest.scope).toBe('/polar-schedule/'); expect(metadata.manifest.start_url).toBe('/polar-schedule/');
  expect(metadata.icons).toEqual([{ width: 192, height: 192 }, { width: 512, height: 512 }, { width: 512, height: 512 }]); expect(metadata.secure).toBe(true);
  const cdp = await context.newCDPSession(page); const installability = await cdp.send('Page.getInstallabilityErrors') as { installabilityErrors: unknown[] };
  expect(installability.installabilityErrors).toEqual([]); expect(failures).toEqual([]); expect(errors).toEqual([]);
  await mkdir('docs/evidence/phase4', { recursive: true }); await writeFile('docs/evidence/phase4/pwa-local-installability.json', JSON.stringify({ ...metadata, ...installability }, null, 2));
  await page.screenshot({ path: 'docs/evidence/phase4/pages-first-launch-desktop.png', fullPage: true });
});

test('P4 旧4173导出→独立Pages来源预览导入，原库保留且不会自动上传', async ({ page, context }) => {
  let apiCalls = 0; await context.route('https://api.github.com/**', (route) => { apiCalls++; return route.abort(); });
  await page.goto('http://127.0.0.1:4173/'); const data = fixture(); data.tasks[0].title = '虚构旧来源迁移任务'; await importFixture(page, data);
  const original = await snapshot(page); await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出完整 JSON', exact: true }).click()]);
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const online = await context.newPage(); await online.goto('http://127.0.0.1:4174/polar-schedule/'); await expect(online.getByLabel('首次迁移提示', { exact: true })).toBeVisible();
  expect((await snapshot(online)).tasks).toHaveLength(0); await online.getByRole('button', { name: '迁移与导入', exact: true }).click(); await importFixture(online, exported);
  expect((await snapshot(online)).tasks).toEqual(original.tasks); expect(await snapshot(page)).toEqual(original); expect(apiCalls).toBe(0);
  await online.reload(); await expect(online.getByLabel('首次迁移提示', { exact: true })).toHaveCount(0); expect((await snapshot(online)).tasks).toEqual(original.tasks); await online.close();
});

test('P4 子路径离线关闭重开后可新增/保存，当前源与别的项目缓存隔离', async ({ page, context, baseURL }) => {
  await page.goto('./'); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async () => { const cache = await caches.open('another-project-keep'); await cache.put('/another-project/asset.txt', new Response('unrelated')); });
  await context.setOffline(true); await page.reload(); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toBeVisible(); await addTask(page, 'Pages离线保存');
  await page.close(); const reopened = await context.newPage(); await reopened.goto(baseURL!); await expect(reopened.getByRole('button', { name: 'Pages离线保存', exact: true })).toBeVisible();
  expect(await reopened.evaluate(() => caches.has('another-project-keep'))).toBe(true); expect((await snapshot(reopened)).tasks).toHaveLength(1); await context.setOffline(false);
});

test('P4 真SW版本更新不刷新草稿；关闭旧客户端后激活并只清理本站旧缓存', async ({ browser }) => {
  test.setTimeout(65000); const root = path.resolve('dist-pages'), prefix = '/polar-schedule/'; let revision = 'old';
  const server = createServer((request, response) => { void (async () => {
    const pathname = new URL(request.url!, 'http://127.0.0.1').pathname;
    if (pathname === '/other-project/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>unrelated</title>'); return; }
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const file = path.resolve(root, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html');
    if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    if (request.headers.authorization) { response.setHeader('Content-Type', 'application/json'); response.end('{"private":"invented-authorized-response"}'); return; }
    let body: Buffer | string = await readFile(file);
    if (pathname.endsWith('sw.js')) body = body.toString().replace(/(const CACHE = PREFIX \+ )"[^"]+";/, `$1"update-${revision}";`);
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[path.extname(file)] ?? 'application/octet-stream'); response.end(body);
  })().catch(() => response.writeHead(404).end()); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}${prefix}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(url); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.evaluate(async () => { const other = await caches.open('other-project-version'); await other.put('/other-project/asset', new Response('keep')); });
    await page.getByRole('button', { name: '新建任务', exact: true }).click(); await page.getByLabel('任务标题', { exact: true }).fill('未保存的更新草稿');
    revision = 'new'; await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    await expect(page.getByLabel('任务标题', { exact: true })).toHaveValue('未保存的更新草稿'); expect((await snapshot(page)).tasks).toHaveLength(0);
    await page.getByRole('button', { name: '设置与数据', exact: true }).click(); await page.getByRole('button', { name: '安装与更新', exact: true }).click();
    await expect(page.locator('[data-settings-section=pwa]')).toContainText('不会强制刷新'); await page.keyboard.press('Escape'); await expect(page.getByLabel('任务标题', { exact: true })).toHaveValue('未保存的更新草稿');
    await page.close(); const next = await context.newPage(); await next.goto(url); await next.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect.poll(() => next.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([expect.stringContaining('update-new'), 'other-project-version']));
    const keys = await next.evaluate(() => caches.keys()); expect(keys.some((key) => key.endsWith('update-old'))).toBe(false);
    const publicCache = await next.evaluate(async () => { await fetch('build-info.json', { headers: { Authorization: 'Bearer mock-only' } }); return (await caches.match(new URL('build-info.json', location.href)))!.text(); });
    expect(publicCache).not.toContain('invented-authorized-response');
    const other = await context.newPage(); await other.goto(`http://127.0.0.1:${address.port}/other-project/`); expect(await other.evaluate(() => navigator.serviceWorker.controller)).toBeNull(); await other.close();
  } finally { await context.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

for (const width of [390, 768, 1440]) test(`P4 Pages ${width}px可迁移/访问安装说明，原日周月与日期预览保留`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 }); await page.goto('./'); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toHaveCount(1);
  if (width === 390) await page.getByRole('button', { name: '知道了', exact: true }).click();
  for (const name of ['日', '周', '月']) { await page.getByRole('button', { name, exact: true }).click(); await expect(page.locator('.fc')).toBeVisible(); }
  await page.getByRole('button', { name: '设置与数据', exact: true }).click(); await page.getByRole('button', { name: '安装与更新', exact: true }).click();
  await expect(page.locator('[data-settings-section=pwa]')).toContainText('Safari');
  await expect(page.locator('[data-settings-section=pwa]')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '安装 Polar Schedule', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await mkdir('docs/evidence/phase4', { recursive: true }); await page.screenshot({ path: `docs/evidence/phase4/pages-install-help-${width}.png`, fullPage: true });
});
