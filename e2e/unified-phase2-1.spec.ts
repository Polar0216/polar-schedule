import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ScheduleBlock, Task } from '../src/domain/schema';

async function stored(page: Page): Promise<{ tasks: Task[]; scheduleBlocks: ScheduleBlock[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('polar-schedule'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const tx = db.transaction(['tasks', 'scheduleBlocks']);
      const read = (name: string) => new Promise<unknown[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
      const [tasks, scheduleBlocks] = await Promise.all([read('tasks'), read('scheduleBlocks')]);
      return { tasks, scheduleBlocks } as { tasks: Task[]; scheduleBlocks: ScheduleBlock[] };
    } finally { db.close(); }
  });
}
async function saveRange(page: Page, start: string, end: string) {
  await page.getByLabel('开始时间', { exact: true }).fill(start); await page.getByLabel('结束时间', { exact: true }).fill(end);
  await page.getByRole('button', { name: '保存安排', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function setupTask(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill('Task A 分次学习');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.getByRole('button', { name: '返回待办', exact: true }).click();
  await page.getByRole('button', { name: '安排时间 Task A 分次学习', exact: true }).click();
  await saveRange(page, '2026-10-19T08:00', '2026-10-19T09:00');
  const col = await page.locator('.fc-timegrid-col[data-date="2026-10-20"]').boundingBox();
  const slot = await page.locator('.fc-timegrid-slot-lane[data-time="09:00:00"]').boundingBox();
  if (!col || !slot) throw new Error('时间轴未显示');
  await page.mouse.click(col.x + col.width / 2, slot.y + slot.height / 2);
  await page.getByLabel('开始时间', { exact: true }).fill('2026-10-20T09:07');
  await page.getByRole('button', { name: '安排已有任务', exact: true }).click();
  await page.getByLabel('选择已有任务').selectOption({ label: 'Task A 分次学习 · 收集箱' });
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-20T09:07');
  await saveRange(page, '2026-10-20T09:00', '2026-10-20T10:00');
  const data = await stored(page);
  const blocks = data.scheduleBlocks.filter((b) => b.type === 'task').sort((a, b) => (a.allDay ? '' : a.startAt).localeCompare(b.allDay ? '' : b.startAt));
  expect(data.tasks).toHaveLength(1); expect(blocks).toHaveLength(2);
  return { first: blocks[0].id, second: blocks[1].id, taskId: data.tasks[0].id };
}

test('P2.1 日历直接编辑本次、独立完成与撤销、跨页离线及导出恢复', async ({ page, context }) => {
  test.setTimeout(90000);
  const ids = await setupTask(page);
  const calendarBlock = (id: string) => page.locator(`.fc-timegrid-event[data-block-id="${id}"]`);
  await calendarBlock(ids.first).click();
  const form = page.getByRole('dialog', { name: '编辑任务安排', exact: true });
  await expect(form).toContainText('第 1 / 2 段安排');
  await form.getByLabel('开始时间', { exact: true }).fill('2026-10-19T08:15');
  await form.getByLabel('结束时间', { exact: true }).fill('2026-10-19T09:15');
  await form.getByRole('button', { name: '保存安排', exact: true }).click();
  let data = await stored(page);
  expect(data.tasks).toHaveLength(1);
  expect(data.scheduleBlocks.find((b) => b.id === ids.second)).toMatchObject({ startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z', executionStatus: 'pending' });
  await calendarBlock(ids.first).click(); await form.getByRole('button', { name: '本次完成', exact: true }).click();
  await expect(form.getByRole('button', { name: '撤销本次完成', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-quick-edit-light.png', fullPage: true });
  data = await stored(page); expect(data.tasks[0].status).toBe('todo');
  expect(data.scheduleBlocks.find((b) => b.id === ids.first)).toMatchObject({ executionStatus: 'completed', completedAt: expect.any(String) });
  expect(data.scheduleBlocks.find((b) => b.id === ids.second)).toMatchObject({ executionStatus: 'pending' });
  await form.getByRole('button', { name: '关闭', exact: true }).click();
  await calendarBlock(ids.second).click(); await form.getByRole('button', { name: '本次完成', exact: true }).click();
  await form.getByRole('button', { name: '撤销本次完成', exact: true }).click();
  await form.getByRole('button', { name: '关闭', exact: true }).click();
  await calendarBlock(ids.first).click(); await form.getByRole('button', { name: '撤销本次完成', exact: true }).click();
  await form.getByRole('button', { name: '本次完成', exact: true }).click();
  await form.getByLabel('开始时间', { exact: true }).fill('2026-10-19T08:20');
  await form.getByRole('button', { name: '保存并查看完整任务', exact: true }).click();
  expect((await stored(page)).scheduleBlocks.find((b) => b.id === ids.first)).toMatchObject({ startAt: '2026-10-19T00:20:00.000Z', executionStatus: 'completed' });
  await expect(page.locator('.linked-section')).toContainText('1/2');
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-task-details-light.png', fullPage: true });
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-task-details-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-task-details-mobile-dark.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '周', exact: true }).click();
  await page.getByRole('button', { name: '切换浅色模式', exact: true }).click();
  await page.getByLabel('任务状态', { exact: true }).selectOption('done');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks[0].status).toBe('done');
  expect((await stored(page)).scheduleBlocks.find((b) => b.id === ids.second)).toMatchObject({ executionStatus: 'pending' });
  await calendarBlock(ids.second).click(); await expect(form).toContainText('整个任务：已完成');
  await expect(form.getByRole('button', { name: '本次完成', exact: true })).toBeVisible();
  await form.getByRole('button', { name: '关闭', exact: true }).click();
  const other = await context.newPage(); await other.goto('/');
  await expect(other.locator(`.fc-timegrid-event[data-block-id="${ids.first}"]`)).toHaveClass(/completed-event/);
  await calendarBlock(ids.second).click(); await form.getByRole('button', { name: '本次完成', exact: true }).click();
  await expect(other.locator(`.fc-timegrid-event[data-block-id="${ids.second}"]`)).toHaveClass(/completed-event/);
  await form.getByRole('button', { name: '撤销本次完成', exact: true }).click(); await other.close();
  await form.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true); await page.reload();
  await expect(calendarBlock(ids.first)).toHaveClass(/completed-event/);
  await expect(calendarBlock(ids.second)).not.toHaveClass(/completed-event/); await context.setOffline(false);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-task-week-light.png', fullPage: true });
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-task-week-dark.png', fullPage: true });
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  const downloadPromise = page.waitForEvent('download'); await settings.getByRole('button', { name: '导出完整 JSON', exact: true }).click();
  const file = await (await downloadPromise).path(); if (!file) throw new Error('未导出');
  const json = await readFile(file, 'utf8'); expect(JSON.parse(json).schemaVersion).toBe(3);
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'v3.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await settings.getByRole('button', { name: '继续替换导入…', exact: true }).click();
  await page.getByRole('button', { name: '确认备份并替换', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认替换全部本地数据？' })).not.toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  data = await stored(page); expect(data.tasks[0].status).toBe('done');
  expect(data.scheduleBlocks.find((b) => b.id === ids.first)).toMatchObject({ executionStatus: 'completed' });
  expect(data.scheduleBlocks.find((b) => b.id === ids.second)).toMatchObject({ executionStatus: 'pending' });
});

test('P2.1 迷你月历跨月、精确分钟、Esc、非法时间与手机主题', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建日程', exact: true });
  await form.getByLabel('日程标题', { exact: true }).fill('跨月精确时间');
  await form.getByLabel('开始时间', { exact: true }).fill('2026-10-31T23:55');
  await form.getByRole('button', { name: '选择开始时间', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择开始时间', exact: true });
  await picker.getByLabel('下个月', { exact: true }).click();
  await picker.locator('[data-day="2026-11-01"] button').click();
  await picker.getByLabel('开始时间小时', { exact: true }).selectOption('00');
  await picker.getByLabel('开始时间精确分钟', { exact: true }).fill('7');
  await picker.getByLabel('开始时间精确分钟', { exact: true }).press('Enter');
  await expect(picker).toBeVisible(); expect((await stored(page)).scheduleBlocks).toHaveLength(0);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-picker-light.png', fullPage: true });
  await picker.getByRole('button', { name: '确认开始时间', exact: true }).click();
  await expect(form.getByLabel('开始时间', { exact: true })).toHaveValue('2026-11-01T00:07');
  await form.getByLabel('结束时间', { exact: true }).fill('2026-11-01T00:06');
  await form.getByRole('button', { name: '保存安排', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('结束时间必须晚于');
  await form.getByRole('button', { name: '选择结束时间', exact: true }).focus();
  await page.keyboard.press('Enter');
  const endPicker = page.getByRole('dialog', { name: '选择结束时间', exact: true });
  await expect(endPicker).toBeVisible(); await page.keyboard.press('Escape');
  await expect(endPicker).not.toBeVisible(); await expect(form).toBeVisible();
  await expect(form.getByRole('button', { name: '选择结束时间', exact: true })).toBeFocused();
  await form.getByLabel('结束时间', { exact: true }).fill('2026-11-01T00:17');
  await form.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(form).not.toBeVisible();
  expect((await stored(page)).scheduleBlocks[0]).toMatchObject({ startAt: '2026-10-31T16:07:00.000Z', endAt: '2026-10-31T16:17:00.000Z' });
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  await form.getByLabel('全天', { exact: true }).check();
  await form.getByRole('button', { name: '选择开始日期', exact: true }).click();
  const datePicker = page.getByRole('dialog', { name: '选择开始日期', exact: true });
  await expect(datePicker.getByLabel('24 小时时间选择')).toHaveCount(0);
  const box = await datePicker.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'docs/evidence/phase4/regression/regression/regression-picker-mobile-dark.png', fullPage: true });
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape'); await expect(datePicker).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('P2.1 关闭浏览器进程后两段完成记录保留', async ({ playwright }, testInfo) => {
  test.setTimeout(90000);
  const profile = testInfo.outputPath('execution-profile');
  let browser = await playwright.chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  let page = browser.pages()[0]; const ids = await setupTask(page);
  await page.locator(`.fc-timegrid-event[data-block-id="${ids.first}"]`).click();
  await page.getByRole('button', { name: '本次完成', exact: true }).click();
  await expect.poll(async () => (await stored(page)).scheduleBlocks.find((b) => b.id === ids.first)?.type === 'task' && (await stored(page)).scheduleBlocks.find((b) => b.id === ids.first)).toMatchObject({ executionStatus: 'completed' });
  await browser.close();
  browser = await playwright.chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  try {
    page = browser.pages()[0]; await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('http://127.0.0.1:4173');
    await expect(page.locator(`.fc-timegrid-event[data-block-id="${ids.first}"]`)).toHaveClass(/completed-event/);
    expect((await stored(page)).scheduleBlocks.find((b) => b.id === ids.second)).toMatchObject({ executionStatus: 'pending' });
    expect((await stored(page)).tasks[0].status).toBe('todo');
  } finally { await browser.close(); }
});
