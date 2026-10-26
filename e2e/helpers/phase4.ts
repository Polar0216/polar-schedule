import { expect, type BrowserContext, type Page } from '@playwright/test';
import { FakeGitHub, fixture } from '../../src/sync/testSupport';
import { PRODUCTION_TARGET } from '../../src/sync/types';
import type { ScheduleData } from '../../src/domain/schema';
export async function mockEnvironments(context: BrowserContext) {
  const test = new FakeGitHub(), production = new FakeGitHub(null, PRODUCTION_TARGET);
  const requests: Array<{ repository: string; method: string; authorized: boolean }> = [];
  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-github-api-version,accept', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const fake = new URL(request.url()).pathname.startsWith('/repos/Polar0216/polar-schedule-data-test') ? test : production;
    const token = fake === test ? 'mock-test-browser' : 'mock-production-browser';
    const authorized = request.headers().authorization === `Bearer ${token}`;
    requests.push({ repository: fake.target.repo, method: request.method(), authorized });
    if (!authorized) return route.fulfill({ status: 403, body: '{}', contentType: 'application/json', headers });
    try { const response = await fake.fetch(request.url(), { method: request.method(), body: request.postData() ?? undefined });
      await route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json', headers });
    } catch { await route.abort('failed'); }
  });
  return { test, production, requests };
}
export async function snapshot(page: Page): Promise<ScheduleData> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('polar-schedule'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { const names = ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions', 'tombstones', 'metadata'], tx = db.transaction(names, 'readonly');
      const rows = await Promise.all(names.map((name) => new Promise<[string, unknown[]]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve([name, r.result]); })));
      const data = Object.fromEntries(rows), root = data.metadata[0] as { settings: ScheduleData['settings']; updatedAt: string };
      delete data.metadata; return { ...data, schemaVersion: 3, settings: root.settings, updatedAt: root.updatedAt } as ScheduleData;
    } finally { db.close(); }
  });
}
export async function importFixture(page: Page, data = fixture()) {
  if (!await page.getByRole('dialog', { name: '设置与数据', exact: true }).count()) await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await dialog.getByRole('button', { name: '数据备份与恢复', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'invented-phase4.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await dialog.getByRole('button', { name: '继续替换导入…', exact: true }).click();
  await page.getByRole('button', { name: '确认备份并替换', exact: true }).click();
  await expect(dialog.getByText('导入预览 · schemaVersion 3', { exact: true })).not.toBeVisible(); await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).tasks.length).toBe(data.tasks.length);
}
export async function openSync(page: Page) { await page.locator('.sync-status').click(); return page.locator('[data-settings-section=sync]'); }
export async function authorize(page: Page, environment: '测试' | '正式', remember = true) {
  const section = page.locator('[data-settings-section=sync]'); await section.getByLabel(`${environment}仓库 PAT`, { exact: true }).fill(environment === '测试' ? 'mock-test-browser' : 'mock-production-browser');
  await section.getByRole('checkbox', { name: /记住此设备/ }).setChecked(remember); await section.getByRole('button', { name: `验证并连接${environment}仓库`, exact: true }).click();
  await expect(section.getByText('首次同步预览 · 需要确认', { exact: true })).toBeVisible();
}
export async function switchEnvironment(page: Page, environment: 'test' | 'production') {
  const section = page.locator('[data-settings-section=sync]'); await section.getByLabel('同步环境', { exact: true }).selectOption(environment);
  await page.getByRole('button', { name: '确认断开并切换', exact: true }).click();
  await expect(section.getByLabel('同步 Repository', { exact: true })).toHaveValue(environment === 'test' ? 'polar-schedule-data-test' : 'polar-schedule-data');
}
export async function confirmLocal(page: Page, environment: '测试' | '正式') {
  const section = page.locator('[data-settings-section=sync]'); await section.getByRole('checkbox', { name: /已检查目标/ }).check();
  await section.getByRole('button', { name: `确认以本地创建 / 替换${environment}快照`, exact: true }).click(); await expect(section.locator('.sync-current')).toContainText('已同步');
}
export async function addTask(page: Page, title: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click(); await page.getByLabel('任务标题', { exact: true }).fill(title);
  await page.getByRole('button', { name: '保存任务', exact: true }).click(); await page.getByRole('button', { name: '返回待办', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).tasks.some((task) => task.title === title)).toBe(true);
}
