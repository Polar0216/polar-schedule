import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { initialData, type ScheduleBlock, type ScheduleData } from '../src/domain/schema';

const stamp = '2026-10-19T01:00:00.000Z';
const metadata = () => ({ id: crypto.randomUUID(), revision: 3, createdAt: stamp, updatedAt: stamp });
const instant = (time: string) => new Date(`2026-10-19T${time}:00+08:00`).toISOString();
function event(title: string, start: string, end: string, legacy = false): ScheduleBlock {
  return { ...metadata(), type: 'event', title, description: '完整记录与时间保持独立', display: legacy ? 'background' : 'normal', color: '#438e9a', allDay: false,
    startAt: instant(start), endAt: instant(end), timeZone: 'Asia/Shanghai' };
}
function fixture(count = 4): ScheduleData {
  const data = initialData(); const taskId = crypto.randomUUID();
  data.settings = { ...data.settings, theme: 'light', timeZone: 'Asia/Shanghai', showBackground: false, defaultView: 'week' };
  data.tasks = [{ ...metadata(), id: taskId, title: '已完成任务与本次状态独立', description: '', listId: data.lists[0].id,
    status: 'done', completedAt: stamp, priority: 'none', order: 1, tagIds: [], subtasks: [] }];
  data.scheduleBlocks = [event('长安排 08:00—23:00', '08:00', '23:00'), event('旧课程 08:30—09:45', '08:30', '09:45', true),
    { ...metadata(), type: 'task', taskId, color: '#a36d97', allDay: false, startAt: instant('08:30'), endAt: instant('10:00'), timeZone: 'Asia/Shanghai', executionStatus: 'completed', completedAt: stamp },
    { ...metadata(), type: 'task', taskId, color: '#a36d97', allDay: false, startAt: instant('08:30'), endAt: instant('10:00'), timeZone: 'Asia/Shanghai', executionStatus: 'pending' },
  ].slice(0, count) as ScheduleBlock[];
  return data;
}
async function seed(page: Page, data: ScheduleData) {
  await page.goto('/'); await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'legacy-parallel-v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await settings.getByRole('button', { name: '继续替换导入…' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true });
  await confirmation.getByRole('button', { name: '确认备份并替换', exact: true }).click(); await expect(confirmation).not.toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
}
async function stored(page: Page): Promise<{ blocks: ScheduleBlock[]; settings: ScheduleData['settings'] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = db.transaction(['scheduleBlocks', 'metadata'], 'readonly');
      const rows = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [blocks, state] = await Promise.all([rows(transaction.objectStore('scheduleBlocks').getAll()), rows(transaction.objectStore('metadata').get('state'))]);
      return { blocks: blocks as ScheduleBlock[], settings: (state as { settings: ScheduleData['settings'] }).settings };
    } finally { db.close(); }
  });
}
const card = (page: Page, block: ScheduleBlock) => page.locator(`.fc-timegrid-event[data-block-id="${block.id}"]`);
const preview = (page: Page) => page.getByRole('dialog', { name: /^当天安排 ·/ });
async function screenshot(page: Page, name: string) {
  await mkdir('docs/evidence/phase4/regression/regression', { recursive: true }); await page.screenshot({ path: `docs/evidence/phase4/regression/regression/${name}.png`, fullPage: true });
}
async function parallel(page: Page, count: number) {
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(count);
  const boxes = await page.locator('.fc-timegrid-event').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect(); return { x: box.x, width: box.width, height: box.height };
  }).sort((a, b) => a.x - b.x));
  for (const box of boxes) { expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0); }
  for (let index = 1; index < boxes.length; index++) expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThanOrEqual(boxes[index].x + 1);
  await expect(page.locator('.fc-bg-event,.calendar-time-marker,.calendar-time-marker-layer,.calendar-day-background-button,.calendar-background-list,.fc-timegrid-more-link')).toHaveCount(0);
}
async function dragBy(page: Page, element: Locator, distance: number) {
  await element.scrollIntoViewIfNeeded(); const bounds = await element.boundingBox(); if (!bounds) throw new Error('拖动目标缺失');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(12, bounds.height / 2)); await page.mouse.down(); await page.waitForTimeout(100);
  await page.mouse.move(bounds.x + bounds.width / 2 + 6, bounds.y + 12 + Math.sign(distance) * 6, { steps: 3 });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(12, bounds.height / 2) + distance, { steps: 18 });
  await page.waitForTimeout(150); await page.mouse.up();
}
async function moveAndResize(page: Page, block: ScheduleBlock) {
  const row = await page.locator('.fc-timegrid-slot-lane[data-time="09:00:00"]').boundingBox(); if (!row) throw new Error('时间轴缺失');
  await dragBy(page, card(page, block).locator('.fc-event-main'), row.height * 2);
  await expect.poll(async () => (await stored(page)).blocks.find((entry) => entry.id === block.id)?.revision).toBe(block.revision + 1);
  await card(page, block).hover(); await dragBy(page, card(page, block).locator('.fc-event-resizer-end'), row.height);
  await expect.poll(async () => (await stored(page)).blocks.find((entry) => entry.id === block.id)?.revision).toBe(block.revision + 2);
  const changed = (await stored(page)).blocks.find((entry) => entry.id === block.id)!;
  if (block.allDay || changed.allDay) throw new Error('应为定时安排');
  expect(Date.parse(changed.startAt) - Date.parse(block.startAt)).toBe(3600000);
  expect(Date.parse(changed.endAt) - Date.parse(changed.startAt)).toBe(Date.parse(block.endAt) - Date.parse(block.startAt) + 1800000);
  return changed;
}

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); });

test('两三四条重叠在日周全部普通并列，浅深模式无容量摘要或背景分层', async ({ page }) => {
  for (const count of [2, 3, 4]) {
    await seed(page, fixture(count)); const before = await stored(page);
    for (const view of ['日', '周']) {
      await page.getByRole('button', { name: view, exact: true }).click(); await parallel(page, count);
      for (const block of before.blocks) {
        const element = card(page, block); await expect(element).toHaveAttribute('role', 'button'); await expect(element).toHaveAttribute('tabindex', '0');
        expect(await element.evaluate((node) => { const bounds = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 12)); })).toBe(true);
      }
      await screenshot(page, `after-${view === '日' ? 'day' : 'week'}-${count}-light`);
      await page.getByRole('button', { name: '切换深色模式', exact: true }).click(); await parallel(page, count);
      await screenshot(page, `after-${view === '日' ? 'day' : 'week'}-${count}-dark`); await page.getByRole('button', { name: '切换浅色模式', exact: true }).click();
    }
    expect((await stored(page)).blocks).toEqual(before.blocks); expect((await stored(page)).settings.showBackground).toBe(false);
  }
});

test('旧短课程和已完成任务块真实拖动拉伸，保留旧字段及各段独立状态', async ({ page }) => {
  const data = fixture(); await seed(page, data); await page.getByRole('button', { name: '日', exact: true }).click();
  const legacy = data.scheduleBlocks[1]; const completed = data.scheduleBlocks[2]; const pending = data.scheduleBlocks[3];
  const legacyMoved = await moveAndResize(page, legacy); expect(legacyMoved).toMatchObject({ display: 'background' });
  const completedMoved = await moveAndResize(page, completed); expect(completedMoved).toMatchObject({ executionStatus: 'completed', completedAt: stamp });
  expect((await stored(page)).blocks.find((block) => block.id === pending.id)).toEqual(pending);
  await expect(card(page, completed)).toContainText('已完成'); await expect(card(page, pending)).not.toHaveClass(/completed-event/);
  expect(await card(page, completed).evaluate((node) => getComputedStyle(node).borderStyle)).toBe('solid');
  await card(page, legacy).click(); const edit = page.getByRole('dialog', { name: '编辑日程', exact: true });
  await expect(edit.getByLabel('日历呈现方式')).toHaveCount(0); await edit.getByLabel('日程备注').fill('直接编辑旧记录');
  await edit.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(edit).not.toBeVisible();
  expect((await stored(page)).blocks.find((block) => block.id === legacy.id)).toMatchObject({ display: 'background', description: '直接编辑旧记录' });
});

test('旧显示值在日周月与完整预览一致可编辑，查看和切换不改持久记录', async ({ page }) => {
  const data = fixture(2); const series = event('每周旧课程', '11:00', '12:00', true);
  if (series.type === 'event') series.recurrence = { frequency: 'weekly', interval: 1, weekdays: [1], startDate: '2026-10-19', localTime: '11:00', durationMinutes: 60, count: 2 };
  const allDay: ScheduleBlock = { ...metadata(), type: 'event', title: '旧全天跨日安排', description: '', display: 'background', color: '#b48a52', allDay: true, startDate: '2026-10-19', endDate: '2026-10-21', timeZone: 'Asia/Shanghai' };
  data.scheduleBlocks.push(series, allDay); await seed(page, data); const before = await stored(page);
  for (const view of ['日', '周', '月']) {
    await page.getByRole('button', { name: view, exact: true }).click(); await expect(page.locator('.fc-bg-event,.calendar-time-marker')).toHaveCount(0);
    await page.getByRole('button', { name: '预览2026-10-19的安排', exact: true }).click(); await expect(preview(page).locator('li')).toHaveCount(4);
    await expect(preview(page)).toContainText('旧全天跨日安排'); await expect(preview(page)).toContainText('每周旧课程');
    expect((await preview(page).locator('.calendar-list-kind').allTextContents()).some((text) => text.includes('▧'))).toBe(false); await preview(page).getByRole('button', { name: /查看安排 每周旧课程/ }).click();
    const edit = page.getByRole('dialog', { name: '编辑重复日程', exact: true }); await expect(edit.getByLabel('编辑范围')).toHaveValue('occurrence');
    await expect(edit.getByLabel('日历呈现方式')).toHaveCount(0); await edit.getByRole('button', { name: '取消', exact: true }).click();
  }
  const month = page.locator('.fc-daygrid-day[data-date="2026-10-19"]'); await month.locator('.fc-daygrid-more-link').click();
  await expect(page.locator('.fc-more-popover .fc-event')).toHaveCount(4);
  expect((await stored(page)).blocks).toEqual(before.blocks); expect((await stored(page)).settings.showBackground).toBe(false);
});

test('390手机日周全部并列，日期预览完整可点且无特殊边栏或横溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const data = fixture(); data.settings.theme = 'dark'; await seed(page, data);
  for (const view of ['日', '周']) {
    await page.getByRole('button', { name: view, exact: true }).click(); await parallel(page, 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot(page, `after-${view === '日' ? 'day' : 'week'}-4-mobile-dark`);
    await page.getByRole('button', { name: '预览2026-10-19的安排', exact: true }).click(); await expect(preview(page).locator('li')).toHaveCount(4);
    await preview(page).getByRole('button', { name: /查看安排 旧课程/ }).click();
    const edit = page.getByRole('dialog', { name: '编辑日程', exact: true }); await expect(edit.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-19T08:30');
    await edit.getByRole('button', { name: '取消', exact: true }).click();
  }
});
