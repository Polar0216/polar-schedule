import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dataSchema, initialData, type ScheduleData } from '../src/domain/schema';

const ids = { task: '60000000-0000-4000-8000-000000000001', first: '60000000-0000-4000-8000-000000000002',
  second: '60000000-0000-4000-8000-000000000003', legacy: '60000000-0000-4000-8000-000000000004',
  normal: '60000000-0000-4000-8000-000000000005', series: '60000000-0000-4000-8000-000000000006',
  exception: '60000000-0000-4000-8000-000000000007', tag: '60000000-0000-4000-8000-000000000008' };
const meta = { revision: 7, createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-10-18T01:00:00.000Z' };
const range = { allDay: false as const, timeZone: 'Asia/Shanghai', startAt: '2026-10-19T02:00:00.000Z', endAt: '2026-10-19T03:00:00.000Z' };

function legacyFixture(): ScheduleData {
  const seed = initialData();
  return dataSchema.parse({ ...seed, updatedAt: meta.updatedAt,
    tasks: [{ ...meta, id: ids.task, title: '旧数据分段任务', description: '完成记录必须保留', listId: seed.lists[0].id, status: 'todo', priority: 'high', dueDate: '2026-10-23',
      order: 1, subtasks: [{ id: '60000000-0000-4000-8000-000000000009', title: '旧子任务', done: true, order: 0 }], tagIds: [ids.tag] }],
    scheduleBlocks: [
      { ...meta, ...range, id: ids.first, type: 'task', taskId: ids.task, executionStatus: 'completed', completedAt: meta.updatedAt,
        startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:00:00.000Z' },
      { ...meta, ...range, id: ids.second, type: 'task', taskId: ids.task, executionStatus: 'pending', startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z' },
      { ...meta, ...range, id: ids.legacy, type: 'event', title: '旧背景记录', description: '仅兼容字段，不再分层', display: 'background', color: '#43a58a' },
      { ...meta, ...range, id: ids.normal, type: 'event', title: '原普通记录', description: '', display: 'normal', color: '#4b91c3',
        startAt: '2026-10-19T06:00:00.000Z', endAt: '2026-10-19T07:00:00.000Z' },
      { ...meta, ...range, id: ids.series, type: 'event', title: '旧背景系列', description: '', display: 'background', color: '#d9954e',
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [3], startDate: '2026-10-21', localTime: '08:00', durationMinutes: 60, count: 2 } },
    ],
    tags: [{ ...meta, id: ids.tag, title: '旧标签', color: '#7774d5' }],
    exceptions: [{ ...meta, id: ids.exception, seriesId: ids.series, occurrenceDate: '2026-10-28', cancelled: true }],
    settings: { ...seed.settings, theme: 'light', defaultView: 'week', startHour: 7, endHour: 23, showBackground: false },
  });
}

async function raw(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly');
      const rows = await Promise.all(names.map((name) => new Promise<[string, unknown[]]>((resolve, reject) => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve([name, request.result as unknown[]]); request.onerror = () => reject(request.error);
      })));
      return { version: db.version, tables: Object.fromEntries(rows) };
    } finally { db.close(); }
  });
}

async function snapshot(page: Page) {
  const state = await raw(page);
  const root = state.tables.metadata[0] as { schemaVersion: number; settings: unknown; updatedAt: string };
  return dataSchema.parse({ schemaVersion: root.schemaVersion, settings: root.settings, updatedAt: root.updatedAt,
    lists: state.tables.lists, tasks: state.tables.tasks, scheduleBlocks: state.tables.scheduleBlocks,
    tags: state.tables.tags, exceptions: state.tables.exceptions, tombstones: state.tables.tombstones });
}

test('P2.2.1 旧background/关闭显示标志导入后日周月仍为可操作前景；编辑拖动拉伸保留兼容字段和其他实体', async ({ page }) => {
  test.setTimeout(90000); await mkdir('docs/evidence/phase4/regression/regression', { recursive: true });
  await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('/');
  const fixture = legacyFixture();
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  await expect(settings.getByLabel('显示背景安排', { exact: true })).toHaveCount(0);
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'old-v3-background-hidden.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await settings.getByRole('button', { name: '继续替换导入…', exact: true }).click();
  await page.getByRole('button', { name: '确认备份并替换', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true })).not.toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  const originalRaw = await raw(page), original = await snapshot(page); expect(original).toEqual(fixture); expect(originalRaw.version).toBe(40);
  for (const [view, kind] of [['日', 'day'], ['周', 'week'], ['月', 'month']] as const) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const event = page.locator(`.fc-event[data-block-id="${ids.legacy}"]`);
    await expect(event).toHaveCount(1); await expect(event).toBeVisible(); await expect(event).toHaveClass(/fc-event-draggable/);
    await expect(page.locator('.fc-bg-event,.calendar-background-list,.calendar-time-marker')).toHaveCount(0);
    await expect(page.getByLabel('显示背景安排', { exact: true })).toHaveCount(0);
    await event.scrollIntoViewIfNeeded(); // Capture the legacy record itself, not another hour of the same day.
    await page.screenshot({ path: `docs/evidence/phase4/regression/regression/after-legacy-import-${kind}.png`, fullPage: true });
  }
  expect(await raw(page)).toEqual(originalRaw);
  await page.getByRole('button', { name: '日', exact: true }).click();
  const event = page.locator(`.fc-timegrid-event[data-block-id="${ids.legacy}"]`);
  await event.click(); const editor = page.getByRole('dialog', { name: '编辑日程', exact: true });
  await expect(editor.getByLabel('日历呈现方式')).toHaveCount(0);
  await editor.getByLabel('日程标题').fill('旧背景记录已编辑'); await editor.getByRole('button', { name: '保存安排', exact: true }).click();
  await expect(editor).not.toBeVisible();
  let current = await snapshot(page);
  expect(current.scheduleBlocks.find((block) => block.id === ids.legacy)).toMatchObject({ title: '旧背景记录已编辑', display: 'background', revision: 8, ...range });
  const box = await event.boundingBox(), ten = await page.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]').boundingBox(), eleven = await page.locator('.fc-timegrid-slot-lane[data-time="11:00:00"]').boundingBox();
  if (!box || !ten || !eleven) throw new Error('旧记录拖动区域不可见');
  await page.mouse.move(box.x + box.width / 2, box.y + 18); await page.mouse.down(); await page.waitForTimeout(100);
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + 18 + eleven.y - ten.y, { steps: 20 }); await page.waitForTimeout(100); await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).scheduleBlocks.find((block) => block.id === ids.legacy)).toMatchObject({ startAt: '2026-10-19T03:00:00.000Z', endAt: '2026-10-19T04:00:00.000Z', display: 'background', revision: 9 });
  await event.hover(); const resize = await event.locator('.fc-event-resizer-end').boundingBox();
  const twelve = await page.locator('.fc-timegrid-slot-lane[data-time="12:00:00"]').boundingBox(), twelveThirty = await page.locator('.fc-timegrid-slot-lane[data-time="12:30:00"]').boundingBox();
  if (!resize || !twelve || !twelveThirty) throw new Error('旧记录拉伸手柄不可见');
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2 + twelveThirty.y - twelve.y, { steps: 20 }); await page.waitForTimeout(100); await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).scheduleBlocks.find((block) => block.id === ids.legacy)).toMatchObject({ startAt: '2026-10-19T03:00:00.000Z', endAt: '2026-10-19T04:30:00.000Z', display: 'background', revision: 10 });
  current = await snapshot(page);
  expect(current.scheduleBlocks.filter((block) => block.id !== ids.legacy)).toEqual(original.scheduleBlocks.filter((block) => block.id !== ids.legacy));
  expect(current.tasks).toEqual(original.tasks); expect(current.lists).toEqual(original.lists); expect(current.tags).toEqual(original.tags);
  expect(current.exceptions).toEqual(original.exceptions); expect(current.tombstones).toEqual(original.tombstones); expect(current.settings).toEqual(original.settings);
  expect((await raw(page)).tables.backups).toEqual(originalRaw.tables.backups); expect((await raw(page)).version).toBe(40);
  await page.reload(); await expect(page.locator(`.fc-timegrid-event[data-block-id="${ids.legacy}"]`)).toBeVisible();
  expect(await snapshot(page)).toEqual(current);
});
