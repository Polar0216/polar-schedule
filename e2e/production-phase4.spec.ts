import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fixture } from '../src/sync/testSupport';
import { addTask, authorize, confirmLocal, importFixture, mockEnvironments, openSync, snapshot, switchEnvironment } from './helpers/phase4';

test('P4 测试→正式必须确认、错PAT拒绝、全新base预览，刷新恢复所选绑定，切回也不自动上传', async ({ page, context }) => {
  const mock = await mockEnvironments(context); await page.goto('/'); await importFixture(page); await openSync(page); await authorize(page, '测试'); await confirmLocal(page, '测试');
  const before = await snapshot(page), section = page.locator('[data-settings-section=sync]');
  await section.getByLabel('同步环境', { exact: true }).selectOption('production');
  const confirmation = page.getByRole('dialog', { name: '切换到正式环境？', exact: true }); await expect(confirmation).toContainText('不会自动上传');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click(); expect(mock.production.calls).toHaveLength(0);
  await switchEnvironment(page, 'production'); expect(await snapshot(page)).toEqual(before); expect(mock.production.calls).toHaveLength(0);
  await section.getByLabel('正式仓库 PAT', { exact: true }).fill('mock-test-browser'); await section.getByRole('button', { name: '验证并连接正式仓库', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('权限'); expect(mock.production.puts).toBe(0);
  await authorize(page, '正式'); await page.waitForTimeout(3300); expect(mock.production.puts).toBe(0); await confirmLocal(page, '正式'); expect(mock.production.puts).toBe(1);
  await page.reload(); await expect(page.locator('.sync-status')).toContainText('正式 · 已同步'); await openSync(page); await switchEnvironment(page, 'test');
  await authorize(page, '测试'); expect(mock.test.puts).toBe(1); expect(mock.production.puts).toBe(1); expect(await snapshot(page)).toEqual(before);
});

for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark'] as const) test(`P4 正式首次确认${width}px ${theme}：边界、圆角、同源风险与Esc`, async ({ page, context }) => {
  const mock = await mockEnvironments(context); await page.setViewportSize({ width, height: 760 }); await page.goto('/');
  const data = fixture(); data.settings.theme = theme; await importFixture(page, data); await openSync(page); await switchEnvironment(page, 'production'); await authorize(page, '正式');
  const section = page.locator('[data-settings-section=sync]'); await expect(section).toContainText('共享 origin');
  await section.evaluate((el) => { const body = el.closest('.settings-body')!; body.scrollTop = body.scrollHeight - body.clientHeight; });
  const metrics = await page.getByRole('dialog', { name: '设置与数据', exact: true }).evaluate((el) => {
    const rect = el.getBoundingClientRect(), css = getComputedStyle(el), body = el.querySelector('.settings-body')!;
    return { x: rect.x, right: rect.right, scroll: el.scrollTop, overflow: body.scrollWidth - body.clientWidth, radii: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius] };
  });
  expect(metrics.x).toBeGreaterThanOrEqual(0); expect(metrics.right).toBeLessThanOrEqual(width); expect(metrics.scroll).toBe(0); expect(metrics.overflow).toBeLessThanOrEqual(1); expect(new Set(metrics.radii).size).toBe(1);
  await mkdir('docs/evidence/phase4', { recursive: true }); await page.screenshot({ path: `docs/evidence/phase4/production-preview-${width}-${theme}.png`, fullPage: true });
  expect(mock.production.puts).toBe(0); await page.keyboard.press('Escape'); await expect(page.locator('.sync-status')).toBeFocused();
});

test('P4 正式Mock双端离线新增与在线不同记录合并，未连接时绝无请求', async ({ page, context, browser }) => {
  const a = await mockEnvironments(context); await page.goto('/'); await importFixture(page); await page.waitForTimeout(3200); expect(a.requests).toHaveLength(0);
  await openSync(page); await switchEnvironment(page, 'production'); await authorize(page, '正式'); await confirmLocal(page, '正式'); await page.keyboard.press('Escape');
  await context.setOffline(true); await addTask(page, 'A离线新增');
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  try {
    // Both Mock devices share the same remote backend, never the real repository.
    await other.route('https://api.github.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-github-api-version,accept', 'access-control-allow-methods': 'GET,PUT,OPTIONS' } });
      const response = await a.production.fetch(route.request().url(), { method: route.request().method(), body: route.request().postData() ?? undefined });
      await route.fulfill({ status: response.status, body: await response.text(), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
    });
    const b = await other.newPage(); await b.goto('/'); await importFixture(b); await openSync(b); await switchEnvironment(b, 'production'); await authorize(b, '正式'); await confirmLocal(b, '正式'); await b.keyboard.press('Escape');
    await b.getByRole('button', { name: '虚构同步任务 2', exact: true }).click(); await b.getByLabel('任务标题', { exact: true }).fill('B在线修改'); await b.getByRole('button', { name: '保存任务', exact: true }).click(); await b.getByRole('button', { name: '返回待办', exact: true }).click();
    const sync = await openSync(b); await sync.getByRole('button', { name: '立即同步', exact: true }).click(); await expect.poll(() => a.production.data?.tasks.some((task) => task.title === 'B在线修改')).toBe(true);
    await context.setOffline(false); const current = await openSync(page); await current.getByRole('button', { name: '立即同步', exact: true }).click();
    await expect(current.locator('.sync-current')).toContainText('已同步'); expect(a.production.data?.tasks.some((task) => task.title === 'A离线新增')).toBe(true); expect(a.production.data?.tasks.some((task) => task.title === 'B在线修改')).toBe(true);
  } finally { await other.close(); }
});
