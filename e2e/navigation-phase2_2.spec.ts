import { expect, test, type Page } from '@playwright/test';

async function jump(page: Page, text: string) {
  await page.getByRole('button', { name: '跳转日期', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '选择跳转日期', exact: true });
  await dialog.getByLabel('跳转日期输入', { exact: true }).fill(text);
  await dialog.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function columns(page: Page) { return page.locator('.fc-timegrid-col[data-date]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-date'))); }
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-20T09:00:00+08:00')); await page.goto('/'); });

test('顶部跳转复用月历：日视图闰日、月视图年月、跨年与非法输入保持视图', async ({ page }) => {
  await page.getByRole('button', { name: '日', exact: true }).click();
  await jump(page, '2028-02-29'); await expect(page.locator('h1')).toContainText('2028年2月29日'); expect(await columns(page)).toEqual(['2028-02-29']);
  await page.getByRole('button', { name: '跳转日期', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '选择跳转日期', exact: true });
  await dialog.getByLabel('跳转日期输入', { exact: true }).fill('2027-02-29'); await dialog.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('有效日期'); await expect(page.locator('h1')).toContainText('2028年2月29日');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: '跳转日期', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '月', exact: true }).click(); await jump(page, '2027-12'); await expect(page.locator('h1')).toContainText('2027年12月');
  await page.getByRole('button', { name: '跳转日期', exact: true }).click(); dialog = page.getByRole('dialog', { name: '选择跳转日期', exact: true });
  await dialog.getByLabel('跳转日期输入', { exact: true }).fill('2028-02-29');
  await dialog.locator('[data-day="2028-02-29"] button').click();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-jump-calendar-light.png', fullPage: true });
  await dialog.getByRole('button', { name: '跳转', exact: true }).click(); await expect(page.locator('h1')).toContainText('2028年2月');
  await page.getByRole('button', { name: '下一段日期', exact: true }).click(); await expect(page.locator('h1')).toContainText('2028年3月');
});

test('周跳转按用户周起始定位跨年周，键盘与外部关闭不改变数据', async ({ page }) => {
  await jump(page, '2026-12-31'); expect((await columns(page))[0]).toBe('2026-12-28'); expect((await columns(page))[6]).toBe('2027-01-03');
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true }); await settings.getByLabel('周起始日', { exact: true }).selectOption('0');
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await jump(page, '2026-12-31'); expect((await columns(page))[0]).toBe('2026-12-27'); expect((await columns(page))[6]).toBe('2027-01-02');
  await page.getByRole('button', { name: '跳转日期', exact: true }).focus(); await page.keyboard.press('Enter');
  const popup = page.getByRole('dialog', { name: '选择跳转日期', exact: true });
  await popup.getByLabel('跳转日期输入', { exact: true }).fill('2030-01-01'); await popup.getByLabel('跳转日期输入', { exact: true }).press('Enter');
  expect((await columns(page))).toContain('2030-01-01'); const title = await page.locator('h1').textContent();
  await page.getByRole('button', { name: '跳转日期', exact: true }).click(); await page.mouse.click(5, 5); await expect(popup).not.toBeVisible();
  await expect(page.locator('h1')).toHaveText(title!); await expect(page.getByRole('button', { name: '跳转日期', exact: true })).toBeFocused();
});

test('390深色日期跳转与搜索截止筛选共用日期控件且无横溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await page.getByRole('button', { name: '跳转日期', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '选择跳转日期', exact: true });
  await dialog.getByLabel('跳转日期输入', { exact: true }).fill('2029-01-01');
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-jump-mobile-dark.png', fullPage: true });
  const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: '跳转', exact: true }).click(); await expect(page.locator('h1')).toContainText('2029年1月1日');
  await page.getByRole('button', { name: '待办', exact: true }).click(); await page.getByRole('button', { name: '搜索筛选', exact: true }).click();
  await page.getByRole('button', { name: '选择截止日期从', exact: true }).click();
  const filterPicker = page.getByRole('dialog', { name: '选择截止日期从', exact: true }); await expect(filterPicker.getByLabel('24 小时时间选择')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(filterPicker).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('input[type="date"], input[type="datetime-local"]').count()).toBe(0);
});

test('纽约显示日期跳转保持同一天，跨DST日期无UTC偏移', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/'); await page.getByRole('button', { name: '日', exact: true }).click();
    for (const date of ['2026-03-08', '2026-11-01', '2028-02-29', '2027-01-01']) { await jump(page, date); expect(await columns(page)).toEqual([date]); }
  } finally { await context.close(); }
});
