import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dataSchema as legacyV1Schema } from '../src/domain/legacyV1';
import { dataSchema as legacyV2Schema, type ScheduleData as LegacyV2Data } from '../src/domain/legacyV2';
import { initialData, migrateData } from '../src/domain/schema';

const meta = { revision: 6, createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-10-01T02:00:00.000Z' };
const taskId = '30000000-0000-4000-8000-000000000001', blockId = '30000000-0000-4000-8000-000000000002';
const seriesId = '30000000-0000-4000-8000-000000000003', tagId = '30000000-0000-4000-8000-000000000004';
const range = { allDay: false as const, timeZone: 'Asia/Shanghai', startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:00:00.000Z' };

function v2Fixture(): LegacyV2Data {
  const seed = initialData();
  return legacyV2Schema.parse({ ...seed, schemaVersion: 2, updatedAt: meta.updatedAt,
    tasks: [{ ...meta, id: taskId, title: 'v2原始分段任务', description: '完整保留的内容', listId: seed.lists[0].id, status: 'done', completedAt: meta.updatedAt,
      priority: 'high', dueDate: '2026-10-23', order: 2, tagIds: [tagId], subtasks: [{ id: '30000000-0000-4000-8000-000000000005', title: '原子任务', done: true, order: 0 }] }],
    tags: [{ ...meta, id: tagId, title: '原标签', color: '#123456' }],
    scheduleBlocks: [
      { ...meta, id: blockId, ...range, type: 'task', taskId },
      { ...meta, id: seriesId, ...range, type: 'event', title: '原重复课程', description: '课程不能丢', display: 'background', color: '#abcdef',
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3], startDate: '2026-10-19', localTime: '08:00', durationMinutes: 60, count: 10 } },
    ],
    exceptions: [{ ...meta, id: '30000000-0000-4000-8000-000000000006', seriesId, occurrenceDate: '2026-10-21', cancelled: true }],
    settings: { ...seed.settings, theme: 'dark', density: 'compact', slotMinutes: 15, startHour: 7, endHour: 23, showBackground: false },
  });
}

async function nativeState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const keys = [...db.objectStoreNames], tx = db.transaction(keys, 'readonly');
      const rows = await Promise.all(keys.map((key) => new Promise<[string, unknown[]]>((resolve, reject) => {
        const request = tx.objectStore(key).getAll(); request.onsuccess = () => resolve([key, request.result as unknown[]]); request.onerror = () => reject(request.error);
      })));
      return { version: db.version, tables: Object.fromEntries(rows) };
    } finally { db.close(); }
  });
}

function dataFromRaw(state: Awaited<ReturnType<typeof nativeState>>) {
  const root = state.tables.metadata[0] as { schemaVersion: number; settings: unknown; updatedAt: string };
  return { schemaVersion: root.schemaVersion, settings: root.settings, updatedAt: root.updatedAt,
    lists: state.tables.lists, tasks: state.tables.tasks, scheduleBlocks: state.tables.scheduleBlocks,
    tags: state.tables.tags, exceptions: state.tables.exceptions, tombstones: state.tables.tombstones };
}

test('隔离真实浏览器v2库正式升至v3，保留课程/例外/标签/主题/备份并默认每次pending', async ({ browser, baseURL }) => {
  // Every context is independent of the user's normal browser and its real DB.
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00'));
    await page.goto(`${baseURL}/favicon.svg`); // Seed same-origin v2 before app code is loaded.
    const fixture = v2Fixture();
    await page.evaluate(async (data) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('polar-schedule', 20);
        request.onupgradeneeded = () => {
          const create = (name: string, indexes: string[]) => {
            const store = request.result.createObjectStore(name, { keyPath: name === 'metadata' ? 'key' : name === 'tombstones' ? ['entityType', 'id'] : 'id' });
            for (const index of indexes) store.createIndex(index, index);
            return store;
          };
          create('lists', ['order', 'archived']); create('tasks', ['listId', 'status', 'order', 'dueDate']); create('scheduleBlocks', ['type', 'taskId']);
          create('metadata', []); create('tombstones', ['deletedAt']); create('backups', ['createdAt']); create('tags', ['title']);
          const exceptions = create('exceptions', ['seriesId']); exceptions.createIndex('[seriesId+occurrenceDate]', ['seriesId', 'occurrenceDate'], { unique: true });
          create('undo', ['createdAt', 'expiresAt']);
        };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([...db.objectStoreNames], 'readwrite');
          for (const key of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions', 'tombstones'] as const) {
            for (const record of data[key]) tx.objectStore(key).put(record);
          }
          tx.objectStore('metadata').put({ key: 'state', schemaVersion: 2, settings: data.settings, updatedAt: data.updatedAt });
          tx.objectStore('backups').put({ id: 'before-browser-upgrade', createdAt: '2026-10-01T01:00:00.000Z', data, kind: 'import' });
          tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, fixture);
    expect((await nativeState(page)).version).toBe(20);
    await page.goto(baseURL!); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const upgraded = await nativeState(page);
    expect(upgraded.version).toBe(40); expect(dataFromRaw(upgraded)).toEqual(migrateData(fixture));
    await expect(page.locator('.fc-bg-event')).toHaveCount(0);
    await expect(page.locator(`.fc-timegrid-event[data-block-id="${seriesId}"]`)).toHaveCount(1);
    expect(upgraded.tables.scheduleBlocks.find((value) => (value as { id: string }).id === blockId)).toMatchObject({ executionStatus: 'pending', revision: 6 });
    expect(upgraded.tables.tasks[0]).toMatchObject({ id: taskId, status: 'done', revision: 6 });
    expect(upgraded.tables.backups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'before-browser-upgrade', data: fixture }),
      expect.objectContaining({ id: 'before-schema-v3', kind: 'migration', data: fixture }),
    ]));
    await page.reload(); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toBeVisible();
    expect(await nativeState(page)).toEqual(upgraded);
  } finally { await context.close(); }
});

test('v1/v2 JSON在真实界面依次校验并替换恢复为v3，坏v2导入不改当前状态', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto(baseURL!);
    await page.getByRole('button', { name: '设置与数据', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '设置与数据', exact: true }), v2 = v2Fixture();
    const v1 = legacyV1Schema.parse({ schemaVersion: 1, lists: v2.lists, updatedAt: v2.updatedAt, tombstones: [],
      tasks: v2.tasks.map(({ subtasks: _subtasks, tagIds: _tagIds, ...task }) => ({ ...task, title: 'v1恢复任务' })),
      scheduleBlocks: v2.scheduleBlocks.filter((block) => block.type === 'task'),
      settings: { theme: 'dark', defaultView: 'week', timeZone: 'Asia/Shanghai', hiddenListIds: [], sidebarCollapsed: false, tasksCollapsed: false },
    });
    for (const [name, source] of [['v1.json', v1], ['v2.json', v2]] as const) {
      await dialog.getByLabel('选择导入文件').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
      await expect(dialog.getByText('导入预览 · schemaVersion 3', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '继续替换导入…' }).click();
      await page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true }).getByRole('button', { name: '确认备份并替换', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true })).not.toBeVisible();
      expect(dataFromRaw(await nativeState(page))).toEqual(migrateData(source));
    }
    const before = await nativeState(page), bad = structuredClone(v2); bad.tasks[0].tagIds = ['39999999-0000-4000-8000-000000000001'];
    await dialog.getByLabel('选择导入文件').setInputFiles({ name: 'invalid-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await expect(dialog.getByRole('alert')).toContainText('不存在的标签'); expect(await nativeState(page)).toEqual(before);
    const downloadPromise = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出完整 JSON', exact: true }).click();
    const download = await downloadPromise, path = await download.path(); if (!path) throw new Error('未生成导出文件');
    const exported: unknown = JSON.parse(await readFile(path, 'utf8')); expect(exported).toEqual(migrateData(v2));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally { await context.close(); }
});
