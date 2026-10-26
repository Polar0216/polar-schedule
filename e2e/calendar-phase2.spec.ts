import { expect, test, type Locator, type Page } from '@playwright/test';
import { initialData, type ScheduleBlock, type Task } from '../src/domain/schema';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); });

async function stored(page: Page): Promise<{ tasks: Task[]; scheduleBlocks: ScheduleBlock[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(['tasks', 'scheduleBlocks'], 'readonly');
      const read = (name: string) => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error); });
      const [tasks, scheduleBlocks] = await Promise.all([read('tasks'), read('scheduleBlocks')]);
      return { tasks, scheduleBlocks } as { tasks: Task[]; scheduleBlocks: ScheduleBlock[] };
    } finally { db.close(); }
  });
}

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
}

async function task(page: Page, title = '完成实验报告') {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill(title);
  await page.getByLabel('截止日期', { exact: true }).fill('2026-10-23');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(1);
  await page.getByRole('button', { name: '返回待办', exact: true }).click();
}

async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = await from.boundingBox(); if (!box) throw new Error('右侧任务手柄不可见');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(100);
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 25 }); await page.waitForTimeout(200); await page.mouse.up();
}

async function dragTask(page: Page, dateIndex = 0, time = '10:00:00') {
  const column = await page.locator('.fc-timegrid-col[data-date]').nth(dateIndex).boundingBox();
  const slot = await page.locator(`.fc-timegrid-slot-lane[data-time="${time}"]`).boundingBox();
  if (!column || !slot) throw new Error('日 / 周时间轴不可见');
  await drag(page, page.getByLabel('拖动安排 完成实验报告', { exact: true }), { x: column.x + column.width / 2, y: slot.y + slot.height / 2 });
}

async function event(page: Page, title: string, start: string, end: string) {
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建日程', exact: true });
  await dialog.getByLabel('日程标题').fill(title);
  await dialog.getByLabel('开始时间', { exact: true }).fill(`2026-10-19T${start}`);
  await dialog.getByLabel('结束时间', { exact: true }).fill(`2026-10-19T${end}`);
  await dialog.getByRole('button', { name: '保存安排' }).click();
  await expect(dialog).not.toBeVisible();
}

async function importLegacyDisplay(page: Page, title: string) {
  const current = await stored(page); const data = initialData(); data.tasks = current.tasks;
  data.scheduleBlocks = current.scheduleBlocks.map((block) => block.type === 'event' && block.title === title ? { ...block, display: 'background' } : block);
  data.settings.showBackground = false; data.settings.theme = await page.locator('html').getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'legacy-display.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await settings.getByRole('button', { name: '继续替换导入…' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true });
  await confirmation.getByRole('button', { name: '确认备份并替换', exact: true }).click(); await expect(confirmation).not.toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
}

test('右侧任务周日反复拖入，筛选、清单切换、折叠和详情节点重挂后保持唯一写入', async ({ page }) => {
  await open(page); await task(page);
  const originalTask = (await stored(page)).tasks[0];
  await dragTask(page, 2); await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(1);
  await dragTask(page, 3, '11:00:00'); await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(2);
  await page.getByLabel('任务筛选', { exact: true }).selectOption('unscheduled');
  await expect(page.getByLabel('拖动安排 完成实验报告', { exact: true })).toHaveCount(0);
  await page.getByLabel('任务筛选', { exact: true }).selectOption('all');
  await page.getByLabel('搜索任务', { exact: true }).fill('不存在');
  await expect(page.getByLabel('拖动安排 完成实验报告', { exact: true })).toHaveCount(0);
  await page.getByLabel('搜索任务', { exact: true }).fill('');
  await page.getByRole('button', { name: '折叠待办侧栏', exact: true }).click();
  await page.getByRole('button', { name: '展开待办侧栏', exact: true }).click();
  await page.getByRole('button', { name: '完成实验报告', exact: true }).click();
  await page.getByRole('button', { name: '返回待办', exact: true }).click();
  await page.getByRole('button', { name: /^收集箱/ }).first().click();
  await page.getByRole('button', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await settings.getByLabel('默认安排时长').selectOption('90');
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await dragTask(page, 0, '10:00:00');
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(3);
  const data = await stored(page);
  expect(data.tasks).toEqual([originalTask]);
  expect(data.scheduleBlocks.every((block) => block.type === 'task' && block.taskId === originalTask.id)).toBe(true);
  expect(data.scheduleBlocks.filter((block) => !block.allDay && Date.parse(block.endAt) - Date.parse(block.startAt) === 90 * 60000)).toHaveLength(1);
  const dayEvent = page.locator('.fc-timegrid-event');
  const previousTooltip = await dayEvent.getAttribute('title');
  const eventBox = await dayEvent.boundingBox();
  if (!eventBox) throw new Error('日视图任务安排不可见');
  await drag(page, dayEvent.locator('.fc-event-main'), { x: eventBox.x + eventBox.width / 2, y: eventBox.y + eventBox.height / 2 + 58 });
  await expect.poll(async () => (await stored(page)).scheduleBlocks.some((block) => block.revision === 2)).toBe(true);
  await expect(dayEvent).not.toHaveAttribute('title', previousTooltip ?? '');
  await page.getByRole('button', { name: '月', exact: true }).click();
  const day = await page.locator('.fc-daygrid-day[data-date="2026-10-20"]').boundingBox();
  if (!day) throw new Error('月视图日期不可见');
  await drag(page, page.getByLabel('拖动安排 完成实验报告', { exact: true }), { x: day.x + day.width / 2, y: day.y + day.height / 2 });
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(4);
  expect((await stored(page)).scheduleBlocks.find((block) => block.allDay)).toMatchObject({ allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' });
  await page.getByRole('button', { name: '完成实验报告', exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill('实验报告已改名');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.locator('.fc-event strong', { hasText: '实验报告已改名' })).toHaveCount(4);
  await expect.poll(() => page.locator('.fc-event').evaluateAll((elements) => elements.every((element) => element.getAttribute('title')?.startsWith('实验报告已改名')))).toBe(true);
});

test('真实拖入遇到IndexedDB写入失败时无幽灵事件，原任务及已有块保持完整', async ({ page }) => {
  await open(page); await task(page);
  await dragTask(page); await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(1);
  const before = await stored(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'scheduleBlocks') { IDBObjectStore.prototype.put = original; throw new DOMException('隔离测试模拟空间不足', 'QuotaExceededError'); }
      return original.apply(this, args);
    };
  });
  await dragTask(page, 2, '11:00:00');
  await expect(page.getByRole('alert')).toContainText(/存储|QuotaExceeded|空间不足|失败/);
  expect(await stored(page)).toEqual(before);
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭提示' }).click();
  await dragTask(page, 3, '11:00:00');
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(2);
  expect((await stored(page)).tasks).toEqual(before.tasks);
  await dragTask(page, 0, '10:00:00');
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(3);
  await expect(page.locator('.toast')).toContainText('该时段另有1条安排，已保留重叠');
});

test('长短与三条重叠保持并列及完整入口，旧显示值同样直接编辑，浅深与手机无全页溢出', async ({ page }) => {
  const titles = ['理论力学与全天研究长时间安排', '课堂笔记整理与实验报告', '同学讨论与课程答疑'];
  await open(page);
  await event(page, titles[0], '08:00', '23:00');
  await event(page, titles[1], '08:30', '09:45');
  await event(page, titles[2], '08:30', '10:00');
  await page.getByRole('button', { name: '日', exact: true }).click();
  const blocks = page.locator('.fc-timegrid-event'); await expect(blocks).toHaveCount(3);
  const boxes = await Promise.all(titles.map((title) => page.locator('.fc-timegrid-event', { hasText: title }).boundingBox()));
  for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++) {
    const a = boxes[left]; const b = boxes[right]; if (!a || !b) throw new Error('普通安排不可见');
    expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1).toBe(true);
  }
  for (const title of titles) {
    const card = page.locator('.fc-timegrid-event', { hasText: title });
    await expect(card).toHaveAttribute('title', new RegExp(title));
    expect(await card.locator('strong').evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    await card.click(); await expect(page.getByRole('dialog', { name: '编辑日程', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  }
  await page.locator('.calendar-agenda summary').click();
  await expect(page.locator('.calendar-agenda .calendar-detail-list li')).toHaveCount(3);
  await expect(page.locator('.calendar-agenda summary')).toContainText('本段安排 · 3');
  await page.locator('.calendar-agenda summary').click();
  await mkdir('docs/evidence/phase4/regression/regression', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-phase2-after-overlap.png', fullPage: true });
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-phase2-overlap-dark.png', fullPage: true });
  await importLegacyDisplay(page, titles[0]);
  await expect(page.locator('.fc-bg-event')).toHaveCount(0);
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(3);
  const short = await page.locator('.fc-timegrid-event', { hasText: titles[1] }).boundingBox();
  if (!short || !boxes[1]) throw new Error('短安排不可见'); expect(Math.abs(short.width - boxes[1].width)).toBeLessThan(2);
  await expect(page.locator('.calendar-background-list')).toHaveCount(0);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-phase2-legacy-display-dark.png', fullPage: true });
  await page.getByRole('button', { name: '切换浅色模式', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-phase2-legacy-display-light.png', fullPage: true });
  await page.locator('.fc-timegrid-event', { hasText: titles[0] }).click();
  const dialog = page.getByRole('dialog', { name: '编辑日程', exact: true });
  await expect(dialog.getByLabel('日程标题')).toHaveValue(titles[0]);
  await dialog.getByLabel('日程备注').fill('普通安排编辑保留旧显示字段');
  await dialog.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(dialog).not.toBeVisible();
  expect((await stored(page)).scheduleBlocks.find((block) => block.type === 'event' && block.title === titles[0])).toMatchObject({ display: 'background', description: '普通安排编辑保留旧显示字段' });
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(3);
  await page.getByRole('button', { name: '日', exact: true }).click();
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '日', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.calendar-agenda summary').click();
  await expect(page.locator('.calendar-agenda .calendar-detail-list li')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-phase2-overlap-mobile-light.png', fullPage: true });
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-phase2-overlap-mobile-dark.png', fullPage: true });
});

test('显示时段外与旧显示记录仍有清楚的查看编辑入口', async ({ page }) => {
  await open(page); await event(page, '范围外晨读', '06:00', '06:45');
  await event(page, '全天上下文', '08:00', '23:00');
  await importLegacyDisplay(page, '全天上下文');
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await settings.getByLabel('显示开始小时').selectOption('9');
  await settings.getByLabel('显示结束小时').selectOption('18');
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(1);
  await expect(page.locator('.fc-bg-event')).toHaveCount(0);
  await page.locator('.calendar-outside-list summary').click();
  await expect(page.locator('.calendar-outside-list .calendar-detail-list li')).toHaveCount(2);
  await page.locator('.calendar-outside-list button', { hasText: '范围外晨读' }).click();
  await expect(page.getByRole('dialog', { name: '编辑日程', exact: true }).getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-19T06:00');
  await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.calendar-outside-list button', { hasText: '全天上下文' }).click();
  await expect(page.getByRole('dialog', { name: '编辑日程', exact: true }).getByLabel('日程标题')).toHaveValue('全天上下文');
  expect((await stored(page)).scheduleBlocks).toHaveLength(2);
  await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await task(page); await dragTask(page, 0, '10:00:00');
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(3);
  await expect(page.locator('.toast')).toContainText('该时段另有1条安排，已保留重叠');
});

test('最后一次重复安排取消后仍可从系列管理入口查看并修改整个系列', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('日程标题').fill('只有一次的课程');
  await dialog.getByLabel('开始时间', { exact: true }).fill('2026-10-19T08:00');
  await dialog.getByLabel('结束时间', { exact: true }).fill('2026-10-19T09:00');
  await dialog.getByLabel('重复频率').selectOption('daily');
  await dialog.getByLabel('重复结束条件').selectOption('count');
  await dialog.getByLabel('重复次数').fill('1');
  await dialog.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.locator('.fc-timegrid-event', { hasText: '只有一次的课程' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('编辑范围')).toHaveValue('occurrence');
  await dialog.getByRole('button', { name: '删除本次', exact: true }).click();
  await page.getByRole('dialog', { name: '删除本次安排？', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(0);
  await expect(page.locator('.calendar-agenda summary')).toContainText('本段安排 · 0');
  await page.locator('.calendar-series-list summary').click();
  await page.getByRole('button', { name: '管理重复系列 只有一次的课程', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('日程标题')).toHaveValue('只有一次的课程');
  await expect(dialog.getByLabel('重复次数')).toHaveValue('1');
  await dialog.getByLabel('重复次数').fill('2');
  await dialog.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(dialog).not.toBeVisible();
  expect((await stored(page)).scheduleBlocks).toHaveLength(1);
  const series = (await stored(page)).scheduleBlocks[0];
  expect(series.type === 'event' && series.recurrence?.count).toBe(2);
  await page.getByRole('button', { name: '下一段日期', exact: true }).click();
  await expect(page.locator('.fc-timegrid-event')).toHaveCount(0);
  await expect(page.locator('.calendar-series-list summary')).toContainText('重复系列 · 1');
});
