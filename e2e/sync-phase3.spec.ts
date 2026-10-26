import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { FakeGitHub, fixture } from '../src/sync/testSupport';
import { fingerprint } from '../src/sync/snapshotCodec';
import type { ScheduleData } from '../src/domain/schema';

const evidence = 'docs/evidence/phase4/regression';
async function mock(context: BrowserContext, fake: FakeGitHub) {
  await context.route('https://api.github.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-github-api-version,accept', 'access-control-allow-methods': 'GET,PUT,OPTIONS' } });
    try {
      const response = await fake.fetch(route.request().url(), { method: route.request().method(), body: route.request().postData() ?? undefined });
      await route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json', headers: { ...Object.fromEntries(response.headers), 'access-control-allow-origin': '*' } });
    } catch { await route.abort('failed'); }
  });
}
async function raw(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('polar-schedule'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly');
      const entries = await Promise.all(names.map((name) => new Promise<[string, unknown[]]>((resolve, reject) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve([name, r.result]); r.onerror = () => reject(r.error); })));
      return { version: db.version, tables: Object.fromEntries(entries) };
    } finally { db.close(); }
  });
}
async function snapshot(page: Page): Promise<ScheduleData> {
  const { tables } = await raw(page), root = tables.metadata[0] as { settings: ScheduleData['settings']; updatedAt: string };
  return { schemaVersion: 3, settings: root.settings, updatedAt: root.updatedAt, lists: tables.lists, tasks: tables.tasks, scheduleBlocks: tables.scheduleBlocks,
    tags: tables.tags, exceptions: tables.exceptions, tombstones: tables.tombstones } as ScheduleData;
}
async function seed(page: Page, data = fixture()) {
  await page.goto('/favicon.svg');
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('polar-schedule', 30);
      r.onupgradeneeded = () => {
        const create = (name: string, indices: string[]) => { const s = r.result.createObjectStore(name, { keyPath: name === 'metadata' ? 'key' : name === 'tombstones' ? ['entityType', 'id'] : 'id' }); indices.forEach((key) => s.createIndex(key, key)); return s; };
        create('lists', ['order', 'archived']); create('tasks', ['listId', 'status', 'order', 'dueDate']); create('scheduleBlocks', ['type', 'taskId', 'executionStatus']);
        create('metadata', []); create('tombstones', ['deletedAt']); create('tags', ['title']); create('backups', ['createdAt']); create('undo', ['createdAt', 'expiresAt']);
        create('exceptions', ['seriesId']).createIndex('[seriesId+occurrenceDate]', ['seriesId', 'occurrenceDate'], { unique: true });
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...db.objectStoreNames], 'readwrite');
      for (const table of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions', 'tombstones'] as const) data[table].forEach((row) => tx.objectStore(table).put(row));
      tx.objectStore('metadata').put({ key: 'state', schemaVersion: 3, settings: data.settings, updatedAt: data.updatedAt });
      tx.objectStore('backups').put({ id: 'existing-v3-backup', createdAt: data.updatedAt, data, kind: 'import' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }, data);
  await page.goto('/'); await expect(page.locator('.sync-status')).toBeVisible();
}
async function settings(page: Page) { await page.locator('.sync-status').click(); const section = page.locator('[data-settings-section="sync"]'); await expect(section.getByRole('heading', { name: /GitHub 同步/ })).toBeVisible(); return section; }
async function connect(page: Page, remember = true) {
  const section = await settings(page); await section.getByLabel('测试仓库 PAT', { exact: true }).fill('mock-phase3-browser-placeholder');
  if (remember) await section.getByRole('checkbox', { name: /记住此设备/ }).check();
  await section.getByRole('button', { name: '验证并连接测试仓库' }).click();
  await expect(section.getByText('首次同步预览 · 需要确认', { exact: true })).toBeVisible(); return section;
}
async function confirmLocal(page: Page) {
  const section = page.locator('[data-settings-section="sync"]'); await section.getByRole('checkbox', { name: /已检查目标/ }).check();
  await section.getByRole('button', { name: '确认以本地创建 / 替换测试快照', exact: true }).click();
  await expect(section.locator('.sync-current')).toContainText('已同步');
}
async function addTask(page: Page, title: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click(); await page.getByLabel('任务标题', { exact: true }).fill(title);
  await page.getByRole('button', { name: '保存任务', exact: true }).click(); await page.getByRole('button', { name: '返回待办', exact: true }).click();
}
async function shot(page: Page, name: string) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true }); }

test('P3 原生v3库增量升级无损，首次确认前零远端写入；可信凭据刷新、清除与导出隔离', async ({ page, context }) => {
  const fake = new FakeGitHub(); await mock(context, fake); const data = fixture(); data.settings.theme = 'dark'; await seed(page, data);
  expect((await raw(page)).version).toBe(40); expect(await snapshot(page)).toEqual(data); const oldBackups = (await raw(page)).tables.backups;
  const section = await connect(page); expect(fake.puts).toBe(0); expect(await snapshot(page)).toEqual(data);
  await shot(page, 'first-preview-desktop-dark'); await confirmLocal(page); expect(fake.puts).toBe(1);
  expect((await raw(page)).tables.backups).toEqual(oldBackups);
  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: '导出本地 JSON', exact: true }).click()]);
  const file = await download.path(); const { readFile } = await import('node:fs/promises'); const text = await readFile(file!, 'utf8');
  expect(text).not.toContain('mock-phase3-browser-placeholder'); expect(text).not.toContain('syncStates'); expect(JSON.parse(text).schemaVersion).toBe(3);
  await page.reload(); await expect(page.locator('.sync-status')).toContainText('已同步');
  const after = await settings(page); await after.getByRole('button', { name: '断开并清除本设备凭据' }).click();
  await expect(after.locator('.sync-current')).toContainText('仅本地'); expect((await raw(page)).tables.credentials).toHaveLength(0); expect(await snapshot(page)).toEqual(data);
  const count = fake.calls.length; await page.reload(); await expect(page.locator('.sync-status')).toContainText('仅本地'); await page.waitForTimeout(3300); expect(fake.calls.length).toBe(count);
});

test('P3 公开仓库与401授权失效安全降级，不反射凭据或改动本地数据', async ({ page, context }) => {
  const fake = new FakeGitHub(); fake.privateRepo = false; await mock(context, fake); await seed(page);
  const before = await snapshot(page), section = await settings(page);
  await section.getByLabel('测试仓库 PAT', { exact: true }).fill('mock-do-not-reflect'); await section.getByRole('button', { name: '验证并连接测试仓库' }).click();
  await expect(section.getByRole('alert')).toContainText('私有'); expect((await raw(page)).tables.credentials).toHaveLength(0); expect(await snapshot(page)).toEqual(before); expect(fake.puts).toBe(0);
  fake.privateRepo = true; await section.getByLabel('测试仓库 PAT', { exact: true }).fill('mock-do-not-reflect'); await section.getByRole('button', { name: '验证并连接测试仓库' }).click();
  await expect(section.getByText('首次同步预览 · 需要确认', { exact: true })).toBeVisible(); await confirmLocal(page);
  fake.failNext = 401; await section.getByRole('button', { name: '立即同步' }).click(); await expect(section.locator('.sync-current')).toContainText('需要授权');
  await expect(section.getByRole('alert')).not.toContainText('mock-do-not-reflect'); await page.keyboard.press('Escape'); await addTask(page, '授权失效仍可编辑');
  expect((await snapshot(page)).tasks).toHaveLength(3); expect(fake.puts).toBe(1); await shot(page, 'authorization-expired-local-usable');
});

test('P3 浏览器PUT已提交响应丢失时先回读，SHA409重新合并且无重复提交', async ({ page, context }) => {
  const fake = new FakeGitHub(); await mock(context, fake); await seed(page); await connect(page); await confirmLocal(page); await page.keyboard.press('Escape');
  fake.losePutResponse = true; await addTask(page, '响应丢失新增'); const section = await settings(page); await section.getByRole('button', { name: '立即同步' }).click();
  await expect(section.locator('.sync-current')).toContainText('已同步'); expect(fake.puts).toBe(2); expect(fake.data?.tasks).toHaveLength(3);
  await page.keyboard.press('Escape'); await addTask(page, '409竞争新增');
  const changedId = fixture().tasks[0].id;
  fake.beforePut = async () => { fake.beforePut = undefined; fake.data!.tasks.find((task) => task.id === changedId)!.title = '模拟另一设备变更'; fake.serial++; };
  const again = await settings(page); await again.getByRole('button', { name: '立即同步' }).click(); await expect(again.locator('.sync-current')).toContainText('已同步');
  expect(fake.puts).toBe(3); expect(fake.data?.tasks).toHaveLength(4); expect(fake.data?.tasks.find((task) => task.id === changedId)?.title).toBe('模拟另一设备变更');
});

test('P3 离线三次新增即时保存，重开保持排队，联网防抖一次提交；两标签共享锁', async ({ page, context }) => {
  test.setTimeout(70000); const fake = new FakeGitHub(); await mock(context, fake); await seed(page); await connect(page); await confirmLocal(page); await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); await context.setOffline(true);
  for (let n = 1; n <= 3; n++) await addTask(page, `离线新增 ${n}`);
  expect((await snapshot(page)).tasks).toHaveLength(5); await expect(page.locator('.sync-status')).toContainText('离线');
  await page.reload(); await expect(page.locator('.sync-status')).toContainText('离线'); expect((await snapshot(page)).tasks).toHaveLength(5); expect(fake.puts).toBe(1);
  await context.setOffline(false); const second = await context.newPage(); await second.goto('/');
  await expect.poll(() => fake.puts).toBe(2); await expect(page.locator('.sync-status')).toContainText('已同步'); await expect(second.locator('.sync-status')).toContainText('已同步');
  expect(fake.data?.tasks).toHaveLength(5); await second.close(); await page.waitForTimeout(3500); expect(fake.puts).toBe(2); await shot(page, 'synced-desktop-light');
});

test('P3 两隔离设备不同任务合并、同任务冲突保留两端，显式选择和备份后解决', async ({ browser, page, context }) => {
  test.setTimeout(90000); const fake = new FakeGitHub(); await mock(context, fake); await seed(page); await connect(page); await confirmLocal(page); await page.keyboard.press('Escape');
  const other = await browser.newContext({ viewport: { width: 768, height: 760 } }); await mock(other, fake); const b = await other.newPage(); await seed(b); await connect(b); await confirmLocal(b); await b.keyboard.press('Escape');
  await b.getByRole('navigation', { name: '主要页面', exact: true }).getByRole('button', { name: '待办', exact: true }).click();
  try {
    await page.getByRole('button', { name: '虚构同步任务 1', exact: true }).click(); await page.getByLabel('任务标题', { exact: true }).fill('设备 A 修改'); await page.getByRole('button', { name: '保存任务', exact: true }).click(); await page.getByRole('button', { name: '返回待办', exact: true }).click();
    await b.getByRole('button', { name: '虚构同步任务 2', exact: true }).click(); await b.getByLabel('任务标题', { exact: true }).fill('设备 B 修改'); await b.getByRole('button', { name: '保存任务', exact: true }).click(); await b.getByRole('button', { name: '返回待办', exact: true }).click();
    await expect.poll(() => fake.data?.tasks.map((t) => t.title).sort()).toEqual(['设备 A 修改', '设备 B 修改']);
    const aSection = await settings(page); await aSection.getByRole('button', { name: '立即同步' }).click(); await expect.poll(async () => fingerprint(await snapshot(page))).toBe(fingerprint(fake.data!));
    await page.keyboard.press('Escape');
    // Prevent automatic sync while making divergent edits, then resume explicitly.
    await context.setOffline(true); await other.setOffline(true);
    await page.getByRole('button', { name: '设备 A 修改', exact: true }).click(); await page.getByLabel('任务标题', { exact: true }).fill('冲突本地选择'); await page.getByRole('button', { name: '保存任务', exact: true }).click(); await page.getByRole('button', { name: '返回待办', exact: true }).click();
    await b.getByRole('button', { name: '设备 A 修改', exact: true }).click(); await b.getByLabel('任务标题', { exact: true }).fill('冲突远端选择'); await b.getByRole('button', { name: '保存任务', exact: true }).click(); await b.getByRole('button', { name: '返回待办', exact: true }).click();
    await context.setOffline(false); const s = await settings(page); await s.getByRole('button', { name: '立即同步' }).click(); await expect(s.locator('.sync-current')).toContainText('已同步');
    await other.setOffline(false); const bs = await settings(b); await bs.getByRole('button', { name: '立即同步' }).click(); await expect(bs.getByText('同步冲突 · 需要选择', { exact: true })).toBeVisible();
    const radios = bs.getByRole('radio');
    for (const radio of await radios.all()) { const bounds = await radio.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(20); expect(bounds!.height).toBeLessThanOrEqual(20); }
    await bs.evaluate((el) => { const body = el.closest('.settings-body')!; body.scrollTop = body.scrollHeight; });
    await shot(b, 'conflict-tablet-light'); await b.reload(); await expect(b.locator('.sync-status')).toContainText('需要处理冲突'); const restored = await settings(b);
    await restored.getByRole('button', { name: '导出预览两端 JSON' }).click(); await restored.getByRole('radio', { name: '保留本地', exact: true }).check(); await restored.getByRole('checkbox', { name: /已检查目标/ }).check();
    await restored.getByRole('button', { name: '确认冲突选择并同步' }).click(); await expect(restored.locator('.sync-current')).toContainText('已同步'); expect(fake.data?.tasks[0].title).toBe('冲突远端选择');
  } finally { await other.close(); }
});

for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark'] as const) test(`P3 同步首次预览 ${width}px ${theme} 圆角/滚动/焦点/安全错误`, async ({ page, context }) => {
  const fake = new FakeGitHub(); await mock(context, fake); const data = fixture(); data.settings.theme = theme; await page.setViewportSize({ width, height: 720 }); await seed(page, data); const section = await connect(page);
  await section.evaluate((el) => { const body = el.closest('.settings-body')!; body.scrollTop = body.scrollHeight; }); await shot(page, `preview-${width}-${theme}`);
  const metrics = await page.getByRole('dialog', { name: '设置与数据', exact: true }).evaluate((el) => {
    const s = getComputedStyle(el), body = el.querySelector('.settings-body')!; return { radii: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius],
      x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right, overflow: body.scrollWidth - body.clientWidth,
      scrollTop: el.scrollTop, headerTop: el.querySelector('.dialog-header')!.getBoundingClientRect().top, top: el.getBoundingClientRect().top };
  });
  expect(new Set(metrics.radii).size).toBe(1); expect(parseFloat(metrics.radii[0])).toBeGreaterThan(10); expect(metrics.x).toBeGreaterThanOrEqual(0); expect(metrics.right).toBeLessThanOrEqual(width); expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.scrollTop).toBe(0); expect(metrics.headerTop).toBeGreaterThanOrEqual(metrics.top);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('.sync-status')).toBeFocused(); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toHaveCount(1);
});

test('P3 浏览器进程关闭重开仍恢复可信占位凭据；临时外部PAT从未用于浏览器', async ({ baseURL }, testInfo) => {
  test.setTimeout(60000); const profile = testInfo.outputPath('trusted-profile'), fake = new FakeGitHub();
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, baseURL }); await mock(context, fake); const page = context.pages()[0]; await seed(page); await connect(page); await confirmLocal(page); await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true, baseURL }); await mock(context, fake); const reopened = context.pages()[0]; await reopened.goto('/'); await expect(reopened.locator('.sync-status')).toContainText('已同步');
    const section = await settings(reopened); await section.getByRole('button', { name: '立即同步' }).click(); await expect(section.locator('.sync-current')).toContainText('已同步'); expect(fake.puts).toBe(1);
  } finally { await context?.close(); }
});
