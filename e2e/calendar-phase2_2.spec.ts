import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { initialData, type ScheduleBlock, type ScheduleData } from '../src/domain/schema';

const now = '2026-10-19T01:00:00.000Z';
const metadata = () => ({ id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now });
const instant = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();
function entry(title: string, date = '2026-10-20', from = '08:00', to = '09:00', background = false): ScheduleBlock {
  return { ...metadata(), type: 'event', title, description: '', display: background ? 'background' : 'normal', color: '#43a58a', allDay: false,
    startAt: instant(date, from), endAt: instant(date, to), timeZone: 'Asia/Shanghai' };
}
function fixture(): ScheduleData {
  const data = initialData(); const taskId = crypto.randomUUID();
  data.settings = { ...data.settings, theme: 'light', timeZone: 'Asia/Shanghai', defaultView: 'month', showBackground: false };
  data.tasks = [{ ...metadata(), id: taskId, title: '分段执行状态', listId: data.lists[0].id, status: 'todo', description: '', priority: 'none', order: 1, tagIds: [], subtasks: [] }];
  const recurring = entry('重复背景课程', '2026-10-20', '11:00', '12:00', true);
  if (recurring.type === 'event') recurring.recurrence = { frequency: 'daily', interval: 1, weekdays: [], startDate: '2026-10-20', localTime: '11:00', durationMinutes: 60, count: 2 };
  const cross = entry('跨夜复习', '2026-10-19', '22:00', '23:00'); if (!cross.allDay) cross.endAt = instant('2026-10-20', '02:00');
  data.scheduleBlocks = [
    { ...metadata(), type: 'event', title: '全天跨日安排', description: '', display: 'normal', allDay: true, startDate: '2026-10-19', endDate: '2026-10-21', timeZone: 'Asia/Shanghai' },
    cross, entry('背景也在月历直接显示', '2026-10-20', '08:00', '09:00', true), entry('普通学习', '2026-10-20', '09:00', '10:00'), recurring,
    { ...metadata(), type: 'task', taskId, allDay: false, startAt: instant('2026-10-20', '13:00'), endAt: instant('2026-10-20', '14:00'), timeZone: 'Asia/Shanghai', executionStatus: 'pending' },
    { ...metadata(), type: 'task', taskId, allDay: false, startAt: instant('2026-10-22', '08:00'), endAt: instant('2026-10-22', '09:00'), timeZone: 'Asia/Shanghai', executionStatus: 'completed', completedAt: now },
  ];
  return data;
}
async function seed(page: Page, data: ScheduleData) {
  await page.goto('/'); await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'calendar-v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await settings.getByRole('button', { name: '继续替换导入…' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true });
  await confirmation.getByRole('button', { name: '确认备份并替换', exact: true }).click(); await expect(confirmation).not.toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('button', { name: '月', exact: true }).click();
}
async function blocks(page: Page): Promise<ScheduleBlock[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<ScheduleBlock[]>((resolve, reject) => { const request = db.transaction('scheduleBlocks').objectStore('scheduleBlocks').getAll(); request.onsuccess = () => resolve(request.result as ScheduleBlock[]); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
}
async function capture(page: Page, name: string) {
  await mkdir('docs/evidence/phase4/regression/regression', { recursive: true }); await page.screenshot({ path: `docs/evidence/phase4/regression/regression/regression-phase2_2-${name}.png`, fullPage: true });
}
async function jump(page: Page, value: string) {
  await page.getByRole('button', { name: '跳转日期', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '选择跳转日期', exact: true });
  await popup.getByLabel('跳转日期输入').fill(value); await popup.getByRole('button', { name: '跳转', exact: true }).click(); await expect(popup).not.toBeVisible();
}
const preview = (page: Page) => page.getByRole('dialog', { name: /^当天安排 ·/ });
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-20T09:00:00+08:00')); });

test('月背景与重复实例投影普通可点条目，完成标签醒目且全量更多不丢类型', async ({ page }) => {
  const data = fixture(); await seed(page, data); const before = await blocks(page);
  await expect(page.locator('.fc-bg-event')).toHaveCount(0);
  const background = data.scheduleBlocks.find((block) => block.type === 'event' && block.title === '背景也在月历直接显示')!;
  const cell = page.locator('.fc-daygrid-day[data-date="2026-10-20"]');
  await expect(cell.locator('.fc-daygrid-more-link')).toBeVisible(); await cell.locator('.fc-daygrid-more-link').click();
  const popover = page.locator('.fc-more-popover'); await expect(popover).toBeVisible();
  for (const text of ['全天跨日安排', '跨夜复习', '背景也在月历直接显示', '普通学习', '重复背景课程', '分段执行状态']) await expect(popover).toContainText(text);
  await popover.locator(`.fc-event[data-block-id="${background.id}"]`).click();
  const edit = page.getByRole('dialog', { name: '编辑日程', exact: true }); await expect(edit.getByLabel('日程标题')).toHaveValue('背景也在月历直接显示');
  await expect(edit.getByLabel('日历呈现方式')).toHaveCount(0);
  await edit.getByRole('button', { name: '取消', exact: true }).click(); await page.mouse.click(180, 135);
  const complete = data.scheduleBlocks.find((block) => block.type === 'task' && block.executionStatus === 'completed')!;
  const completeCard = page.locator(`.fc-daygrid-event[data-block-id="${complete.id}"]`); await expect(completeCard).toContainText('已完成');
  await expect(completeCard).toHaveClass(/completed-event/); await expect(completeCard).toHaveAttribute('aria-label', /本次已完成/);
  await capture(page, 'month-background-completion-light');
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click(); await capture(page, 'month-background-completion-dark');
  expect(await blocks(page)).toEqual(before);
});

test('月日期预览全天跨夜交集/背景/任务/重复，键盘外部关闭与完整日视图保持准确且只开一窗', async ({ page }) => {
  await seed(page, fixture()); const before = await blocks(page);
  const trigger = page.getByRole('button', { name: '预览2026-10-20的安排', exact: true }); await trigger.click();
  await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(preview(page).locator('.calendar-detail-list li')).toHaveCount(6);
  const items = await preview(page).locator('.calendar-detail-list li').allTextContents();
  expect(items[0]).toContain('全天'); expect(items[1]).toContain('跨夜复习'); expect(items[1]).toContain('00:00—02:00'); expect(items[1]).toContain('跨日');
  await expect(preview(page)).toContainText('背景也在月历直接显示'); await expect(preview(page)).toContainText('本次待完成');
  await capture(page, 'day-preview-month-light');
  await page.keyboard.press('Escape'); await expect(preview(page)).not.toBeVisible(); await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter'); await expect(preview(page)).toBeVisible(); await page.mouse.click(4, 4); await expect(preview(page)).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click(); await preview(page).getByRole('button', { name: '查看完整日视图 →', exact: true }).click();
  await expect(page.getByRole('button', { name: '日', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('h1')).toContainText('2026年10月20日');
  await expect(page.locator('.fc-timegrid-col[data-date]')).toHaveAttribute('data-date', '2026-10-20'); await capture(page, 'day-preview-target');
  await page.getByRole('button', { name: '月', exact: true }).click();
  const emptyTrigger = page.getByRole('button', { name: '预览2026-10-24的安排', exact: true }); await emptyTrigger.click();
  await expect(preview(page).locator('.calendar-preview-empty')).toContainText('没有安排');
  await expect(preview(page).locator('.calendar-detail-list li')).toHaveCount(0);
  await expect(preview(page).getByRole('button', { name: '查看完整日视图 →', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(preview(page)).not.toBeVisible(); await expect(emptyTrigger).toBeFocused();
  expect(await blocks(page)).toEqual(before);
});

test('周日期预览条目直接编辑本次，空白月格/周网格仍创建且事件不触发双窗', async ({ page }) => {
  await seed(page, fixture()); await page.getByRole('button', { name: '周', exact: true }).click();
  await page.getByRole('button', { name: '预览2026-10-20的安排', exact: true }).click(); await expect(page.locator('dialog[open]')).toHaveCount(1);
  await preview(page).getByRole('button', { name: /查看安排 分段执行状态/ }).click();
  await expect(page.getByRole('dialog', { name: '编辑任务安排', exact: true })).toBeVisible(); await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.getByRole('dialog', { name: '编辑任务安排', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  const col = await page.locator('.fc-timegrid-col[data-date="2026-10-20"]').boundingBox(); const lane = await page.locator('.fc-timegrid-slot-lane[data-time="16:00:00"]').boundingBox();
  if (!col || !lane) throw new Error('周空白网格缺失'); await page.mouse.click(col.x + col.width / 2, lane.y + lane.height / 2);
  await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toBeVisible(); await expect(preview(page)).toHaveCount(0);
  await page.getByRole('dialog', { name: '新建日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '月', exact: true }).click(); const empty = await page.locator('.fc-daygrid-day[data-date="2026-10-25"]').boundingBox();
  if (!empty) throw new Error('月空白网格缺失'); await page.mouse.click(empty.x + empty.width / 2, empty.y + empty.height / 2);
  await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toBeVisible(); await expect(page.locator('dialog[open]')).toHaveCount(1);
});

test('低窗口五六行月份、缩放及侧栏变化自然滚动同一月，不把滚轮变成跳月', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 580 }); await seed(page, fixture());
  const scroll = page.locator('.is-month .fc-scroller-liquid-absolute');
  for (const [month, rows] of [['2026-10', 5], ['2026-08', 6]] as const) {
    await jump(page, month); await expect(page.locator('.fc-daygrid-body tbody > tr')).toHaveCount(rows);
    await expect.poll(() => scroll.evaluate((node) => node.scrollHeight > node.clientHeight + 10)).toBe(true);
    const heading = await page.locator('h1').textContent(); await scroll.hover(); await page.mouse.wheel(0, 420);
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0); await expect(page.locator('h1')).toHaveText(heading!);
    await scroll.evaluate((node) => { node.scrollTop = 0; });
  }
  await page.getByRole('button', { name: '折叠清单侧栏', exact: true }).click(); await page.getByRole('button', { name: '折叠待办侧栏', exact: true }).click();
  // Browser zoom changes the effective CSS viewport. CSS body.zoom would instead
  // enlarge 100vw content outside that viewport and is not an equivalent test.
  await page.setViewportSize({ width: 1252, height: 504 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1252, height: 504, deviceScaleFactor: 1.15, mobile: false, screenWidth: 1440, screenHeight: 580 });
  await scroll.hover(); await page.mouse.wheel(0, 400);
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.app').evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1252);
  await capture(page, 'month-six-rows-low-height');
});

test('重叠2/3/5项日周全部并列且日期预览完整，手机月更多与预览内部滚动可跳转', async ({ page }) => {
  const data = initialData(); data.settings.theme = 'light';
  const entries = [entry('长安排', '2026-10-20', '08:00', '23:00'), entry('短安排优先可见', '2026-10-20', '08:30', '09:45'), ...Array.from({ length: 3 }, (_, index) => entry(`同时安排${index + 3}`, '2026-10-20', '08:30', '10:00'))];
  for (const count of [2, 3, 5]) {
    data.scheduleBlocks = entries.slice(0, count); await seed(page, data); await page.getByRole('button', { name: '周', exact: true }).click();
    await expect(page.locator('.fc-timegrid-event:visible')).toHaveCount(count);
    const short = page.locator('.fc-timegrid-event:visible', { hasText: '短安排优先可见' }); await expect(short).toBeVisible();
    await expect(short).toHaveAttribute('title', /短安排优先可见/);
    await short.click(); await expect(page.getByRole('dialog', { name: '编辑日程', exact: true }).getByLabel('日程标题')).toHaveValue('短安排优先可见');
    await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('.calendar-time-marker,.fc-timegrid-more-link')).toHaveCount(0);
    if (count === 5) await capture(page, 'weekly-five-parallel-light');
    await page.getByRole('button', { name: '预览2026-10-20的安排', exact: true }).click();
    await expect(preview(page).locator('li')).toHaveCount(count);
    if (count < 5) await page.keyboard.press('Escape');
  }
  await capture(page, 'weekly-five-preview-light'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '日', exact: true }).click(); await expect(page.locator('.fc-timegrid-event:visible')).toHaveCount(5);
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click(); await capture(page, 'daily-five-overlap-dark');
  await page.getByRole('button', { name: '周', exact: true }).click(); await capture(page, 'weekly-five-parallel-dark');
  const many = fixture(); many.settings.theme = 'dark'; many.scheduleBlocks = Array.from({ length: 18 }, (_, index) => entry(`手机详细安排${index + 1}`, '2026-10-20', '08:00', '09:00', index % 3 === 0));
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, many);
  await page.locator('.fc-daygrid-day[data-date="2026-10-20"] .fc-daygrid-more-link').click();
  const monthMore = page.locator('.fc-more-popover'); const moreScroll = monthMore.locator('.fc-popover-body');
  await expect(monthMore.locator('.fc-daygrid-event')).toHaveCount(18);
  await expect.poll(() => moreScroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await moreScroll.hover(); await page.mouse.wheel(0, 2000); await expect.poll(() => moreScroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => moreScroll.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 2)).toBe(true);
  const moreBounds = await monthMore.boundingBox(); const frameBounds = await page.locator('.calendar-stage').boundingBox();
  expect(moreBounds!.y).toBeGreaterThanOrEqual(frameBounds!.y); expect(moreBounds!.y + moreBounds!.height).toBeLessThanOrEqual(frameBounds!.y + frameBounds!.height);
  const finalItem = monthMore.locator('.fc-daygrid-event').last(); const finalBounds = await finalItem.boundingBox(); const scrollBounds = await moreScroll.boundingBox();
  expect(finalBounds!.y + finalBounds!.height).toBeLessThanOrEqual(scrollBounds!.y + scrollBounds!.height);
  await capture(page, 'month-more-mobile-dark'); await monthMore.locator('.fc-popover-close').click();
  await page.getByRole('button', { name: '预览2026-10-20的安排', exact: true }).click(); await expect(preview(page).locator('li')).toHaveCount(18);
  const inner = preview(page).locator('.calendar-day-preview-list'); await expect.poll(() => inner.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await inner.hover(); await page.mouse.wheel(0, 420); await expect.poll(() => inner.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const bounds = await preview(page).boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, 'day-preview-mobile-dark');
  await preview(page).getByRole('button', { name: '查看完整日视图 →', exact: true }).click(); await expect(page.locator('h1')).toContainText('2026年10月20日');
});
