import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataSchema as legacyV2Schema, type ScheduleData as LegacyV2Data } from '../domain/legacyV2';
import { blockSchema, initialData, INBOX_ID, migrateData, parseImport, type BlockInput } from '../domain/schema';
import { readRecoveryData, ScheduleDatabase, ScheduleRepository } from './database';

const connections = new Set<Dexie>(), names = new Set<string>();
const meta = { revision: 4, createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-10-01T02:00:00.000Z' };
const ID = {
  task: '20000000-0000-4000-8000-000000000001', doneTask: '20000000-0000-4000-8000-000000000002',
  block: '20000000-0000-4000-8000-000000000003', second: '20000000-0000-4000-8000-000000000004',
  doneBlock: '20000000-0000-4000-8000-000000000005', series: '20000000-0000-4000-8000-000000000006',
  tag: '20000000-0000-4000-8000-000000000007', subtask: '20000000-0000-4000-8000-000000000008',
  exception: '20000000-0000-4000-8000-000000000009', removed: '20000000-0000-4000-8000-000000000010',
};
const range = { allDay: false as const, timeZone: 'Asia/Shanghai', startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:00:00.000Z' };
const taskInput = { title: '分两次写报告', description: '同一父任务', status: 'todo' as const, priority: 'high' as const, listId: INBOX_ID, dueDate: '2026-10-23' };
const taskBlock = (taskId: string): Extract<BlockInput, { type: 'task'; allDay: false }> => ({ ...range, type: 'task', taskId });

function legacyV2Fixture(): LegacyV2Data {
  const seed = initialData();
  return legacyV2Schema.parse({ ...seed, schemaVersion: 2, updatedAt: meta.updatedAt,
    tasks: [
      { ...meta, id: ID.task, ...taskInput, order: 2, tagIds: [ID.tag], subtasks: [{ id: ID.subtask, title: '原子任务', done: true, order: 0 }] },
      { ...meta, id: ID.doneTask, ...taskInput, title: '原已完成父任务', status: 'done', completedAt: meta.updatedAt, order: 3, tagIds: [], subtasks: [] },
    ],
    tags: [{ ...meta, id: ID.tag, title: '原标签', color: '#123456' }],
    scheduleBlocks: [
      { ...meta, id: ID.block, ...range, type: 'task', taskId: ID.task },
      { ...meta, id: ID.second, ...range, startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z', type: 'task', taskId: ID.task },
      { ...meta, id: ID.doneBlock, ...range, type: 'task', taskId: ID.doneTask },
      { ...meta, id: ID.series, ...range, type: 'event', title: '原重复课程', description: '保留系列', display: 'background', color: '#abcdef',
        recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3], startDate: '2026-10-19', localTime: '08:00', durationMinutes: 60, count: 12 } },
    ],
    exceptions: [{ ...meta, id: ID.exception, seriesId: ID.series, occurrenceDate: '2026-11-02', cancelled: true }],
    tombstones: [{ entityType: 'scheduleBlock', id: ID.removed, deletedAt: meta.updatedAt }],
    settings: { ...seed.settings, theme: 'dark', density: 'compact', slotMinutes: 15, startHour: 7, endHour: 23 },
  });
}

function current(name?: string) {
  const db = new ScheduleDatabase(name ?? `phase2-1-storage-test-${crypto.randomUUID()}`);
  connections.add(db); names.add(db.name);
  return { db, repo: new ScheduleRepository(db) };
}

async function initialized() { const value = current(); await value.repo.initialize(); return value; }

async function seedV2(data: LegacyV2Data, includeUndo = false): Promise<string> {
  const name = `phase2-1-storage-test-${crypto.randomUUID()}`, db = new Dexie(name);
  connections.add(db); names.add(name);
  db.version(1).stores({ lists: 'id, order, archived', tasks: 'id, listId, status, order, dueDate', scheduleBlocks: 'id, type, taskId',
    metadata: 'key', tombstones: '[entityType+id], deletedAt', backups: 'id, createdAt' });
  db.version(2).stores({ tags: 'id, title', exceptions: 'id, seriesId, &[seriesId+occurrenceDate]', undo: 'id, createdAt, expiresAt' });
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(['lists', 'tasks', 'scheduleBlocks', 'tombstones', 'tags', 'exceptions'].map((key) => db.table(key).bulkPut(data[key as keyof LegacyV2Data] as unknown[])));
    await db.table('metadata').put({ key: 'state', schemaVersion: 2, settings: data.settings, updatedAt: data.updatedAt });
    await db.table('backups').put({ id: 'existing-v2-json', createdAt: meta.createdAt, data, kind: 'import' });
    if (includeUndo) await db.table('undo').put({ id: 'undo-before-upgrade', label: '删除安排', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(), blocks: [{ ...meta, id: ID.removed, ...range, type: 'task', taskId: ID.task }], exceptions: [] });
  });
  db.close(); return name;
}

async function raw(name: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    const stores = [...db.objectStoreNames], tx = db.transaction(stores, 'readonly');
    const rows = await Promise.all(stores.map((key) => new Promise<[string, unknown[]]>((resolve, reject) => {
      const request = tx.objectStore(key).getAll(); request.onsuccess = () => resolve([key, request.result as unknown[]]); request.onerror = () => reject(request.error);
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

describe('v2 -> v3 正式迁移与旧版JSON校验', () => {
  it('旧块一律pending，父任务已完成也不推断执行完成；原内容/备份/undo均保留且重开幂等', async () => {
    const original = legacyV2Fixture(), name = await seedV2(original, true);
    const before = await raw(name), first = current(name); await first.repo.initialize();
    const snapshot = await first.repo.snapshot();
    expect(snapshot).toEqual(migrateData(original)); expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.scheduleBlocks.filter((block) => block.type === 'task').every((block) => block.executionStatus === 'pending' && !block.completedAt)).toBe(true);
    expect(snapshot.tasks).toEqual(original.tasks); expect(snapshot.tags).toEqual(original.tags); expect(snapshot.exceptions).toEqual(original.exceptions);
    expect(snapshot.settings).toEqual(original.settings);
    expect((await first.db.backups.get('existing-v2-json'))?.data).toEqual(original);
    const migrationBackup = await first.db.backups.get('before-schema-v3'); expect(migrationBackup?.data).toEqual(original);
    expect(parseImport(JSON.stringify(migrationBackup!.data))).toEqual(snapshot);
    expect((await first.db.undo.get('undo-before-upgrade'))?.blocks[0]).toMatchObject({ id: ID.removed, executionStatus: 'pending', revision: 4 });
    const rawAfter = await raw(name); expect(rawAfter.version).toBe(40); expect(before.version).toBe(20);
    first.db.close(); const second = current(name); await second.repo.initialize(); await second.repo.initialize();
    expect(await second.repo.snapshot()).toEqual(snapshot); expect(await second.db.backups.get('before-schema-v3')).toEqual(migrationBackup);
    await second.repo.undoLast('undo-before-upgrade');
    expect((await second.repo.snapshot()).scheduleBlocks.find((block) => block.id === ID.removed)).toMatchObject({ executionStatus: 'pending', revision: 5 });
    expect(await second.db.tombstones.get(['scheduleBlock', ID.removed])).toBeUndefined();
  });

  it('损坏v2引用升级失败时版本和所有原始表保持不变，旧备份仍可导出', async () => {
    const damaged = legacyV2Fixture(); damaged.tasks[0].tagIds = [crypto.randomUUID()];
    const name = await seedV2(damaged), before = await raw(name), next = current(name);
    await expect(next.repo.initialize()).rejects.toThrow('不存在的标签'); next.db.close();
    expect(await raw(name)).toEqual(before);
    const recovery = await readRecoveryData(name) as { tables: Record<string, unknown[]> };
    expect(recovery.tables.backups).toEqual(before.tables.backups); expect(recovery.tables.tasks).toEqual(before.tables.tasks);
  });

  it('冻结v2验证器拒绝偷渡v3执行字段；v2 JSON迁移不改变源对象', () => {
    const old = legacyV2Fixture(), before = structuredClone(old), imported = parseImport(JSON.stringify(old));
    expect(imported.schemaVersion).toBe(3); expect(old).toEqual(before);
    const contaminated = structuredClone(old);
    Object.assign(contaminated.scheduleBlocks[0], { executionStatus: 'completed', completedAt: meta.updatedAt });
    expect(() => parseImport(JSON.stringify(contaminated))).toThrow('无法导入');
  });
});

describe('每次安排独立执行状态', () => {
  it('每段与父任务互不覆写，完成/撤销时间和revision正确，重复设定幂等', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T08:00:00.000Z'));
    const { repo } = await initialized(), taskId = await repo.saveTask(taskInput);
    const one = await repo.saveBlock(taskBlock(taskId)), two = await repo.saveBlock(taskBlock(taskId));
    const before = await repo.snapshot(); vi.setSystemTime(new Date('2026-10-20T08:00:01.000Z'));
    await repo.setBlockCompleted(one, true); let data = await repo.snapshot();
    const completed = data.scheduleBlocks.find((block) => block.id === one)!;
    expect(completed).toMatchObject({ executionStatus: 'completed', completedAt: '2026-10-20T08:00:01.000Z', revision: 2, updatedAt: '2026-10-20T08:00:01.000Z' });
    expect(data.tasks).toEqual(before.tasks); expect(data.scheduleBlocks.find((block) => block.id === two)).toEqual(before.scheduleBlocks.find((block) => block.id === two));
    vi.setSystemTime(new Date('2026-10-20T08:00:02.000Z')); await repo.setBlockCompleted(one, true);
    expect((await repo.snapshot()).scheduleBlocks.find((block) => block.id === one)).toEqual(completed);
    await repo.setTaskStatus(taskId, 'done'); data = await repo.snapshot();
    expect(data.scheduleBlocks.find((block) => block.id === one)).toEqual(completed);
    expect(data.scheduleBlocks.find((block) => block.id === two)).toMatchObject({ executionStatus: 'pending' });
    vi.setSystemTime(new Date('2026-10-20T08:00:03.000Z')); await repo.setBlockCompleted(one, false); data = await repo.snapshot();
    expect(data.tasks[0].status).toBe('done');
    expect(data.scheduleBlocks.find((block) => block.id === one)).toMatchObject({ executionStatus: 'pending', completedAt: undefined, revision: 3, updatedAt: '2026-10-20T08:00:03.000Z' });
  });

  it('拖动、拉伸和全天切换省略状态时保留完成记录，显式pending才清除', async () => {
    const { repo } = await initialized(), taskId = await repo.saveTask(taskInput), id = await repo.saveBlock(taskBlock(taskId));
    await repo.setBlockCompleted(id, true); const completed = (await repo.snapshot()).scheduleBlocks[0];
    if (completed.type !== 'task') throw new Error('应为任务安排');
    await repo.saveBlock({ ...range, type: 'task', taskId, startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T03:30:00.000Z' }, id);
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ executionStatus: 'completed', completedAt: completed.completedAt, revision: 3 });
    await repo.saveBlock({ type: 'task', taskId, allDay: true, timeZone: 'Asia/Shanghai', startDate: '2026-10-21', endDate: '2026-10-23' }, id);
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ allDay: true, executionStatus: 'completed', completedAt: completed.completedAt });
    await repo.saveBlock({ ...taskBlock(taskId), executionStatus: 'pending' }, id);
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ allDay: false, executionStatus: 'pending', completedAt: undefined });
  });

  it('允许明确创建已完成记录；非法状态/完成时间和event状态不会写入', async () => {
    const { db, repo } = await initialized(), taskId = await repo.saveTask(taskInput);
    const id = await repo.saveBlock({ ...taskBlock(taskId), executionStatus: 'completed', completedAt: meta.updatedAt });
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ id, executionStatus: 'completed', completedAt: meta.updatedAt });
    await expect(repo.saveBlock({ ...taskBlock(taskId), executionStatus: 'pending', completedAt: meta.updatedAt })).rejects.toThrow();
    await expect(repo.setBlockCompleted(crypto.randomUUID(), true)).rejects.toThrow('已被删除');
    const event = await repo.saveBlock({ ...range, type: 'event', title: '会议', description: '' });
    await expect(repo.setBlockCompleted(event, true)).rejects.toThrow('只有任务安排');
    const base = (await repo.snapshot()).scheduleBlocks.find((block) => block.id === event)!;
    expect(() => blockSchema.parse({ ...base, executionStatus: 'pending' })).toThrow();
    expect(await db.scheduleBlocks.count()).toBe(2);
  });

  it('本次完成在块删除/任务级联删除撤销、数据库重开和最新JSON往返均保留', async () => {
    const { db, repo } = await initialized(), taskId = await repo.saveTask(taskInput), id = await repo.saveBlock(taskBlock(taskId));
    await repo.setBlockCompleted(id, true); const original = (await repo.snapshot()).scheduleBlocks[0];
    if (original.type !== 'task') throw new Error('应为任务安排');
    await repo.deleteBlock(id); await repo.undoLast((await repo.latestUndo())!.id);
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ executionStatus: 'completed', completedAt: original.completedAt });
    await repo.deleteTask(taskId, true); await repo.undoLast((await repo.latestUndo())!.id);
    const exported = await repo.snapshot(); expect(exported.scheduleBlocks[0]).toMatchObject({ executionStatus: 'completed', completedAt: original.completedAt });
    expect(await db.tombstones.toArray()).toEqual([]);
    db.close(); await db.open(); expect(await repo.snapshot()).toEqual(exported);
    const imported = parseImport(JSON.stringify(exported)); await repo.replaceData(initialData()); await repo.replaceData(imported);
    expect(await repo.snapshot()).toEqual(exported);
  });

  it('两个连接分别完成不同安排，事务序列化不丢独立状态', async () => {
    const first = await initialized(), taskId = await first.repo.saveTask(taskInput);
    const one = await first.repo.saveBlock(taskBlock(taskId)), two = await first.repo.saveBlock(taskBlock(taskId));
    const second = current(first.db.name);
    await Promise.all([first.repo.setBlockCompleted(one, true), second.repo.setBlockCompleted(two, true)]);
    const data = await first.repo.snapshot();
    expect(data.scheduleBlocks.every((block) => block.type === 'task' && block.executionStatus === 'completed')).toBe(true);
    expect(data.tasks[0].status).toBe('todo');
  });
});
