import { test, expect, type Page } from '@playwright/test';
import type { RecurrenceException, ScheduleBlock, Task } from '../src/domain/schema';
import { initialData } from '../src/domain/schema';

async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('polar-schedule'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const tx = db.transaction(['scheduleBlocks', 'tasks', 'exceptions', 'metadata']);
      const get = (name: string) => new Promise<unknown[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result as unknown[]); });
      const [scheduleBlocks, tasks, exceptions, metadata] = await Promise.all(['scheduleBlocks', 'tasks', 'exceptions', 'metadata'].map(get));
      return { scheduleBlocks: scheduleBlocks as ScheduleBlock[], tasks: tasks as Task[], exceptions: exceptions as RecurrenceException[], metadata };
    } finally { db.close(); }
  });
}
async function weekly(page: Page, title: string, date: string) {
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建日程', exact: true });
  await form.getByLabel('日程标题').fill(title);
  await form.getByLabel('开始时间', { exact: true }).fill(`${date}T08:00`);
  await form.getByLabel('结束时间', { exact: true }).fill(`${date}T09:35`);
  await form.getByLabel('重复频率').selectOption('weekly');
  // The first selected weekday originates from the opened form's current date,
  // so explicitly choose Monday/Wednesday without depending on the host clock.
  for (const day of ['周日', '周二', '周四', '周五', '周六']) await form.getByLabel(`重复${day}`, { exact: true }).uncheck();
  await form.getByLabel('重复周一', { exact: true }).check(); await form.getByLabel('重复周三', { exact: true }).check();
  await form.getByLabel('重复结束条件').selectOption('count'); await form.getByLabel('重复次数').fill('10');
  await form.getByRole('button', { name: '保存安排' }).click(); await expect(form).not.toBeVisible();
}

test('重复课程只存系列，本次改时/取消、系列编辑与整系列撤销互不混淆', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('/');
  await weekly(page, '理论力学', '2026-10-19');
  await expect(page.locator('.fc-timegrid-event strong', { hasText: '理论力学' })).toHaveCount(2);
  expect((await records(page)).scheduleBlocks).toHaveLength(1);
  await page.locator('.fc-timegrid-col[data-date="2026-10-19"] .fc-event').click();
  let form = page.getByRole('dialog', { name: '编辑重复日程', exact: true });
  await expect(form.getByLabel('编辑范围')).toHaveValue('occurrence');
  await form.getByLabel('日程标题').fill('理论力学（本次改时）');
  await form.getByLabel('开始时间', { exact: true }).fill('2026-10-19T10:00'); await form.getByLabel('结束时间', { exact: true }).fill('2026-10-19T11:35');
  await form.getByRole('button', { name: '保存安排' }).click(); await expect(form).not.toBeVisible();
  let data = await records(page); expect(data.scheduleBlocks).toHaveLength(1); expect(data.exceptions).toHaveLength(1);
  expect(data.exceptions[0]).toMatchObject({ occurrenceDate: '2026-10-19', cancelled: false, replacement: { title: '理论力学（本次改时）' } });
  await page.locator('.fc-timegrid-col[data-date="2026-10-21"] .fc-event').click();
  await form.getByRole('button', { name: '删除本次', exact: true }).click();
  await page.getByRole('dialog', { name: '删除本次安排？' }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(form).not.toBeVisible(); await expect(page.locator('.fc-timegrid-event')).toHaveCount(1);
  expect((await records(page)).exceptions.some((e) => e.cancelled && e.occurrenceDate === '2026-10-21')).toBe(true);
  await page.getByRole('button', { name: '下一段日期' }).click();
  await expect(page.locator('.fc-timegrid-event strong', { hasText: '理论力学' })).toHaveCount(2);
  await page.locator('.fc-timegrid-event').first().click();
  await form.getByLabel('编辑范围').selectOption('series');
  await expect(form.getByLabel('日程标题')).toHaveValue('理论力学');
  await form.getByLabel('日程标题').fill('理论力学（系列修订）');
  await expect(form.getByLabel('日历呈现方式')).toHaveCount(0); // P2.2.1 removes the layer switch, retaining legacy data fields.
  await form.getByRole('button', { name: '保存安排' }).click(); await expect(form).not.toBeVisible();
  await expect(page.locator('.fc-bg-event')).toHaveCount(0);
  await expect(page.locator('.fc-timegrid-event strong', { hasText: '理论力学（系列修订）' })).toHaveCount(2);
  data = await records(page); expect(data.scheduleBlocks).toHaveLength(1); expect(data.exceptions).toHaveLength(2);
  const series = data.scheduleBlocks[0]; expect(series).toMatchObject({ type: 'event', title: '理论力学（系列修订）', display: 'normal' });
  await page.locator('.fc-timegrid-event').first().click();
  form = page.getByRole('dialog', { name: '编辑重复日程', exact: true });
  await form.getByLabel('编辑范围').selectOption('series'); await form.getByRole('button', { name: '删除整个系列', exact: true }).click();
  await page.getByRole('dialog', { name: '删除整个重复系列？' }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(form).not.toBeVisible(); expect((await records(page)).scheduleBlocks).toHaveLength(0); expect((await records(page)).exceptions).toHaveLength(0);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(page.locator('.fc-timegrid-event strong', { hasText: '理论力学（系列修订）' })).toHaveCount(2);
  data = await records(page); expect(data.scheduleBlocks[0].id).toBe(series.id); expect(data.exceptions).toHaveLength(2);
  await page.reload(); await expect(page.locator('.fc-bg-event')).toHaveCount(0); // Oct19 override stays normal; Oct21 stays cancelled.
  await expect(page.locator('.fc-timegrid-event strong', { hasText: '理论力学（本次改时）' })).toHaveCount(1);
});

test('时间轴粒度/范围/周起始/密度持久化，旧背景字段不被已移除的设置改写，默认安排时长生效', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('/');
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const form = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await form.getByLabel('时间粒度', { exact: true }).selectOption('15');
  await form.getByLabel('显示开始小时').selectOption('7'); await form.getByLabel('显示结束小时').selectOption('23');
  await form.getByLabel('周起始日').selectOption('0'); await form.getByLabel('页面密度').selectOption('compact');
  await form.getByLabel('默认安排时长').selectOption('90');
  await expect(form.getByLabel('显示背景安排', { exact: true })).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await form.getByRole('button', { name: '关闭', exact: true }).click(); await page.reload();
  await expect(page.locator('.calendar-host')).toHaveClass(/density-compact/);
  expect(await page.locator('.fc-timegrid-col[data-date]').first().getAttribute('data-date')).toBe('2026-10-18');
  expect(await page.locator('.fc-timegrid-slot-lane').first().getAttribute('data-time')).toBe('07:00:00');
  expect(await page.locator('.fc-timegrid-slot-lane').nth(1).getAttribute('data-time')).toBe('07:15:00');
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const eventForm = page.getByRole('dialog', { name: '新建日程', exact: true });
  await eventForm.getByLabel('日程标题').fill('显示范围之外'); await eventForm.getByLabel('开始时间', { exact: true }).fill('2026-10-19T05:00'); await eventForm.getByLabel('结束时间', { exact: true }).fill('2026-10-19T06:00');
  await eventForm.getByRole('button', { name: '保存安排' }).click(); await expect(eventForm).not.toBeVisible();
  await expect(page.locator('.calendar-outside-list summary')).toContainText('1'); await page.locator('.calendar-outside-list summary').click();
  await page.locator('.calendar-outside-list button').click(); await expect(page.getByRole('dialog', { name: '编辑日程', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '编辑日程', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click(); await page.getByLabel('任务标题', { exact: true }).fill('九十分钟专注');
  await page.getByRole('button', { name: '保存任务', exact: true }).click(); await page.getByRole('button', { name: '返回待办', exact: true }).click();
  // Default duration is asserted with the actual drop in the calendar UX suite.
  await page.getByRole('button', { name: '设置与数据', exact: true }).click(); await expect(form.getByLabel('默认安排时长')).toHaveValue('90');
  await expect(form.getByLabel('显示背景安排', { exact: true })).toHaveCount(0);
  expect(((await records(page)).metadata[0] as { settings: { showBackground: boolean } }).settings.showBackground).toBe(true);
});

test('真实浏览器旧版 IndexedDB 自动迁移，v1 JSON 仍可预览恢复', async ({ page }) => {
  await page.goto('/favicon.svg'); // Same-origin blank asset; do not boot the v2 app before seeding v1.
  const seed = initialData(); const now = '2026-10-19T01:00:00.000Z';
  const oldSettings = { theme: 'dark', defaultView: 'week', timeZone: 'Asia/Shanghai', hiddenListIds: [], sidebarCollapsed: false, tasksCollapsed: false };
  const legacy = { schemaVersion: 1, lists: seed.lists, tasks: [{ id: '11111111-1111-4111-8111-111111111111', revision: 4, createdAt: now, updatedAt: now,
    title: '升级前真实格式任务', listId: seed.lists[0].id, description: '需要完整保留', priority: 'high', status: 'todo', order: 8, dueDate: '2026-10-23' }],
    scheduleBlocks: [], tombstones: [], settings: oldSettings, updatedAt: now };
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('polar-schedule', 10);
      r.onupgradeneeded = () => { for (const key of ['lists', 'tasks', 'scheduleBlocks', 'metadata', 'tombstones', 'backups']) r.result.createObjectStore(key, { keyPath: key === 'metadata' ? 'key' : key === 'tombstones' ? ['entityType', 'id'] : 'id' }); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['lists', 'tasks', 'metadata'], 'readwrite');
      data.lists.forEach((l) => tx.objectStore('lists').put(l)); data.tasks.forEach((t) => tx.objectStore('tasks').put(t));
      tx.objectStore('metadata').put({ key: 'state', schemaVersion: 1, settings: data.settings, updatedAt: data.updatedAt });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, legacy);
  await page.goto('/'); await expect(page.getByRole('button', { name: '升级前真实格式任务', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await records(page)).tasks[0]).toMatchObject({ id: legacy.tasks[0].id, revision: 4, dueDate: '2026-10-23', subtasks: [], tagIds: [] });
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await dialog.getByLabel('选择导入文件').setInputFiles({ name: 'phase1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await expect(dialog.getByText('导入预览 · schemaVersion 3', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/1 条任务 · 0 段安排/)).toBeVisible();
});

test('纽约每周墙上时间跨夏令时保持，离线可编辑单次例外', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); await page.clock.setFixedTime(new Date('2026-03-01T09:00:00-05:00')); await page.goto(baseURL!);
    await page.getByRole('button', { name: '新建日程', exact: true }).click();
    let form = page.getByRole('dialog', { name: '新建日程', exact: true });
    await form.getByLabel('日程标题').fill('周日晨读'); await form.getByLabel('开始时间', { exact: true }).fill('2026-03-01T09:00'); await form.getByLabel('结束时间', { exact: true }).fill('2026-03-01T10:00');
    await form.getByLabel('重复频率').selectOption('weekly'); await form.getByLabel('重复周日').check();
    await form.getByRole('button', { name: '保存安排' }).click(); await expect(form).not.toBeVisible();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); await page.getByRole('button', { name: '下一段日期' }).click();
    await expect(page.locator('.fc-timegrid-event .block-time')).toHaveText('09:00');
    await expect(page.locator('.fc-timegrid-event')).toHaveAttribute('title', /09:00.*10:00/);
    await context.setOffline(true); await page.locator('.fc-timegrid-event').click();
    form = page.getByRole('dialog', { name: '编辑重复日程', exact: true });
    await form.getByLabel('开始时间', { exact: true }).fill('2026-03-08T10:00'); await form.getByLabel('结束时间', { exact: true }).fill('2026-03-08T11:00');
    await form.getByRole('button', { name: '保存安排' }).click(); await expect(form).not.toBeVisible();
    expect((await records(page)).exceptions[0].replacement?.range).toMatchObject({ startAt: '2026-03-08T14:00:00.000Z', endAt: '2026-03-08T15:00:00.000Z' });
    await page.reload(); await page.getByRole('button', { name: '下一段日期' }).click(); await expect(page.locator('.fc-timegrid-event .block-time')).toHaveText('10:00');
    await expect(page.locator('.fc-timegrid-event')).toHaveAttribute('title', /10:00.*11:00/);
  } finally { await context.close(); }
});
