import { expect, test, type Locator, type Page } from '@playwright/test';

async function withinViewport(page: Page, dialog: Locator) {
  const bounds = await dialog.boundingBox(); const viewport = page.viewportSize();
  expect(bounds).not.toBeNull(); expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function frameMetrics(dialog: Locator) {
  return dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect(); const header = element.querySelector('.dialog-header')!.getBoundingClientRect();
    const footer = element.querySelector('.schedule-editor-footer')!.getBoundingClientRect(); const css = getComputedStyle(element);
    return { scrollTop: element.scrollTop, overflowY: css.overflowY, radius: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius],
      top: bounds.top, bottom: bounds.bottom, headerTop: header.top, footerTop: footer.top, footerBottom: footer.bottom,
      horizontalOverflow: element.scrollWidth > element.clientWidth };
  });
}
async function storedBlocks(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<Array<{ id: string; title?: string; display?: string }>>((resolve, reject) => { const request = db.transaction('scheduleBlocks').objectStore('scheduleBlocks').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
}
async function openLongForm(page: Page) {
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建日程', exact: true });
  await dialog.getByLabel('日程标题').fill('四角与中间滚动验收');
  await dialog.getByLabel('重复频率').selectOption('weekly');
  await expect(dialog.getByLabel('日历呈现方式')).toHaveCount(0);
  return dialog;
}
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-20T09:00:00+08:00')); });

const frameCases = [
  { width: 1440, height: 760, theme: 'light' }, { width: 1440, height: 760, theme: 'dark' },
  { width: 768, height: 760, theme: 'light' }, { width: 768, height: 760, theme: 'dark' },
  { width: 390, height: 720, theme: 'light' }, { width: 390, height: 720, theme: 'dark' },
  { width: 1440, height: 480, theme: 'light' }, { width: 390, height: 480, theme: 'dark' },
] as const;
for (const frame of frameCases) test(`P2.2.1 长安排 ${frame.width}×${frame.height} ${frame.theme}：只有中间滚动，标题与保存区固定`, async ({ page }) => {
  await page.setViewportSize({ width: frame.width, height: frame.height }); await page.goto('/');
  if (frame.theme === 'dark') await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', frame.theme);
  const dialog = await openLongForm(page); const imageName = `dialog-after-${frame.width}-${frame.theme}${frame.height === 480 ? '-low' : ''}`;
  const middle = dialog.locator('.schedule-editor-scroll');
  await expect.poll(() => middle.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await middle.evaluate((el) => { el.scrollTop = 0; }); const before = await frameMetrics(dialog);
  expect(before.overflowY).toBe('hidden'); expect(before.scrollTop).toBe(0); expect(before.radius.every((radius) => Number.parseFloat(radius) >= 12)).toBe(true);
  expect(before.footerBottom).toBeLessThanOrEqual(before.bottom); expect(before.headerTop).toBeGreaterThanOrEqual(before.top); expect(before.horizontalOverflow).toBe(false);
  await page.screenshot({ path: `docs/evidence/phase4/regression/regression/${imageName}-top.png`, fullPage: true });
  await middle.hover(); await page.mouse.wheel(0, 650); await expect.poll(() => middle.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  const after = await frameMetrics(dialog); expect(after.scrollTop).toBe(0); expect(after.headerTop).toBe(before.headerTop); expect(after.footerTop).toBe(before.footerTop);
  await expect(dialog.getByRole('button', { name: '保存安排', exact: true })).toBeVisible(); await withinViewport(page, dialog);
  await middle.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: `docs/evidence/phase4/regression/regression/${imageName}-bottom.png`, fullPage: true });
  await dialog.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(dialog).not.toBeVisible();
  expect(await storedBlocks(page)).toEqual([expect.objectContaining({ title: '四角与中间滚动验收', display: 'normal' })]);
});

test('P2.2.1 390深色长表单的日期/颜色处于顶层不被裁，Esc回焦点且不关闭父表单', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 }); await page.goto('/');
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dialog = await openLongForm(page); const middle = dialog.locator('.schedule-editor-scroll');
  const before = await frameMetrics(dialog); await middle.evaluate((el) => { el.scrollTop = el.scrollHeight; }); const after = await frameMetrics(dialog);
  expect(after.headerTop).toBe(before.headerTop); expect(after.footerTop).toBe(before.footerTop); expect(after.scrollTop).toBe(0);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/dialog-after-mobile-dark.png', fullPage: true });
  await dialog.getByRole('button', { name: '选择开始时间', exact: true }).click();
  const date = page.getByRole('dialog', { name: '选择开始时间', exact: true }); await withinViewport(page, date); expect(await date.evaluate((el) => el.matches(':modal'))).toBe(true);
  await date.getByLabel('开始时间精确分钟').fill('7'); await date.getByLabel('开始时间精确分钟').press('Enter');
  expect(await storedBlocks(page)).toHaveLength(0); await expect(date).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/dialog-date-top-layer-mobile-dark.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(date).not.toBeVisible(); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '选择开始时间', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: '选择日程颜色', exact: true }).click();
  const colors = page.getByRole('dialog', { name: '选择日程颜色', exact: true }); await withinViewport(page, colors); expect(await colors.evaluate((el) => el.matches(':modal'))).toBe(true);
  await colors.getByLabel('日程颜色 HEX').fill('#123456');
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/dialog-color-top-layer-mobile-dark.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(colors).not.toBeVisible(); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '选择日程颜色', exact: true })).toBeFocused(); await expect(dialog.getByRole('button', { name: '选择日程颜色', exact: true })).toContainText('#4B91C3');
  expect(await storedBlocks(page)).toHaveLength(0);
});

test('P2.2.1 通用清单弹窗使用裁切外框和独立内容区，嵌套颜色取消保留父表单草稿', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 }); await page.goto('/'); await page.getByRole('button', { name: '打开清单导航', exact: true }).click();
  await page.getByRole('button', { name: '新建清单', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建清单', exact: true }); await dialog.getByLabel('清单名称').fill('保留父弹窗草稿');
  expect(await dialog.evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden'); await expect(dialog.locator(':scope > .dialog-content')).toHaveCount(1);
  await dialog.getByRole('button', { name: '选择清单颜色', exact: true }).click(); const color = page.getByRole('dialog', { name: '选择清单颜色', exact: true });
  await color.getByLabel('清单颜色 HEX').fill('#abcdef'); await page.keyboard.press('Escape'); await expect(color).not.toBeVisible(); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '选择清单颜色', exact: true })).toBeFocused(); await expect(dialog.getByLabel('清单名称')).toHaveValue('保留父弹窗草稿');
  await withinViewport(page, dialog); await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/dialog-list-mobile-light.png', fullPage: true });
});
