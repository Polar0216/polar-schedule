import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataSchema as legacySchema, type ScheduleData as LegacyData } from '../domain/legacyV1';
import { INBOX_ID, migrateData, parseImport, type BlockInput, type TaskInput } from '../domain/schema';
import { readRecoveryData, ScheduleDatabase, ScheduleRepository } from './database';

const names = new Set<string>();
const connections = new Set<Dexie>();
const ids = {
  list: '10000000-0000-4000-8000-000000000001', task: '10000000-0000-4000-8000-000000000002',
  doneTask: '10000000-0000-4000-8000-000000000003', linked: '10000000-0000-4000-8000-000000000004',
  event: '10000000-0000-4000-8000-000000000005', allDay: '10000000-0000-4000-8000-000000000006',
  removed: '10000000-0000-4000-8000-000000000007',
};
const timestamp = '2026-09-01T01:02:03.000Z';
const meta = { revision: 7, createdAt: timestamp, updatedAt: '2026-10-01T04:05:06.000Z' };
const timeRange = { allDay: false as const, startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:35:00.000Z', timeZone: 'Asia/Shanghai' };
const taskInput = (patch: Partial<TaskInput> = {}): TaskInput => ({ title: '实验报告', description: '保留内容', listId: INBOX_ID,
  status: 'in_progress', priority: 'high', dueDate: '2026-10-23', ...patch });
const eventInput = (patch: Partial<Extract<BlockInput, { type: 'event'; allDay: false }>> = {}): BlockInput => ({ ...timeRange,
  type: 'event', title: '理论力学', description: '原描述', display: 'background', color: '#123456', ...patch });

function legacyFixture(): LegacyData {
  return legacySchema.parse({
    schemaVersion: 1,
    lists: [
      { ...meta, id: INBOX_ID, title: '收集箱', color: '#7774d5', icon: 'inbox', order: 0, archived: false },
      { ...meta, id: ids.list, title: '课程与作业', color: '#abcdef', icon: 'book', order: 4, archived: false },
    ],
    tasks: [
      { ...meta, id: ids.task, title: '已有报告', description: 'Phase 1 真正内容\n第二行', listId: ids.list,
        status: 'in_progress', priority: 'high', dueDate: '2026-10-23', order: 3 },
      { ...meta, id: ids.doneTask, title: '已完成任务', description: '', listId: INBOX_ID,
        status: 'done', completedAt: '2026-10-01T01:00:00.000Z', priority: 'none', order: 5 },
    ],
    scheduleBlocks: [
      { ...meta, id: ids.linked, type: 'task', taskId: ids.task, color: '#654321', ...timeRange },
      { ...meta, id: ids.event, type: 'event', title: '已有课程', description: '说明不能丢', color: '#fedcba', ...timeRange },
      { ...meta, id: ids.allDay, type: 'event', title: '跨年假期', description: '', allDay: true,
        startDate: '2026-12-31', endDate: '2027-01-02', timeZone: 'Asia/Shanghai' },
    ],
    settings: { theme: 'dark', defaultView: 'day', timeZone: 'Asia/Shanghai', hiddenListIds: [ids.list],
      sidebarCollapsed: true, tasksCollapsed: false },
    tombstones: [{ entityType: 'scheduleBlock', id: ids.removed, deletedAt: '2026-10-01T02:00:00.000Z' }],
    updatedAt: '2026-10-10T12:13:14.000Z',
  });
}

function testName(): string {
  const name = `phase2-storage-test-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

function current(name = testName()): { db: ScheduleDatabase; repo: ScheduleRepository } {
  const db = new ScheduleDatabase(name); connections.add(db);
  return { db, repo: new ScheduleRepository(db) };
}

async function initialized() {
  const value = current(); await value.repo.initialize(); return value;
}

async function seedLegacy(data: LegacyData, name = testName()): Promise<string> {
  const db = new Dexie(name); connections.add(db);
  db.version(1).stores({ lists: 'id, order, archived', tasks: 'id, listId, status, order, dueDate',
    scheduleBlocks: 'id, type, taskId', metadata: 'key', tombstones: '[entityType+id], deletedAt', backups: 'id, createdAt' });
  await db.transaction('rw', db.tables, async () => {
    await Promise.all([
      db.table('lists').bulkPut(data.lists), db.table('tasks').bulkPut(data.tasks),
      db.table('scheduleBlocks').bulkPut(data.scheduleBlocks), db.table('tombstones').bulkPut(data.tombstones),
      db.table('metadata').put({ key: 'state', schemaVersion: 1, settings: data.settings, updatedAt: data.updatedAt }),
      db.table('backups').put({ id: 'existing-phase1-backup', createdAt: timestamp, data }),
    ]);
  });
  db.close(); return name;
}

async function rawDatabase(name: string): Promise<{ version: number; tables: Record<string, unknown[]> }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    const stores = [...db.objectStoreNames];
    const tx = db.transaction(stores, 'readonly');
    const rows = await Promise.all(stores.map((store) => new Promise<[string, unknown[]]>((resolve, reject) => {
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => resolve([store, request.result as unknown[]]); request.onerror = () => reject(request.error);
    })));
    return { version: db.version, tables: Object.fromEntries(rows) };
  } finally { db.close(); }
}

afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const db of connections) db.close();
  for (const name of names) await Dexie.delete(name);
  connections.clear(); names.clear();
});

describe('真实 Dexie v1 -> v2 迁移与失败保护（随机隔离数据库）', () => {
  it('正式升级完整保留Phase1内容和元数据，新增默认字段且重开幂等', async () => {
    const original = legacyFixture();
    const name = await seedLegacy(original);
    const first = current(name); await first.repo.initialize();
    const migrated = await first.repo.snapshot();
    expect(migrated).toEqual(migrateData(original));
    expect(migrated.tasks.every((task) => task.subtasks.length === 0 && task.tagIds.length === 0)).toBe(true);
    expect(migrated.scheduleBlocks.filter((block) => block.type === 'event').every((block) => block.display === 'normal' && !block.recurrence)).toBe(true);
    expect(migrated.settings).toMatchObject(original.settings);
    expect(migrated.tags).toEqual([]); expect(migrated.exceptions).toEqual([]);
    expect(await first.db.backups.get('existing-phase1-backup')).toEqual({ id: 'existing-phase1-backup', createdAt: timestamp, data: original });
    const rawBackup = await first.db.backups.get('before-schema-v2');
    expect(rawBackup).toMatchObject({ id: 'before-schema-v2', data: original, kind: 'migration' });
    expect(parseImport(JSON.stringify(rawBackup!.data))).toEqual(migrated);
    first.db.close();
    const second = current(name); await second.repo.initialize(); await second.repo.initialize();
    expect(await second.repo.snapshot()).toEqual(migrated);
    expect(await second.db.backups.get('before-schema-v2')).toEqual(rawBackup);
    expect(await second.db.backups.count()).toBe(3); // Existing backup plus protected v1->v2 and v2->v3 snapshots.
  });

  it('损坏旧引用导致升级失败，版本变更事务回滚且原生恢复可读取旧数据', async () => {
    const damaged = legacyFixture(); damaged.tasks[0].listId = crypto.randomUUID();
    const name = await seedLegacy(damaged);
    const before = await rawDatabase(name);
    const upgraded = current(name);
    await expect(upgraded.repo.initialize()).rejects.toThrow('任务引用不存在的清单');
    upgraded.db.close();
    const after = await rawDatabase(name);
    expect(after).toEqual(before);
    expect(after.version).toBe(10); // Dexie v1 maps to native IndexedDB version 10.
    expect(after.tables).not.toHaveProperty('tags');
    expect(after.tables.backups).toHaveLength(1);
    const recovery = await readRecoveryData(name) as { recoveryFormat: number; databaseName: string; tables: Record<string, unknown[]> };
    expect(recovery).toMatchObject({ recoveryFormat: 1, databaseName: name });
    for (const table of ['lists', 'tasks', 'scheduleBlocks', 'metadata', 'tombstones', 'backups']) {
      expect(recovery.tables[table]).toEqual(before.tables[table]);
    }
    expect(recovery.tables.backups).toEqual([expect.objectContaining({ id: 'existing-phase1-backup', data: damaged })]);
  });

  it('后续导入备份轮换不删除迁移原始备份', async () => {
    const original = legacyFixture(), name = await seedLegacy(original);
    const { db, repo } = current(name); await repo.initialize();
    const snapshot = await repo.snapshot();
    for (let index = 0; index < 5; index++) await repo.replaceData(snapshot);
    expect((await db.backups.get('before-schema-v2'))?.data).toEqual(original);
    expect(await db.backups.filter((backup) => backup.kind === 'import').count()).toBe(3);
    expect(await db.backups.filter((backup) => backup.kind === 'migration').count()).toBe(2);
  });
});

describe('v1 JSON兼容与v2完整备份', () => {
  it('v1 JSON经校验迁移后替换导入，原内容和设置保持一致', async () => {
    const { repo } = await initialized();
    await repo.saveTask(taskInput({ title: '导入前的内容' }));
    const original = legacyFixture(), parsed = parseImport(JSON.stringify(original));
    await repo.replaceData(parsed);
    expect(await repo.snapshot()).toEqual(migrateData(original));
    expect((await repo.latestBackup())?.tasks.map((task) => task.title)).toEqual(['导入前的内容']);
    const corrupt = structuredClone(original); corrupt.scheduleBlocks = corrupt.scheduleBlocks.map((block) => block.type === 'task' ? { ...block, taskId: crypto.randomUUID() } : block);
    expect(() => parseImport(JSON.stringify(corrupt))).toThrow('不存在的任务');
  });

  it('系列、取消/改时例外、标签、子任务和新设置在隔离库删除重建后完整往返', async () => {
    const first = await initialized();
    const tagId = await first.repo.saveTag({ title: '紧急', color: '#dc2626' });
    const subtaskId = crypto.randomUUID();
    const taskId = await first.repo.saveTask(taskInput({ tagIds: [tagId], subtasks: [
      { id: subtaskId, title: '整理数据', done: true, order: 0 },
      { id: crypto.randomUUID(), title: '提交报告', done: false, order: 1 },
    ] }));
    await first.repo.saveBlock({ ...timeRange, type: 'task', taskId });
    const seriesId = await first.repo.saveBlock(eventInput({ recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3],
      startDate: '2026-10-19', localTime: '08:00', durationMinutes: 95, until: '2027-01-31' } }));
    await first.repo.deleteOccurrence(seriesId, '2026-11-02');
    await first.repo.saveOccurrence(seriesId, '2026-11-04', eventInput({ title: '单次补课', display: 'normal',
      startAt: '2026-11-05T02:00:00.000Z', endAt: '2026-11-05T03:00:00.000Z' }));
    await first.repo.updateSettings({ theme: 'dark', slotMinutes: 15, startHour: 7, endHour: 23,
      weekStartsOn: 0, density: 'compact', showBackground: false, defaultDurationMinutes: 90 });
    const exported = await first.repo.snapshot();
    const parsed = parseImport(JSON.stringify(exported));
    expect(parsed).toEqual(exported);
    const name = first.db.name; first.db.close(); await Dexie.delete(name);
    const rebuilt = current(name); await rebuilt.repo.initialize(); await rebuilt.repo.replaceData(parsed);
    expect(await rebuilt.repo.snapshot()).toEqual(exported);
    expect((await rebuilt.repo.snapshot()).exceptions).toHaveLength(2);
  });

  it('子任务完成不自动完成父任务，标签重命名保留引用，删除标签安全去关联', async () => {
    const { repo } = await initialized();
    const tagId = await repo.saveTag({ title: '旧标签', color: '#123456' });
    const taskId = await repo.saveTask(taskInput({ tagIds: [tagId], subtasks: [{ id: crypto.randomUUID(), title: '全部完成的子项', done: true, order: 0 }] }));
    await repo.saveTag({ title: '新标签', color: '#abcdef' }, tagId);
    let data = await repo.snapshot();
    expect(data.tasks[0]).toMatchObject({ id: taskId, status: 'in_progress', tagIds: [tagId] });
    expect(data.tags[0]).toMatchObject({ id: tagId, title: '新标签', color: '#abcdef', revision: 2 });
    await repo.deleteTag(tagId); data = await repo.snapshot();
    expect(data.tags).toEqual([]); expect(data.tasks[0].tagIds).toEqual([]); expect(data.tasks[0].subtasks).toHaveLength(1);
  });
});

describe('删除撤销的事务、关联与边界', () => {
  it('任务及其两段安排一并恢复且物理墓碑清除，ID稳定revision前进', async () => {
    const { db, repo } = await initialized();
    const tagId = await repo.saveTag({ title: '作业', color: '#123456' });
    const taskId = await repo.saveTask(taskInput({ tagIds: [tagId], subtasks: [{ id: crypto.randomUUID(), title: '子任务', done: false, order: 0 }] }));
    await repo.saveBlock({ ...timeRange, type: 'task', taskId });
    await repo.saveBlock({ ...timeRange, type: 'task', taskId, startAt: '2026-10-20T00:00:00.000Z', endAt: '2026-10-20T01:00:00.000Z' });
    const original = await repo.snapshot();
    await repo.deleteTask(taskId, true);
    expect(await db.tasks.count()).toBe(0); expect(await db.scheduleBlocks.count()).toBe(0); expect(await db.tombstones.count()).toBe(3);
    const undo = await repo.latestUndo(); expect(undo?.task?.id).toBe(taskId);
    await repo.undoLast(undo!.id);
    const restored = await repo.snapshot();
    expect(restored.tasks[0]).toMatchObject({ ...original.tasks[0], revision: original.tasks[0].revision + 1, updatedAt: expect.any(String) });
    expect(restored.scheduleBlocks.map((block) => block.id).sort()).toEqual(original.scheduleBlocks.map((block) => block.id).sort());
    for (const block of restored.scheduleBlocks) {
      expect(block).toMatchObject({ ...original.scheduleBlocks.find((item) => item.id === block.id)!, revision: 2, updatedAt: expect.any(String) });
    }
    expect(restored.tombstones).toEqual([]); expect(await db.tombstones.toArray()).toEqual([]); expect(await db.undo.count()).toBe(0);
  });

  it('删除重复系列后撤销恢复系列及其全部例外且清除相应墓碑', async () => {
    const { db, repo } = await initialized();
    const seriesId = await repo.saveBlock(eventInput({ recurrence: { frequency: 'weekly', interval: 1, weekdays: [1],
      startDate: '2026-10-19', localTime: '08:00', durationMinutes: 95, count: 10 } }));
    await repo.deleteOccurrence(seriesId, '2026-10-26');
    await repo.saveOccurrence(seriesId, '2026-11-02', eventInput({ title: '补课' }));
    const original = await repo.snapshot();
    await repo.deleteBlock(seriesId);
    expect(await db.scheduleBlocks.count()).toBe(0); expect(await db.exceptions.count()).toBe(0); expect(await db.tombstones.count()).toBe(3);
    const undo = await repo.latestUndo(); await repo.undoLast(undo!.id);
    const restored = await repo.snapshot();
    expect(restored.scheduleBlocks[0]).toMatchObject({ ...original.scheduleBlocks[0], revision: 2, updatedAt: expect.any(String) });
    expect(restored.exceptions.map((item) => item.id).sort()).toEqual(original.exceptions.map((item) => item.id).sort());
    expect(restored.exceptions.every((item) => item.revision === 2)).toBe(true);
    expect(await db.tombstones.toArray()).toEqual([]);
  });

  it('原清单/标签随后被删时任务撤销回收集箱且不恢复悬空标签', async () => {
    const { repo } = await initialized();
    const listId = await repo.saveList({ title: '临时清单', color: '#123456', icon: 'book' });
    const tagId = await repo.saveTag({ title: '临时标签', color: '#123456' });
    const taskId = await repo.saveTask(taskInput({ listId, tagIds: [tagId] }));
    await repo.deleteTask(taskId); const undo = await repo.latestUndo();
    await repo.deleteList(listId); await repo.deleteTag(tagId); await repo.undoLast(undo!.id);
    const data = await repo.snapshot();
    expect(data.tasks[0]).toMatchObject({ id: taskId, listId: INBOX_ID, tagIds: [] });
    expect(data.tombstones.map((item) => item.entityType).sort()).toEqual(['list', 'tag']);
  });

  it('30秒时刻过期且不触碰已经删除的状态', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
    const { db, repo } = await initialized();
    const taskId = await repo.saveTask(taskInput()); await repo.deleteTask(taskId);
    const undo = (await repo.latestUndo())!;
    expect(Date.parse(undo.expiresAt) - Date.parse(undo.createdAt)).toBe(30_000);
    vi.setSystemTime(new Date('2026-10-19T12:00:29.999Z')); expect(await repo.latestUndo()).not.toBeNull();
    vi.setSystemTime(new Date('2026-10-19T12:00:30.000Z')); expect(await repo.latestUndo()).toBeNull();
    await expect(repo.undoLast(undo.id)).rejects.toThrow('过期');
    expect(await db.tasks.count()).toBe(0); expect(await db.tombstones.count()).toBe(1);
  });

  it('任务ID已存在时拒绝覆盖恢复且现存内容与撤销记录保持', async () => {
    const { db, repo } = await initialized();
    const taskId = await repo.saveTask(taskInput()); const original = (await repo.snapshot()).tasks[0];
    await repo.deleteTask(taskId); const undo = (await repo.latestUndo())!;
    await db.transaction('rw', db.tasks, db.tombstones, async () => {
      await db.tasks.put({ ...original, title: '同ID的新内容', revision: 99 }); await db.tombstones.delete(['task', taskId]);
    });
    const before = await repo.snapshot();
    await expect(repo.undoLast(undo.id)).rejects.toThrow('不能覆盖恢复');
    expect(await repo.snapshot()).toEqual(before); expect(await db.undo.get(undo.id)).toBeDefined();
  });

  it('关联块ID冲突时整个撤销回滚，不留下已先恢复的父任务', async () => {
    const { db, repo } = await initialized();
    const taskId = await repo.saveTask(taskInput()); const blockId = await repo.saveBlock({ ...timeRange, type: 'task', taskId });
    const originalBlock = (await repo.snapshot()).scheduleBlocks[0];
    await repo.deleteTask(taskId, true); const undo = (await repo.latestUndo())!;
    await db.transaction('rw', db.scheduleBlocks, db.tombstones, async () => {
      await db.scheduleBlocks.put({ ...timeRange, id: blockId, revision: 99, createdAt: originalBlock.createdAt, updatedAt: originalBlock.updatedAt,
        type: 'event', title: '占用原ID的新安排', description: '', display: 'normal' });
      await db.tombstones.delete(['scheduleBlock', blockId]);
    });
    const before = await repo.snapshot();
    await expect(repo.undoLast(undo.id)).rejects.toThrow('安排已存在');
    expect(await repo.snapshot()).toEqual(before); expect(await db.tasks.count()).toBe(0); expect(await db.undo.get(undo.id)).toBeDefined();
  });

  it('替换导入清除旧撤销边界，旧任务无法从撤销潜入新快照', async () => {
    const { db, repo } = await initialized();
    const empty = await repo.snapshot(), taskId = await repo.saveTask(taskInput());
    await repo.deleteTask(taskId); const oldUndo = (await repo.latestUndo())!;
    await repo.replaceData(empty);
    expect(await repo.latestUndo()).toBeNull(); expect(await db.undo.count()).toBe(0);
    await expect(repo.undoLast(oldUndo.id)).rejects.toThrow('过期');
    expect(await repo.snapshot()).toEqual(empty);
  });
});
