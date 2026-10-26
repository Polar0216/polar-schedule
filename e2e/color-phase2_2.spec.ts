import { expect, test, type Page, type Locator } from '@playwright/test';
import type { List, ScheduleBlock, Tag } from '../src/domain/schema';

type Stored = { lists: List[]; tags: Tag[]; scheduleBlocks: ScheduleBlock[] };
async function stored(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(['lists', 'tags', 'scheduleBlocks']);
      const read = (name: string) => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error); });
      const [lists, tags, scheduleBlocks] = await Promise.all(['lists', 'tags', 'scheduleBlocks'].map(read));
      return { lists, tags, scheduleBlocks } as Stored;
    } finally { db.close(); }
  });
}
async function picker(page: Page, label: string) {
  await page.getByRole('button', { name: `选择${label}`, exact: true }).click();
  const popup = page.getByRole('dialog', { name: `选择${label}`, exact: true }); await expect(popup).toBeVisible(); return popup;
}
async function withinViewport(page: Page, popup: Locator) {
  const box = await popup.boundingBox(); const viewport = page.viewportSize();
  expect(box).not.toBeNull(); expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); });

test('P2.2 三处统一选色：预设、有效与无效HEX、真实色相/饱和度鼠标和键盘、保存刷新映射', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: '新建日程', exact: true })).toBeVisible();
  expect(await page.locator('input[type="color"]').count()).toBe(0);
  await page.getByRole('button', { name: '新建清单', exact: true }).first().click();
  const listForm = page.getByRole('dialog', { name: '新建清单', exact: true }); await listForm.getByLabel('清单名称').fill('颜色课程');
  let popup = await picker(page, '清单颜色'); await popup.getByRole('button', { name: '颜色 #43a58a', exact: true }).click();
  expect((await stored(page)).lists).toHaveLength(1); await popup.getByRole('button', { name: '确认颜色', exact: true }).click();
  expect((await stored(page)).lists).toHaveLength(1); await listForm.getByRole('button', { name: '保存清单', exact: true }).click(); await expect(listForm).not.toBeVisible();
  expect((await stored(page)).lists.find((list) => list.title === '颜色课程')?.color).toBe('#43a58a');

  await page.getByRole('button', { name: '标签管理', exact: true }).click();
  const tagForm = page.getByRole('dialog', { name: '标签管理', exact: true }); await tagForm.getByLabel('标签名称').fill('自定义颜色标签');
  popup = await picker(page, '标签颜色'); await popup.getByLabel('标签颜色 HEX').fill('#xyz');
  await expect(popup.getByRole('alert')).toContainText('#RRGGBB'); await expect(popup.getByRole('button', { name: '确认颜色', exact: true })).toBeDisabled();
  await popup.getByLabel('标签颜色 HEX').fill('#1A2B3C'); expect((await stored(page)).tags).toHaveLength(0);
  await withinViewport(page, popup); await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-color-tag-light.png', fullPage: true });
  await popup.getByRole('button', { name: '确认颜色', exact: true }).click(); expect((await stored(page)).tags).toHaveLength(0);
  await tagForm.getByRole('button', { name: '创建标签', exact: true }).click(); await expect(tagForm.getByRole('button', { name: '编辑标签 自定义颜色标签', exact: true })).toBeVisible();
  expect((await stored(page)).tags[0].color).toBe('#1a2b3c'); await tagForm.getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const eventForm = page.getByRole('dialog', { name: '新建日程', exact: true }); await eventForm.getByLabel('日程标题').fill('自定义颜色课程');
  await eventForm.getByLabel('开始时间', { exact: true }).fill('2026-10-19T09:00'); await eventForm.getByLabel('结束时间', { exact: true }).fill('2026-10-19T10:00');
  popup = await picker(page, '日程颜色'); const original = await popup.getByLabel('日程颜色 HEX').inputValue();
  const hue = popup.getByRole('slider', { name: 'Hue', exact: true }); let box = await hue.boundingBox(); if (!box) throw new Error('色相条不可见');
  await page.mouse.move(box.x + box.width * .2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .75, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(popup.getByLabel('日程颜色 HEX')).not.toHaveValue(original);
  const saturation = popup.getByRole('slider', { name: 'Color', exact: true }); box = await saturation.boundingBox(); if (!box) throw new Error('饱和度色板不可见');
  await page.mouse.click(box.x + box.width * .6, box.y + box.height * .3);
  const beforeKey = await popup.getByLabel('日程颜色 HEX').inputValue(); await hue.focus(); await hue.press('ArrowLeft');
  await expect(popup.getByLabel('日程颜色 HEX')).not.toHaveValue(beforeKey);
  expect((await stored(page)).scheduleBlocks).toHaveLength(0); await withinViewport(page, popup);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-color-event-light-bottom.png', fullPage: true });
  // react-colorful propagates pointer/keyboard changes through an effect. Capture
  // the settled visible selection at confirmation, not an intermediate frame.
  await popup.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const custom = await popup.getByLabel('日程颜色 HEX').inputValue(); expect(custom).toMatch(/^#[0-9a-f]{6}$/);
  await expect(popup.locator('output')).toHaveText(custom.toUpperCase());
  await popup.getByRole('button', { name: '确认颜色', exact: true }).click(); await eventForm.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(eventForm).not.toBeVisible();
  await page.reload(); const data = await stored(page); expect(data.lists.find((list) => list.title === '颜色课程')?.color).toBe('#43a58a'); expect(data.tags[0].color).toBe('#1a2b3c');
  expect(data.scheduleBlocks[0].color).toBe(custom);
  await page.locator('.fc-timegrid-event', { hasText: '自定义颜色课程' }).click();
  const edit = page.getByRole('dialog', { name: '编辑日程', exact: true }); await expect(edit.getByRole('button', { name: '选择日程颜色', exact: true })).toContainText(custom.toUpperCase());
  expect(await page.locator('input[type="color"]').count()).toBe(0);
});

test('P2.2 选色取消、Esc、点外部与焦点恢复不会关闭或提交上层表单', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '标签管理', exact: true }).click();
  const parent = page.getByRole('dialog', { name: '标签管理', exact: true }); await parent.getByLabel('标签名称').fill('未保存标签');
  let popup = await picker(page, '标签颜色'); await popup.getByLabel('标签颜色 HEX').fill('#123456'); await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible(); await expect(parent).toBeVisible(); await expect(parent.getByRole('button', { name: '选择标签颜色', exact: true })).toBeFocused();
  await expect(parent.getByRole('button', { name: '选择标签颜色', exact: true })).toContainText('#7774D5'); expect((await stored(page)).tags).toHaveLength(0);
  popup = await picker(page, '标签颜色'); await popup.getByRole('button', { name: '颜色 #c76b60', exact: true }).click(); await popup.getByRole('button', { name: '取消', exact: true }).click();
  await expect(parent).toBeVisible(); await expect(parent.getByRole('button', { name: '选择标签颜色', exact: true })).toContainText('#7774D5');
  popup = await picker(page, '标签颜色'); await page.mouse.click(4, 4); await expect(popup).not.toBeVisible(); await expect(parent).toBeVisible(); expect((await stored(page)).tags).toHaveLength(0);
  await expect(parent.getByLabel('标签名称')).toHaveValue('未保存标签');
});

test('P2.2 深色390触屏：底部入口弹层边界、自定义触摸与键盘确认，父表单保留', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
  try {
    const page = await context.newPage(); await page.goto('/'); await page.getByRole('button', { name: '切换深色模式', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '新建日程', exact: true }).click(); const parent = page.getByRole('dialog', { name: '新建日程', exact: true });
    await parent.getByLabel('日程标题').fill('触摸颜色草稿'); const popup = await picker(page, '日程颜色'); await withinViewport(page, popup);
    const original = await popup.getByLabel('日程颜色 HEX').inputValue(); const hue = popup.getByRole('slider', { name: 'Hue', exact: true }); const box = await hue.boundingBox(); if (!box) throw new Error('色相触摸入口不可见');
    await page.touchscreen.tap(box.x + box.width * .8, box.y + box.height / 2); await expect(popup.getByLabel('日程颜色 HEX')).not.toHaveValue(original);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-color-event-mobile-dark.png', fullPage: true });
    await popup.getByLabel('日程颜色 HEX').fill('#3567ab'); await popup.getByLabel('日程颜色 HEX').press('Enter');
    await expect(popup).not.toBeVisible(); await expect(parent).toBeVisible(); expect((await stored(page)).scheduleBlocks).toHaveLength(0);
    await expect(parent.getByRole('button', { name: '选择日程颜色', exact: true })).toBeFocused(); await expect(parent.getByRole('button', { name: '选择日程颜色', exact: true })).toContainText('#3567AB');
    expect(await page.locator('input[type="color"]').count()).toBe(0);
  } finally { await context.close(); }
});
