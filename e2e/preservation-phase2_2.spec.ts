import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dataSchema, initialData, type ScheduleData } from '../src/domain/schema';

const meta = { revision: 7, createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-10-18T02:00:00.000Z' };
const ids = {
  task: '50000000-0000-4000-8000-000000000001', first: '50000000-0000-4000-8000-000000000002',
  second: '50000000-0000-4000-8000-000000000003', background: '50000000-0000-4000-8000-000000000004',
  normal: '50000000-0000-4000-8000-000000000005', series: '50000000-0000-4000-8000-000000000006',
  exception: '50000000-0000-4000-8000-000000000007', tag: '50000000-0000-4000-8000-000000000008',
  hiddenList: '50000000-0000-4000-8000-000000000009', archivedList: '50000000-0000-4000-8000-000000000010',
  hiddenTask: '50000000-0000-4000-8000-000000000011', archivedTask: '50000000-0000-4000-8000-000000000012',
  hiddenBlock: '50000000-0000-4000-8000-000000000013', archivedBlock: '50000000-0000-4000-8000-000000000014',
  allDay: '50000000-0000-4000-8000-000000000015',
};
const range = { allDay: false as const, timeZone: 'Asia/Shanghai', startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:00:00.000Z' };

function fixture(): ScheduleData {
  const seed = initialData(), inbox = seed.lists[0].id;
  const task = { ...meta, id: ids.task, title: '分段任务保留验收', description: '整个任务与本次完成相互独立', listId: inbox,
    status: 'todo' as const, priority: 'high' as const, order: 0, dueDate: '2026-10-23', subtasks: [], tagIds: [ids.tag] };
  return dataSchema.parse({ ...seed, updatedAt: meta.updatedAt,
    lists: [...seed.lists,
      { ...meta, id: ids.hiddenList, title: '隐藏清单', color: '#456789', icon: 'book', order: 1, archived: false },
      { ...meta, id: ids.archivedList, title: '归档清单', color: '#987654', icon: 'code', order: 2, archived: true },
    ],
    tasks: [task, { ...task, id: ids.hiddenTask, title: '隐藏任务', listId: ids.hiddenList, order: 1 },
      { ...task, id: ids.archivedTask, title: '归档任务', listId: ids.archivedList, order: 2 }],
    scheduleBlocks: [
      { ...meta, ...range, id: ids.first, type: 'task', taskId: ids.task, executionStatus: 'completed', completedAt: meta.updatedAt,
        startAt: '2026-10-19T00:30:00.000Z', endAt: '2026-10-19T01:45:00.000Z' },
      { ...meta, ...range, id: ids.second, type: 'task', taskId: ids.task, executionStatus: 'pending',
        startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z' },
      { ...meta, ...range, id: ids.background, type: 'event', title: '背景课程应投影为月条目', description: '原背景字段不能被月视图改写', display: 'background', color: '#43a58a',
        startAt: '2026-10-19T00:15:00.000Z', endAt: '2026-10-19T01:15:00.000Z' },
      { ...meta, ...range, id: ids.normal, type: 'event', title: '普通长安排', description: '', display: 'normal', color: '#4b91c3', endAt: '2026-10-19T15:00:00.000Z' },
      { ...meta, ...range, id: ids.series, type: 'event', title: '重复背景课程', description: '', display: 'background',
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [3], startDate: '2026-10-21', localTime: '08:00', durationMinutes: 60, count: 2 } },
      { ...meta, ...range, id: ids.hiddenBlock, type: 'task', taskId: ids.hiddenTask, executionStatus: 'pending' },
      { ...meta, ...range, id: ids.archivedBlock, type: 'task', taskId: ids.archivedTask, executionStatus: 'pending' },
      { ...meta, id: ids.allDay, type: 'event', title: '跨日全天安排', description: '', display: 'normal', allDay: true,
        startDate: '2026-10-22', endDate: '2026-10-24', timeZone: 'Asia/Shanghai' },
    ],
    tags: [{ ...meta, id: ids.tag, title: '需保留标签', color: '#7774d5' }],
    exceptions: [{ ...meta, id: ids.exception, seriesId: ids.series, occurrenceDate: '2026-10-28', cancelled: true }],
    settings: { ...seed.settings, theme: 'light', defaultView: 'month', startHour: 7, endHour: 23, hiddenListIds: [ids.hiddenList], showBackground: false },
  });
}

async function seed(page: Page): Promise<void> {
  const data = fixture();
  await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('/favicon.svg');
  await page.evaluate(async (source) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('polar-schedule', 30);
      request.onupgradeneeded = () => {
        const add = (name: string, indexes: string[]) => {
          const store = request.result.createObjectStore(name, { keyPath: name === 'metadata' ? 'key' : name === 'tombstones' ? ['entityType', 'id'] : 'id' });
          for (const index of indexes) store.createIndex(index, index); return store;
        };
        add('lists', ['order', 'archived']); add('tasks', ['listId', 'status', 'order', 'dueDate']); add('scheduleBlocks', ['type', 'taskId', 'executionStatus']);
        add('metadata', []); add('backups', ['createdAt']); add('tombstones', ['deletedAt']); add('tags', ['title']);
        add('exceptions', ['seriesId']).createIndex('[seriesId+occurrenceDate]', ['seriesId', 'occurrenceDate'], { unique: true }); add('undo', ['createdAt', 'expiresAt']);
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...db.objectStoreNames], 'readwrite');
        for (const key of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions', 'tombstones'] as const) source[key].forEach((value) => tx.objectStore(key).put(value));
        tx.objectStore('metadata').put({ key: 'state', schemaVersion: 3, settings: source.settings, updatedAt: source.updatedAt });
        tx.objectStore('backups').put({ id: 'preserved-migration-backup', createdAt: metaTime(), kind: 'migration', data: source });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
    function metaTime() { return '2026-10-18T01:00:00.000Z'; }
  }, data);
  await page.goto('/'); await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toBeVisible();
}

async function raw(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly');
      const rows = await Promise.all(names.map((name) => new Promise<[string, unknown[]]>((resolve, reject) => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve([name, request.result as unknown[]]); request.onerror = () => reject(request.error);
      })));
      return { version: db.version, tables: Object.fromEntries(rows) };
    } finally { db.close(); }
  });
}

function snapshot(state: Awaited<ReturnType<typeof raw>>): ScheduleData {
  const root = state.tables.metadata[0] as { schemaVersion: number; settings: unknown; updatedAt: string };
  return dataSchema.parse({ schemaVersion: root.schemaVersion, settings: root.settings, updatedAt: root.updatedAt,
    lists: state.tables.lists, tasks: state.tables.tasks, scheduleBlocks: state.tables.scheduleBlocks,
    tags: state.tables.tags, exceptions: state.tables.exceptions, tombstones: state.tables.tombstones });
}

test('P2.2 月投影与日周导航只读，背景/系列/完成记录/隐藏清单和原始备份不被改写', async ({ page }) => {
  await seed(page); const before = await raw(page);
  const event = (id: string) => page.locator(`.fc-daygrid-event[data-block-id="${id}"]`);
  await expect(event(ids.background)).toBeVisible(); await expect(page.locator('.fc-bg-event')).toHaveCount(0);
  await expect(event(ids.first)).toHaveClass(/completed-event/); await expect(event(ids.second)).not.toHaveClass(/completed-event/);
  await expect(page.locator(`.fc-event[data-block-id="${ids.hiddenBlock}"],.fc-event[data-block-id="${ids.archivedBlock}"]`)).toHaveCount(0);
  await expect(event(ids.series)).toHaveCount(1); // Oct 28 is a cancelled single occurrence.
  await event(ids.background).click();
  const editor = page.getByRole('dialog', { name: '编辑日程', exact: true });
  await expect(editor.getByLabel('日历呈现方式')).toHaveCount(0);
  await expect(editor.getByLabel('日程标题')).toHaveValue('背景课程应投影为月条目');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await event(ids.first).click();
  const taskEditor = page.getByRole('dialog', { name: '编辑任务安排', exact: true });
  await expect(taskEditor.getByRole('button', { name: '撤销本次完成', exact: true })).toBeVisible();
  await taskEditor.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '预览2026-10-19的安排', exact: true }).click();
  const preview = page.getByRole('dialog', { name: /^当天安排 ·/ });
  await expect(preview).toContainText('分段任务保留验收'); await expect(preview).toContainText('背景课程应投影为月条目');
  await preview.getByRole('button', { name: '查看完整日视图 →', exact: true }).click();
  await expect(preview).not.toBeVisible(); await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
  for (const view of ['周', '日', '月']) {
    await page.getByRole('button', { name: view, exact: true }).click(); await expect(page.locator('.calendar-host')).toBeVisible();
    await expect(page.locator('.fc-event[data-block-id="' + ids.background + '"]')).toBeVisible();
    await expect(page.locator('.fc-bg-event')).toHaveCount(0);
  }
  await expect(event(ids.background)).toBeVisible();
  expect(await raw(page)).toEqual(before); // Includes physical metadata, revisions, times and backup rows.
});

test('P2.2 月格本次状态跨页和离线同步，v3导出替换恢复保留时间/父状态/背景/旧备份', async ({ page, context }) => {
  test.setTimeout(90000); await seed(page);
  const before = await raw(page), original = snapshot(before);
  const other = await context.newPage(); await other.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await other.goto('/');
  const event = (target: Page, id: string) => target.locator(`.fc-daygrid-event[data-block-id="${id}"]`);
  await expect(event(other, ids.second)).not.toHaveClass(/completed-event/);
  await event(page, ids.second).click();
  const editor = page.getByRole('dialog', { name: '编辑任务安排', exact: true });
  await editor.getByRole('button', { name: '本次完成', exact: true }).click();
  await expect(event(other, ids.second)).toHaveClass(/completed-event/);
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  let current = snapshot(await raw(page));
  expect(current.tasks).toEqual(original.tasks); expect(current.scheduleBlocks.find((block) => block.id === ids.first)).toEqual(original.scheduleBlocks.find((block) => block.id === ids.first));
  expect(current.scheduleBlocks.find((block) => block.id === ids.second)).toMatchObject({ executionStatus: 'completed', revision: 8, startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); await context.setOffline(true); await page.reload();
  await expect(event(page, ids.second)).toHaveClass(/completed-event/); await event(page, ids.second).click();
  await editor.getByRole('button', { name: '撤销本次完成', exact: true }).click(); await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(event(other, ids.second)).not.toHaveClass(/completed-event/); await page.reload();
  await expect(event(page, ids.first)).toHaveClass(/completed-event/); await expect(event(page, ids.second)).not.toHaveClass(/completed-event/);
  await context.setOffline(false); await other.close(); current = snapshot(await raw(page));
  expect(current.tasks).toEqual(original.tasks);
  expect(current.scheduleBlocks.filter((block) => block.id !== ids.second)).toEqual(original.scheduleBlocks.filter((block) => block.id !== ids.second));
  expect(current.scheduleBlocks.find((block) => block.id === ids.second)).toMatchObject({ executionStatus: 'pending', revision: 9,
    startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z' });
  expect((await raw(page)).tables.backups).toEqual(before.tables.backups);
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
  const downloadPromise = page.waitForEvent('download'); await settings.getByRole('button', { name: '导出完整 JSON', exact: true }).click();
  const path = await (await downloadPromise).path(); if (!path) throw new Error('没有导出文件');
  const json = await readFile(path, 'utf8'); expect(JSON.parse(json)).toEqual(current);
  await settings.getByLabel('选择导入文件').setInputFiles({ name: 'preserved-v3.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(settings.getByText('导入预览 · schemaVersion 3', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '继续替换导入…', exact: true }).click(); await page.getByRole('button', { name: '确认备份并替换', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认替换全部本地数据？', exact: true })).not.toBeVisible();
  expect(snapshot(await raw(page))).toEqual(current);
  expect((await raw(page)).tables.backups).toEqual(expect.arrayContaining(before.tables.backups));
});

test('P2.2 仅一个全局设置入口，低高度/手机浅深色真实滚轮和四角截图，纯浏览不写数据', async ({ page }) => {
  test.setTimeout(90000); await mkdir('docs/evidence/phase4/regression/regression', { recursive: true });
  await seed(page); const before = await raw(page);
  await expect(page.getByRole('button', { name: '设置与数据', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '管理与设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '设置与数据备份', exact: true })).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await page.getByRole('button', { name: theme === 'dark' ? '切换深色模式' : '切换浅色模式', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    }
    const themeState = await raw(page);
    for (const viewport of [{ width: 1440, height: 620 }, { width: 768, height: 620 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: viewport.width > 700 ? '月' : '日', exact: true }).click();
      await page.getByRole('button', { name: '设置与数据', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '设置与数据', exact: true });
      await expect(settings.getByRole('button', { name: '导出完整 JSON', exact: true })).toBeAttached();
      const bounds = await settings.boundingBox(); expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      const dialogMetrics = await settings.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        overflows: [...element.querySelectorAll('*')].filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1).map((child) => ({
          tag: child.tagName, class: child.className, type: child.getAttribute('type'), width: child.getBoundingClientRect().width,
          right: child.getBoundingClientRect().right, parentRight: element.getBoundingClientRect().right,
        })) }));
      expect(dialogMetrics.scrollWidth, JSON.stringify(dialogMetrics)).toBeLessThanOrEqual(dialogMetrics.clientWidth + 1);
      const body = settings.locator('.settings-body');
      expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
      const bodyBox = await body.boundingBox(); if (!bodyBox) throw new Error('设置滚动内容不可见');
      const scrollTop = await body.evaluate((element) => element.scrollTop);
      await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + Math.min(80, bodyBox.height / 2)); await page.mouse.wheel(0, 650);
      await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollTop);
      await settings.getByRole('navigation', { name: '设置分组', exact: true }).getByRole('button', { name: '数据备份与恢复', exact: true }).focus();
      await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
      await expect(settings.getByRole('button', { name: '导出完整 JSON', exact: true })).toBeFocused();
      await body.evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: `docs/evidence/phase4/regression/regression/after-settings-${viewport.width}-${theme}.png`, fullPage: true });
      await settings.getByRole('button', { name: '关闭', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const radii = await page.locator('.calendar-frame').evaluate((element) => {
        const style = getComputedStyle(element); return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(parseFloat);
      });
      expect(radii.every((radius) => radius >= 10)).toBe(true); expect(new Set(radii).size).toBe(1);
      await page.screenshot({ path: `docs/evidence/phase4/regression/regression/after-layout-${viewport.width}-${theme}.png`, fullPage: true });
      expect(await raw(page)).toEqual(themeState);
    }
  }
  const after = await raw(page);
  for (const [name, rows] of Object.entries(before.tables)) if (name !== 'metadata') expect(after.tables[name]).toEqual(rows);
});
