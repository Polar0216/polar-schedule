import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { INBOX_ID, initialData, type ScheduleBlock, type ScheduleData } from '../src/domain/schema';

const stamp = '2026-10-19T01:00:00.000Z';
const iso = (time: string) => new Date(`2026-10-19T${time}:00+08:00`).toISOString();
const meta = () => ({ id: crypto.randomUUID(), revision: 1, createdAt: stamp, updatedAt: stamp });
function event(title: string, start: string, end: string, display: 'normal' | 'background' = 'normal'): ScheduleBlock {
  return { ...meta(), type: 'event', title, description: '', allDay: false, startAt: iso(start), endAt: iso(end), timeZone: 'Asia/Shanghai', color: '#43a58a', display };
}
function fixture(blocks: ScheduleBlock[], theme: 'light' | 'dark' = 'light'): ScheduleData {
  const data = initialData(); data.settings.theme = theme; data.settings.timeZone = 'Asia/Shanghai'; data.settings.defaultView = 'week'; data.scheduleBlocks = blocks;
  return data;
}
async function importFixture(page: Page, data: ScheduleData) {
  await page.goto('/'); await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'isolated-overlap-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await settings.getByRole('button', { name: '继续替换导入…' }).click();
  const confirm = page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true });
  await confirm.getByRole('button', { name: '确认备份并替换', exact: true }).click(); await expect(confirm).not.toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
}
async function storedBlocks(page: Page): Promise<ScheduleBlock[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<ScheduleBlock[]>((resolve, reject) => { const request = db.transaction('scheduleBlocks', 'readonly').objectStore('scheduleBlocks').getAll(); request.onsuccess = () => resolve(request.result as ScheduleBlock[]); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
}
const native = (page: Page, block: ScheduleBlock) => page.locator(`.fc-timegrid-event[data-block-id="${block.id}"]`);
async function reachable(element: Locator) {
  await expect(element).toBeVisible();
  expect(await element.evaluate((node) => { const box = node.getBoundingClientRect(); const x = box.x + box.width / 2; const y = box.y + Math.min(12, box.height / 2); return node.contains(document.elementFromPoint(x, y)); })).toBe(true);
}
async function dragBy(page: Page, element: Locator, deltaY: number) {
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox(); if (!box) throw new Error('前景拖拽目标不可见');
  const viewport = await page.locator('.fc-scroller-liquid-absolute').boundingBox();
  if (!viewport) throw new Error('时间轴滚动区域不可见');
  const visibleTop = Math.max(box.y, viewport.y); const visibleBottom = Math.min(box.y + box.height, viewport.y + viewport.height);
  // A 15-hour block is taller than the viewport: drag its visible interior,
  // rather than sending mouse events to its off-screen start after scrolling.
  const x = box.x + box.width / 2;
  const y = box.height > viewport.height
    ? Math.min(visibleBottom - 4, Math.max(visibleTop + 12, viewport.y + Math.abs(deltaY) + 16))
    : box.y + Math.min(12, box.height / 2);
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(100);
  await page.mouse.move(x + 6, y + Math.sign(deltaY) * 6, { steps: 3 });
  await page.mouse.move(x, y + deltaY, { steps: 18 }); await page.waitForTimeout(150); await page.mouse.up();
}
async function moveAndResize(page: Page, block: ScheduleBlock, direction = 1) {
  const lane = await page.locator('.fc-timegrid-slot-lane[data-time="09:00:00"]').boundingBox(); if (!lane) throw new Error('时间粒度不可见');
  const original = (await storedBlocks(page)).find((entry) => entry.id === block.id)!;
  await dragBy(page, native(page, block).locator('.fc-event-main'), lane.height * 2 * direction);
  await expect.poll(async () => (await storedBlocks(page)).find((entry) => entry.id === block.id)?.revision).toBe(original.revision + 1);
  let moved = (await storedBlocks(page)).find((entry) => entry.id === block.id)!;
  if (original.allDay || moved.allDay) throw new Error('应为定时安排');
  expect(Date.parse(moved.startAt) - Date.parse(original.startAt)).toBe(3600000 * direction);
  await native(page, block).hover();
  const resize = native(page, block).locator('.fc-event-resizer-end');
  await dragBy(page, resize, lane.height);
  await expect.poll(async () => (await storedBlocks(page)).find((entry) => entry.id === block.id)?.revision).toBe(original.revision + 2);
  moved = (await storedBlocks(page)).find((entry) => entry.id === block.id)!;
  if (moved.allDay) throw new Error('应为定时安排');
  expect(Date.parse(moved.endAt) - Date.parse(moved.startAt)).toBe(Date.parse(original.endAt) - Date.parse(original.startAt) + 1800000);
}
async function screenshot(page: Page, name: string) {
  await mkdir('docs/evidence/phase4/regression/regression', { recursive: true }); await page.screenshot({ path: `docs/evidence/phase4/regression/regression/regression-phase2_1-${name}.png`, fullPage: true });
}
async function switchTheme(page: Page, dark: boolean) {
  await page.getByRole('button', { name: dark ? '切换深色模式' : '切换浅色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
}
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); });

test('普通长短块在日周视图并列可点击、真实拖动及拉伸，日期头和全天区无多余滚动条', async ({ page }) => {
  const long = event('长时任务范围 08:00—23:00', '08:00', '23:00'); const short = event('短时学习安排 08:30—09:45', '08:30', '09:45');
  await importFixture(page, fixture([long, short]));
  for (const view of ['周', '日']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const a = await native(page, long).boundingBox(); const b = await native(page, short).boundingBox();
    if (!a || !b) throw new Error('长短普通块缺失');
    expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1).toBe(true);
    await reachable(native(page, short)); await native(page, short).click();
    await expect(page.getByRole('dialog', { name: '编辑日程', exact: true }).getByLabel('日程标题')).toHaveValue(short.type === 'event' ? short.title : '');
    await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await screenshot(page, `normal-${view === '周' ? 'week' : 'day'}-light`);
    await switchTheme(page, true); await screenshot(page, `normal-${view === '周' ? 'week' : 'day'}-dark`); await switchTheme(page, false);
  }
  await moveAndResize(page, short);
  expect(await page.locator('.fc-scrollgrid-section-header .fc-scroller').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).overflowY === 'hidden'))).toBe(true);
  expect(await page.locator('.fc-scrollgrid-section-body:not(.fc-scrollgrid-section-liquid) .fc-scroller').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).overflowY === 'hidden'))).toBe(true);
});

test('旧短背景与长安排统一并列且都可直接编辑拖动拉伸', async ({ page }) => {
  const long = event('前景长安排', '08:00', '23:00'); const short = event('短背景课程上下文', '08:30', '09:45', 'background');
  await importFixture(page, fixture([long, short], 'dark'));
  await reachable(native(page, short)); await reachable(native(page, long));
  await expect(page.locator('.fc-bg-event,.calendar-time-marker')).toHaveCount(0);
  const shortBox = await native(page, short).boundingBox(); const lane = await page.locator('.fc-timegrid-slot-lane[data-time="08:30:00"]').boundingBox();
  if (!shortBox || !lane) throw new Error('旧短背景普通条目缺失'); expect(Math.abs(shortBox.y - lane.y)).toBeLessThan(5);
  await screenshot(page, 'short-background-week-dark'); await switchTheme(page, false); await screenshot(page, 'short-background-week-light');
  await native(page, short).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  const edit = page.getByRole('dialog', { name: '编辑日程', exact: true });
  await expect(edit.getByLabel('日程标题')).toHaveValue('短背景课程上下文'); await expect(edit.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-19T08:30');
  await expect(edit.getByLabel('结束时间', { exact: true })).toHaveValue('2026-10-19T09:45');
  await edit.getByRole('button', { name: '取消', exact: true }).click();
  await moveAndResize(page, long, -1);
  await moveAndResize(page, short);
  expect((await storedBlocks(page)).find((entry) => entry.id === short.id)).toMatchObject({ display: 'background' });
  await expect(page.locator('.fc-bg-event')).toHaveCount(0); await expect(native(page, short)).toBeVisible();
});

test('旧长背景与普通短块在日视图浅深均并列，短块点击拖动及拉伸保持独立', async ({ page }) => {
  const long = event('背景长课程 08:00—23:00', '08:00', '23:00', 'background'); const short = event('普通短安排 08:30—09:45', '08:30', '09:45');
  await importFixture(page, fixture([long, short])); await page.getByRole('button', { name: '日', exact: true }).click();
  await reachable(native(page, long)); await reachable(native(page, short));
  await screenshot(page, 'long-background-day-light'); await switchTheme(page, true); await screenshot(page, 'long-background-day-dark');
  await native(page, short).click(); await expect(page.getByRole('dialog', { name: '编辑日程', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await moveAndResize(page, short);
  expect((await storedBlocks(page)).find((entry) => entry.id === long.id)).toEqual(long);
});

test('五条并发在周视图全部并列，日期预览保留完整标题和编辑入口', async ({ page }) => {
  const entries = Array.from({ length: 5 }, (_, index) => event(`重叠安排 ${index + 1} · 完整中文标题`, '08:30', '10:00'));
  await importFixture(page, fixture(entries));
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(5);
  const boxes = await page.locator('.fc-timegrid-event').evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return { x: box.x, width: box.width }; }).sort((a, b) => a.x - b.x));
  for (let index = 1; index < boxes.length; index++) expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThanOrEqual(boxes[index].x + 1);
  await expect(page.locator('.calendar-time-marker,.fc-timegrid-more-link')).toHaveCount(0);
  await screenshot(page, 'dense-overlap-week-light');
  await page.getByRole('button', { name: '预览2026-10-19的安排', exact: true }).click(); const chooser = page.getByRole('dialog', { name: /^当天安排 ·/ });
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(chooser.locator('.calendar-detail-list li')).toHaveCount(5);
  for (const entry of entries) await expect(chooser).toContainText(entry.type === 'event' ? entry.title : '');
  await expect(chooser).toContainText('08:30'); await expect(chooser).toContainText('10:00');
  await chooser.getByRole('button', { name: /查看安排 重叠安排 5/ }).click();
  await expect(page.getByRole('dialog', { name: '编辑日程', exact: true }).getByLabel('日程标题')).toHaveValue('重叠安排 5 · 完整中文标题');
  await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await switchTheme(page, true); await screenshot(page, 'dense-overlap-week-dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('390窄周列不再收纳或分层，日期预览可编辑全部旧安排且浅深无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const entries = Array.from({ length: 4 }, (_, index) => event(`窄屏普通安排 ${index + 1}`, '08:30', '10:00'));
  const background = event('窄屏短背景也能编辑', '08:30', '09:45', 'background');
  await importFixture(page, fixture([...entries, background])); await page.getByRole('button', { name: '周', exact: true }).click();
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(5);
  await expect(page.locator('.calendar-time-marker-layer')).toHaveCount(0);
  await reachable(native(page, background));
  const trigger = page.getByRole('button', { name: '预览2026-10-19的安排', exact: true }); await reachable(trigger); await trigger.click();
  let chooser = page.getByRole('dialog', { name: /^当天安排 ·/ }); await expect(chooser.locator('.calendar-detail-list li')).toHaveCount(5);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'narrow-overlap-week-light');
  await chooser.getByRole('button', { name: /查看安排 窄屏短背景也能编辑/ }).click();
  await expect(page.getByRole('dialog', { name: '编辑日程', exact: true }).getByLabel('日程标题')).toHaveValue('窄屏短背景也能编辑');
  await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await switchTheme(page, true); await trigger.click(); chooser = page.getByRole('dialog', { name: /^当天安排 ·/ });
  await screenshot(page, 'narrow-overlap-week-dark'); await page.keyboard.press('Escape'); await expect(chooser).not.toBeVisible();
  await expect(trigger).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog', { name: /^当天安排 ·/ })).toBeVisible();
});

test('日历只用本次执行状态表现完成，父任务完成不覆盖另一待完成块，移动拉伸保留记录', async ({ page }) => {
  const taskId = crypto.randomUUID();
  const complete: ScheduleBlock = { ...meta(), type: 'task', taskId, allDay: false, startAt: iso('08:00'), endAt: iso('09:00'), timeZone: 'Asia/Shanghai', executionStatus: 'completed', completedAt: stamp };
  const pending: ScheduleBlock = { ...meta(), type: 'task', taskId, allDay: false, startAt: iso('10:00'), endAt: iso('11:00'), timeZone: 'Asia/Shanghai', executionStatus: 'pending' };
  const data = fixture([complete, pending]); data.tasks.push({ ...meta(), id: taskId, title: '整个任务完成但分段分别记录', description: '', listId: INBOX_ID, status: 'done', completedAt: stamp, priority: 'none', order: 1, tagIds: [], subtasks: [] });
  await importFixture(page, data); await page.getByRole('button', { name: '日', exact: true }).click();
  await expect(native(page, complete)).toHaveClass(/completed-event/); await expect(native(page, pending)).not.toHaveClass(/completed-event/);
  await expect(native(page, complete)).toHaveAttribute('aria-label', /本次已完成/); await expect(native(page, pending)).toHaveAttribute('aria-label', /本次待完成/);
  await expect(native(page, complete).locator('.calendar-kind-symbol')).toHaveText('✓'); await expect(native(page, pending).locator('.calendar-kind-symbol')).toHaveText('□');
  await moveAndResize(page, complete);
  expect((await storedBlocks(page)).find((block) => block.id === complete.id)).toMatchObject({ executionStatus: 'completed', completedAt: stamp });
  expect((await storedBlocks(page)).find((block) => block.id === pending.id)).toEqual(pending);
});
