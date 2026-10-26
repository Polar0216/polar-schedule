import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { List, ScheduleBlock, Task } from '../src/domain/schema';

type Stored = { lists: List[]; tasks: Task[]; scheduleBlocks: ScheduleBlock[] };
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); });
async function stored(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(['lists', 'tasks', 'scheduleBlocks'], 'readonly');
      const read = (name: string) => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error); });
      const [lists, tasks, scheduleBlocks] = await Promise.all([read('lists'), read('tasks'), read('scheduleBlocks')]);
      return { lists, tasks, scheduleBlocks } as Stored;
    } finally { db.close(); }
  });
}
async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的待办', exact: false })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}
async function makeTask(page: Page, title = '完成实验报告') {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill(title);
  await page.getByLabel('截止日期', { exact: true }).fill('2026-10-23');
  await page.getByText('描述与任务属性', { exact: true }).click();
  await page.getByLabel('优先级', { exact: true }).selectOption('high');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(1);
  await page.getByRole('button', { name: '返回待办', exact: true }).click();
}
async function makeList(page: Page, title: string) {
  await page.getByRole('button', { name: '新建清单', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建清单', exact: true });
  await dialog.getByLabel('清单名称').fill(title);
  await dialog.getByRole('button', { name: '选择清单颜色', exact: true }).click();
  const colors = page.getByRole('dialog', { name: '选择清单颜色', exact: true });
  await colors.getByRole('button', { name: '颜色 #43a58a', exact: true }).click(); await colors.getByRole('button', { name: '确认颜色', exact: true }).click();
  await dialog.getByRole('button', { name: '保存清单' }).click();
  await expect(dialog).not.toBeVisible();
}
async function schedule(page: Page, start: string, end: string) {
  await page.getByRole('button', { name: '安排时间 完成实验报告', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '安排执行时间', exact: true });
  await dialog.getByLabel('开始时间', { exact: true }).fill(start);
  await dialog.getByLabel('结束时间', { exact: true }).fill(end);
  await dialog.getByRole('button', { name: '保存安排' }).click();
  await expect(dialog).not.toBeVisible();
}
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = await from.boundingBox(); if (!box) throw new Error('拖动起点不可见');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(150);
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 3, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 25 }); await page.waitForTimeout(250); await page.mouse.up();
}

test('清单、任务、多段安排、标题联动、安全删除、刷新与备份往返', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page); await makeList(page, '课程学习');
  await page.getByRole('button', { name: '管理清单 课程学习' }).click();
  let dialog = page.getByRole('dialog', { name: '管理清单', exact: true });
  await dialog.getByRole('button', { name: '清单上移', exact: true }).click();
  await dialog.getByRole('button', { name: '保存清单', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: /课程学习/ }).first()).toBeVisible();
  expect((await stored(page)).lists.find((l) => l.title === '课程学习')).toMatchObject({ color: '#43a58a', order: 0 });
  await page.getByRole('button', { name: /^课程学习/ }).click();
  await makeTask(page);
  expect((await stored(page)).scheduleBlocks).toHaveLength(0);
  await page.getByRole('button', { name: '完成任务 完成实验报告', exact: true }).click();
  await page.getByLabel('任务筛选', { exact: true }).selectOption('completed');
  await page.getByRole('button', { name: '撤销完成 完成实验报告', exact: true }).click();
  await page.getByLabel('任务筛选', { exact: true }).selectOption('incomplete');
  // Keep visible dates deterministic without changing the persisted clock.
  await schedule(page, '2026-10-21T19:00', '2026-10-21T21:00');
  await schedule(page, '2026-10-22T20:00', '2026-10-22T21:00');
  let data = await stored(page); expect(data.tasks).toHaveLength(1); expect(data.scheduleBlocks).toHaveLength(2);
  expect(data.scheduleBlocks.every((b) => b.type === 'task' && b.taskId === data.tasks[0].id)).toBe(true);
  await page.getByRole('button', { name: '完成实验报告', exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill('实验报告定稿');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.locator('.fc-event strong', { hasText: '实验报告定稿' })).toHaveCount(2);
  await page.locator('.linked-block').first().click();
  await page.getByRole('button', { name: '删除此安排', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这段安排？' }).getByRole('button', { name: '确认删除', exact: true }).click();
  data = await stored(page); expect(data.tasks).toHaveLength(1); expect(data.scheduleBlocks).toHaveLength(1);
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '设置与数据', exact: true });
  const downloadPromise = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出完整 JSON' }).click();
  const download = await downloadPromise; const file = await download.path(); if (!file) throw new Error('没有导出文件');
  const json = await readFile(file, 'utf8'); expect(JSON.parse(json).tasks[0].title).toBe('实验报告定稿');
  await dialog.getByLabel('选择导入文件').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(dialog.getByRole('alert')).toContainText('现有数据未改动'); expect((await stored(page)).tasks).toHaveLength(1);
  await dialog.getByLabel('选择导入文件').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(dialog.getByText(/1 条任务 · 1 段安排/)).toBeVisible();
  await dialog.getByRole('button', { name: '继续替换导入…' }).click();
  await page.getByRole('dialog', { name: '确认替换全部本地数据？' }).getByRole('button', { name: '确认备份并替换' }).click();
  await expect(page.getByRole('dialog', { name: '确认替换全部本地数据？' })).not.toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload(); await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(1);
  await page.getByRole('button', { name: '实验报告定稿', exact: true }).click();
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这条任务？' }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(0);
  expect((await stored(page)).scheduleBlocks).toHaveLength(0); expect(errors).toEqual([]);
});

test('真实鼠标拖入任务、重复安排、移动与拉伸独立日程', async ({ page }) => {
  await open(page); await makeTask(page);
  const col = await page.locator('.fc-timegrid-col[data-date]').nth(2).boundingBox();
  const slot = await page.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]').boundingBox();
  if (!col || !slot) throw new Error('时间轴不可见');
  await drag(page, page.getByLabel('拖动安排 完成实验报告', { exact: true }), { x: col.x + col.width / 2, y: slot.y + slot.height / 2 });
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(1);
  await drag(page, page.getByLabel('拖动安排 完成实验报告', { exact: true }), { x: col.x + col.width / 2, y: slot.y + slot.height * 3 });
  await expect.poll(async () => (await stored(page)).scheduleBlocks.length).toBe(2);
  let data = await stored(page); expect(data.tasks).toHaveLength(1); expect(data.tasks[0].status).toBe('todo'); expect(data.tasks[0].dueDate).toBe('2026-10-23');
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建日程', exact: true });
  await dialog.getByLabel('日程标题').fill('专注阅读');
  // Current visible week, Monday 09:00.
  const date = await page.locator('.fc-timegrid-col[data-date]').first().getAttribute('data-date');
  await dialog.getByLabel('开始时间', { exact: true }).fill(`${date}T09:00`);
  await dialog.getByLabel('结束时间', { exact: true }).fill(`${date}T10:00`);
  await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog).not.toBeVisible();
  const event = page.locator('.fc-timegrid-event', { hasText: '专注阅读' });
  const before = (await stored(page)).scheduleBlocks.find((b) => b.type === 'event')!;
  const eventBox = await event.boundingBox(); if (!eventBox) throw new Error('日程不可见');
  await drag(page, event.locator('.fc-event-main'), { x: eventBox.x + eventBox.width / 2, y: eventBox.y + eventBox.height / 2 + slot.height * 2 });
  await expect.poll(async () => (await stored(page)).scheduleBlocks.find((b) => b.id === before.id)?.revision).toBe(2);
  const moved = (await stored(page)).scheduleBlocks.find((b) => b.id === before.id)!;
  expect(moved.allDay).toBe(false); if (before.allDay || moved.allDay) throw new Error('应为定时日程');
  expect(Date.parse(moved.startAt) - Date.parse(before.startAt)).toBe(3600000);
  await event.hover(); const resize = event.locator('.fc-event-resizer-end');
  const resizeBox = await resize.boundingBox(); if (!resizeBox) throw new Error('缩放手柄不可见');
  await drag(page, resize, { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + resizeBox.height / 2 + slot.height * 2 });
  await expect.poll(async () => (await stored(page)).scheduleBlocks.find((b) => b.id === before.id)?.revision).toBe(3);
  data = await stored(page); const resized = data.scheduleBlocks.find((b) => b.id === before.id)!;
  if (resized.allDay) throw new Error('应为定时日程');
  expect(Date.parse(resized.endAt) - Date.parse(resized.startAt)).toBe(7200000);
  await page.screenshot({ path: 'test-results/desktop-light.png', fullPage: true });
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/desktop-dark.png', fullPage: true });
});

test('点击时间轴创建、跨日/全天、视图导航、非法时间提示与离线刷新', async ({ page, context }) => {
  await open(page);
  const col = await page.locator('.fc-timegrid-col[data-date]').first().boundingBox();
  const slot = await page.locator('.fc-timegrid-slot-lane[data-time="09:00:00"]').boundingBox();
  if (!col || !slot) throw new Error('时间轴不可见');
  await page.mouse.click(col.x + col.width / 2, slot.y + slot.height / 2);
  let dialog = page.getByRole('dialog', { name: '新建日程', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByLabel('日程标题').fill('跨年学习');
  await dialog.getByLabel('开始时间', { exact: true }).fill('2026-12-31T23:00');
  await dialog.getByLabel('结束时间', { exact: true }).fill('2026-12-31T22:00');
  await dialog.getByRole('button', { name: '保存安排' }).click();
  await expect(dialog.getByRole('alert')).toContainText('结束时间必须晚于');
  await dialog.getByLabel('结束时间', { exact: true }).fill('2027-01-01T01:00');
  await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建日程', exact: true });
  await dialog.getByLabel('日程标题').fill('全天计划'); await dialog.getByLabel('全天', { exact: true }).check();
  await dialog.getByLabel('开始日期', { exact: true }).fill('2026-12-31'); await dialog.getByLabel('结束日期', { exact: true }).fill('2027-01-01');
  await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog).not.toBeVisible();
  expect((await stored(page)).scheduleBlocks.find((b) => b.allDay)).toMatchObject({ startDate: '2026-12-31', endDate: '2027-01-02' });
  for (const name of ['日', '月', '周']) { await page.getByRole('button', { name, exact: true }).click(); await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true'); }
  const title = await page.locator('h1').textContent(); await page.getByRole('button', { name: '下一段日期' }).click(); await expect(page.locator('h1')).not.toHaveText(title!);
  await page.getByRole('button', { name: '今天', exact: true }).click(); await expect(page.locator('h1')).toHaveText(title!);
  await context.setOffline(true); await page.reload(); await expect(page.getByRole('button', { name: '新建日程', exact: true })).toBeVisible();
  await makeTask(page, '离线写入');
  await page.getByRole('button', { name: '安排时间 离线写入', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '安排执行时间', exact: true });
  await dialog.getByLabel('开始时间', { exact: true }).fill('2026-10-19T16:00'); await dialog.getByLabel('结束时间', { exact: true }).fill('2026-10-19T17:00');
  await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '离线写入', exact: true })).toBeVisible(); expect((await stored(page)).scheduleBlocks).toHaveLength(3);
  await context.setOffline(false);
});

test('390 手机与 768 平板可创建、编辑和通过表单安排，页面不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('button', { name: '日', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '打开清单导航' }).click(); await makeList(page, '手机清单');
  await page.getByRole('button', { name: '关闭清单导航' }).click();
  await page.getByRole('button', { name: '快速新建任务' }).click();
  await page.getByLabel('任务标题', { exact: true }).fill('手机整理');
  await page.getByRole('button', { name: '保存并安排时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '安排执行时间', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByLabel('开始时间', { exact: true }).fill('2026-10-19T14:00'); await dialog.getByLabel('结束时间', { exact: true }).fill('2026-10-19T15:00');
  await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator('.linked-block')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '日程', exact: true }).click();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole('button', { name: '待办', exact: true }).click();
  await page.getByRole('button', { name: '手机整理', exact: true }).click();
  await page.getByText('描述与任务属性', { exact: true }).click();
  await page.getByLabel('任务描述').fill('平板补充说明'); await page.getByRole('button', { name: '保存任务', exact: true }).click();
  expect((await stored(page)).tasks[0].description).toBe('平板补充说明');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tablet.png', fullPage: true });
});

test('关闭浏览器进程并重新打开同一用户目录，数据与设置仍然保留', async ({ playwright }, testInfo) => {
  const profile = testInfo.outputPath('persistent-profile');
  let browser = await playwright.chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  let page = browser.pages()[0]; await page.goto('http://127.0.0.1:4173');
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
  await makeList(page, '重启保留'); await makeTask(page, '重启任务');
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await browser.close();
  browser = await playwright.chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  try {
    await browser.setOffline(true);
    page = browser.pages()[0]; await page.goto('http://127.0.0.1:4173');
    await expect(page.getByRole('button', { name: '重启任务', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await stored(page)).lists.some((l) => l.title === '重启保留')).toBe(true);
  } finally { await browser.close(); }
});

test('修改清单颜色立即更新日历，显隐、归档、删除迁移及布局设置生效', async ({ page }) => {
  await open(page); await makeList(page, '课程学习');
  await page.getByRole('button', { name: /^课程学习/ }).click(); await makeTask(page);
  await schedule(page, '2026-10-21T09:00', '2026-10-21T10:00');
  const event = page.locator('.fc-timegrid-event', { hasText: '完成实验报告' });
  await expect(event).toBeVisible();
  const beforeColor = await event.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole('button', { name: '管理清单 课程学习' }).click();
  let dialog = page.getByRole('dialog', { name: '管理清单', exact: true });
  await dialog.getByRole('button', { name: '选择清单颜色', exact: true }).click();
  const colors = page.getByRole('dialog', { name: '选择清单颜色', exact: true });
  await colors.getByRole('button', { name: '颜色 #d27793', exact: true }).click(); await colors.getByRole('button', { name: '确认颜色', exact: true }).click(); await dialog.getByRole('button', { name: '保存清单' }).click();
  await expect.poll(() => event.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(beforeColor);
  await page.getByRole('button', { name: '管理清单 课程学习' }).click();
  await dialog.getByRole('button', { name: '从总览隐藏此清单' }).click(); await dialog.getByRole('button', { name: '保存清单' }).click();
  await expect(event).toHaveCount(0);
  await page.getByRole('button', { name: '管理清单 课程学习' }).click(); await dialog.getByRole('button', { name: '显示清单与安排' }).click();
  await dialog.getByRole('button', { name: '归档清单', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect(event).toHaveCount(0);
  await page.getByRole('button', { name: /已归档清单/ }).click(); await page.getByRole('button', { name: '管理清单 课程学习' }).click();
  await dialog.getByRole('button', { name: '恢复清单', exact: true }).click(); await expect(event).toBeVisible();
  await page.getByRole('button', { name: '管理清单 课程学习' }).click(); await dialog.getByRole('button', { name: '删除清单', exact: true }).click();
  await page.getByRole('dialog', { name: '删除「课程学习」？' }).getByRole('button', { name: '迁移任务并删除清单' }).click();
  await expect(dialog).not.toBeVisible();
  const snapshot = await stored(page); expect(snapshot.lists).toHaveLength(1); expect(snapshot.tasks[0].listId).toBe(snapshot.lists[0].id); expect(snapshot.scheduleBlocks).toHaveLength(1);
  await page.getByRole('button', { name: '折叠清单侧栏' }).click(); await page.getByRole('button', { name: '折叠待办侧栏' }).click();
  await expect(page.locator('.app')).toHaveClass(/sidebar-collapsed.*tasks-collapsed/);
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.reload(); await expect(page.locator('.app')).toHaveClass(/sidebar-collapsed.*tasks-collapsed/);
  await page.getByRole('button', { name: '展开清单侧栏' }).click(); await page.getByRole('button', { name: '展开待办侧栏' }).click();
  await page.getByRole('button', { name: '设置与数据', exact: true }).click(); dialog = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await dialog.getByLabel('默认日历视图').selectOption('month'); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await page.reload(); await expect(page.getByRole('button', { name: '月', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('纽约浏览器拒绝 DST 不存在的时间，跨月全天区间仍按日期保存', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:4173');
    await page.getByRole('button', { name: '新建日程', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建日程', exact: true });
    await dialog.getByLabel('日程标题').fill('夏令时测试');
    await dialog.getByLabel('开始时间', { exact: true }).fill('2026-03-08T02:30'); await dialog.getByLabel('结束时间', { exact: true }).fill('2026-03-08T04:00');
    await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog.getByRole('alert')).toContainText('夏令时');
    expect((await stored(page)).scheduleBlocks).toHaveLength(0);
    await dialog.getByLabel('开始时间', { exact: true }).fill('2026-03-08T01:30'); await dialog.getByRole('button', { name: '保存安排' }).click();
    await expect(dialog).not.toBeVisible();
    expect((await stored(page)).scheduleBlocks[0]).toMatchObject({ startAt: '2026-03-08T06:30:00.000Z', endAt: '2026-03-08T08:00:00.000Z', timeZone: 'America/New_York' });
    await page.getByRole('button', { name: '新建日程', exact: true }).click(); await dialog.getByLabel('日程标题').fill('跨月全天');
    await dialog.getByLabel('全天', { exact: true }).check(); await dialog.getByLabel('开始日期', { exact: true }).fill('2026-10-31'); await dialog.getByLabel('结束日期', { exact: true }).fill('2026-11-01');
    await dialog.getByRole('button', { name: '保存安排' }).click(); await expect(dialog).not.toBeVisible();
    await page.reload(); expect((await stored(page)).scheduleBlocks.find((b) => b.allDay)).toMatchObject({ startDate: '2026-10-31', endDate: '2026-11-02' });
  } finally { await context.close(); }
});
