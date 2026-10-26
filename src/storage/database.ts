import Dexie, { type Table, type Transaction } from 'dexie';
import {
  blockSchema, dataSchema, initialData, INBOX_ID, migrateData, migrateV1ToV2, taskSchema, type BlockInput, type List, type ListInput,
  type ScheduleBlock, type ScheduleData, type Settings, type Task, type TaskInput, type Tombstone,
  type Tag, type RecurrenceException,
} from '../domain/schema';
import { blockSchema as legacyV2BlockSchema } from '../domain/legacyV2';
import type { Credential, SyncLease, SyncState } from '../sync/types';
import { fingerprint, localSettings } from '../sync/snapshotCodec';
import { merge } from '../sync/merge';

interface Metadata {
  key: 'state';
  schemaVersion: 3;
  settings: Settings;
  updatedAt: string;
}
interface Backup { id: string; createdAt: string; data: unknown; kind?: 'migration' | 'import' | 'sync' }
export interface UndoEntry {
  id: string; createdAt: string; expiresAt: string; label: string;
  task?: Task; blocks: ScheduleBlock[]; exceptions: RecurrenceException[];
}

async function upgradeV2(tx: Transaction): Promise<void> {
  const root = await tx.table('metadata').get('state') as { schemaVersion: number; settings: unknown; updatedAt: string } | undefined;
  if (!root) {
    const counts = await Promise.all(['lists', 'tasks', 'scheduleBlocks', 'tombstones'].map((name) => tx.table(name).count()));
    if (counts.some(Boolean)) throw new Error('迁移停止：原数据库缺少元数据，请导出原始数据后恢复');
    return;
  }
  const [lists, tasks, scheduleBlocks, tombstones] = await Promise.all(['lists', 'tasks', 'scheduleBlocks', 'tombstones'].map((name) => tx.table(name).toArray()));
  const legacy: unknown = { schemaVersion: root.schemaVersion, lists, tasks, scheduleBlocks, tombstones, settings: root.settings, updatedAt: root.updatedAt };
  const migrated = migrateV1ToV2(legacy); // Keep the v2 intermediate state valid; v3 adds execution state separately.
  await tx.table('backups').put({ id: 'before-schema-v2', createdAt: new Date().toISOString(), data: legacy, kind: 'migration' });
  await Promise.all([
    tx.table('lists').bulkPut(migrated.lists), tx.table('tasks').bulkPut(migrated.tasks),
    tx.table('scheduleBlocks').bulkPut(migrated.scheduleBlocks),
    tx.table('metadata').put({ key: 'state', schemaVersion: 2, settings: migrated.settings, updatedAt: migrated.updatedAt }),
  ]);
}

async function upgradeV3(tx: Transaction): Promise<void> {
  const root = await tx.table('metadata').get('state') as { schemaVersion: number; settings: unknown; updatedAt: string } | undefined;
  if (!root) {
    const counts = await Promise.all(['lists', 'tasks', 'scheduleBlocks', 'tombstones', 'tags', 'exceptions', 'undo'].map((name) => tx.table(name).count()));
    if (counts.some(Boolean)) throw new Error('迁移停止：原数据库缺少元数据，请导出原始数据后恢复');
    return;
  }
  const [lists, tasks, scheduleBlocks, tombstones, tags, exceptions] = await Promise.all(
    ['lists', 'tasks', 'scheduleBlocks', 'tombstones', 'tags', 'exceptions'].map((name) => tx.table(name).toArray()),
  );
  const legacy = { schemaVersion: root.schemaVersion, lists, tasks, scheduleBlocks, tombstones, tags, exceptions, settings: root.settings, updatedAt: root.updatedAt };
  const migrated = migrateData(legacy);
  // Pending undo payloads are persisted too: preserve them and upgrade their
  // task blocks, rather than restoring an old v2 shape after the database opens.
  const undoRows = await tx.table('undo').toArray() as Array<Omit<UndoEntry, 'blocks'> & { blocks: unknown[] }>;
  const upgradedUndo = undoRows.map((entry) => ({ ...entry, blocks: entry.blocks.map((raw) => {
    const block = legacyV2BlockSchema.parse(raw);
    return block.type === 'task' ? { ...block, executionStatus: 'pending' as const } : block;
  }) }));
  const last = await tx.table('backups').orderBy('createdAt').last() as Backup | undefined;
  const backupTime = Math.max(Date.now(), last ? Date.parse(last.createdAt) + 1 : 0);
  await tx.table('backups').put({ id: 'before-schema-v3', createdAt: new Date(backupTime).toISOString(), data: legacy, kind: 'migration' });
  await Promise.all([
    tx.table('scheduleBlocks').bulkPut(migrated.scheduleBlocks), tx.table('undo').bulkPut(upgradedUndo),
    tx.table('metadata').put({ key: 'state', schemaVersion: 3, settings: migrated.settings, updatedAt: migrated.updatedAt }),
  ]);
}

export class ScheduleDatabase extends Dexie {
  lists!: Table<List, string>;
  tasks!: Table<Task, string>;
  scheduleBlocks!: Table<ScheduleBlock, string>;
  metadata!: Table<Metadata, string>;
  tombstones!: Table<Tombstone, [string, string]>;
  backups!: Table<Backup, string>;
  tags!: Table<Tag, string>;
  exceptions!: Table<RecurrenceException, string>;
  undo!: Table<UndoEntry, string>;
  syncStates!: Table<SyncState, string>;
  credentials!: Table<Credential, string>;
  syncLeases!: Table<SyncLease, string>;

  constructor(name = 'polar-schedule') {
    super(name);
    this.version(1).stores({
      lists: 'id, order, archived',
      tasks: 'id, listId, status, order, dueDate',
      scheduleBlocks: 'id, type, taskId',
      metadata: 'key',
      tombstones: '[entityType+id], deletedAt',
      backups: 'id, createdAt',
    });
    this.version(2).stores({
      tags: 'id, title', exceptions: 'id, seriesId, &[seriesId+occurrenceDate]', undo: 'id, createdAt, expiresAt',
    }).upgrade(upgradeV2);
    this.version(3).stores({ scheduleBlocks: 'id, type, taskId, executionStatus' }).upgrade(upgradeV3);
    // Additive migration only: no domain row, timestamp, backup or undo is rewritten.
    this.version(4).stores({ syncStates: 'key', credentials: 'key', syncLeases: 'key' });
  }

  get dataTables() { return [this.lists, this.tasks, this.scheduleBlocks, this.metadata, this.tombstones, this.tags, this.exceptions]; }
}

const sort = <T extends { order: number; id: string }>(items: T[]) =>
  [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const metadata = () => {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, revision: 1 };
};
const touched = <T extends { revision: number; updatedAt: string }>(entity: T): T =>
  ({ ...entity, revision: entity.revision + 1, updatedAt: new Date().toISOString() });

export class ScheduleRepository {
  constructor(readonly db: ScheduleDatabase) {}

  private async read(): Promise<ScheduleData> {
    const [lists, tasks, scheduleBlocks, root, tombstones, tags, exceptions] = await Promise.all([
      this.db.lists.toArray(), this.db.tasks.toArray(), this.db.scheduleBlocks.toArray(),
      this.db.metadata.get('state'), this.db.tombstones.toArray(), this.db.tags.toArray(), this.db.exceptions.toArray(),
    ]);
    if (!root) throw new Error('本地数据缺少版本信息。请保留浏览器数据，勿清空数据库。');
    return dataSchema.parse({
      schemaVersion: root.schemaVersion, lists, tasks, scheduleBlocks, settings: root.settings,
      tombstones, tags, exceptions, updatedAt: root.updatedAt,
    });
  }

  async snapshot(): Promise<ScheduleData> {
    return this.db.transaction('r', this.db.dataTables, () => this.read());
  }

  async initialize(): Promise<void> {
    await this.db.transaction('rw', this.db.dataTables, async () => {
      if (await this.db.metadata.get('state')) { await this.read(); return; }
      const counts = await Promise.all([this.db.lists.count(), this.db.tasks.count(), this.db.scheduleBlocks.count(), this.db.tombstones.count(), this.db.tags.count(), this.db.exceptions.count()]);
      if (counts.some(Boolean)) throw new Error('检测到缺少元数据的本地记录，已停止初始化以保护内容。');
      await this.write(initialData());
    });
  }

  private async write(data: ScheduleData): Promise<void> {
    // All callers hold one read/write transaction. Validation failure aborts all writes.
    const parsed = dataSchema.parse(data);
    await Promise.all([
      this.db.lists.bulkPut(parsed.lists), this.db.tasks.bulkPut(parsed.tasks),
      this.db.scheduleBlocks.bulkPut(parsed.scheduleBlocks), this.db.tombstones.bulkPut(parsed.tombstones),
      this.db.tags.bulkPut(parsed.tags), this.db.exceptions.bulkPut(parsed.exceptions),
      this.db.metadata.put({ key: 'state', schemaVersion: parsed.schemaVersion, settings: parsed.settings, updatedAt: parsed.updatedAt }),
    ]);
  }

  private async mutate<T>(action: (data: ScheduleData) => T, capture?: (data: ScheduleData) => Omit<UndoEntry, 'id' | 'createdAt' | 'expiresAt'>): Promise<T> {
    return this.db.transaction('rw', [...this.db.dataTables, this.db.undo], async () => {
      const data = await this.read();
      const undoPayload = capture?.(structuredClone(data));
      const beforeTombstones: Array<[string, string]> = data.tombstones.map((t) => [t.entityType, t.id]);
      const before = {
        list: data.lists.map((e) => e.id), task: data.tasks.map((e) => e.id),
        scheduleBlock: data.scheduleBlocks.map((e) => e.id),
        tag: data.tags.map((e) => e.id), exception: data.exceptions.map((e) => e.id),
      };
      const result = action(data);
      const retainedTombstones = new Set(data.tombstones.map((t) => `${t.entityType}:${t.id}`));
      await this.db.tombstones.bulkDelete(beforeTombstones.filter(([type, id]) => !retainedTombstones.has(`${type}:${id}`)));
      data.updatedAt = new Date().toISOString();
      // Delete missing records in the same transaction as the relation updates.
      const remove = async (type: keyof typeof before, ids: string[], table: Table<unknown, string>) => {
        const retained = new Set(ids);
        const removed = before[type].filter((id) => !retained.has(id));
        for (const id of removed) data.tombstones.push({ entityType: type, id, deletedAt: data.updatedAt });
        await table.bulkDelete(removed);
      };
      await Promise.all([
        remove('list', data.lists.map((e) => e.id), this.db.lists),
        remove('task', data.tasks.map((e) => e.id), this.db.tasks),
        remove('scheduleBlock', data.scheduleBlocks.map((e) => e.id), this.db.scheduleBlocks),
        remove('tag', data.tags.map((e) => e.id), this.db.tags),
        remove('exception', data.exceptions.map((e) => e.id), this.db.exceptions),
      ]);
      await this.write(data);
      if (undoPayload) {
        await this.db.undo.clear();
        await this.db.undo.put({ ...undoPayload, id: crypto.randomUUID(), createdAt: data.updatedAt, expiresAt: new Date(Date.now() + 30000).toISOString() });
      }
      return result;
    });
  }

  saveList(input: ListInput, id?: string): Promise<string> {
    return this.mutate((data) => {
      if (id) {
        const list = data.lists.find((e) => e.id === id);
        if (!list) throw new Error('清单已被删除');
        if (id === INBOX_ID && input.title !== '收集箱') throw new Error('收集箱不可重命名');
        Object.assign(list, touched({ ...list, ...input }));
        return id;
      }
      const list: List = { ...input, ...metadata(), order: Math.max(0, ...data.lists.map((l) => l.order)) + 1, archived: false };
      data.lists.push(list);
      return list.id;
    });
  }

  archiveList(id: string, archived: boolean): Promise<void> {
    return this.mutate((data) => {
      if (id === INBOX_ID) throw new Error('收集箱不可归档');
      const list = data.lists.find((e) => e.id === id);
      if (!list) throw new Error('清单不存在');
      Object.assign(list, touched({ ...list, archived }));
    });
  }

  deleteList(id: string): Promise<void> {
    return this.mutate((data) => {
      if (id === INBOX_ID) throw new Error('收集箱不可删除');
      if (!data.lists.some((l) => l.id === id)) throw new Error('清单已被删除');
      data.tasks = data.tasks.map((t) => t.listId === id ? touched({ ...t, listId: INBOX_ID }) : t);
      data.lists = data.lists.filter((l) => l.id !== id);
      data.settings.hiddenListIds = data.settings.hiddenListIds.filter((v) => v !== id);
    });
  }

  reorderList(id: string, direction: -1 | 1): Promise<void> {
    return this.mutate((data) => {
      const items = sort(data.lists);
      const index = items.findIndex((e) => e.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= items.length) return;
      [items[index], items[next]] = [items[next], items[index]];
      data.lists = items.map((l, order) => l.order === order ? l : touched({ ...l, order }));
    });
  }

  saveTask(input: TaskInput, id?: string): Promise<string> {
    return this.mutate((data) => {
      const list = data.lists.find((e) => e.id === input.listId);
      if (!list) throw new Error('请选择有效清单');
      const existing = id ? data.tasks.find((e) => e.id === id) : undefined;
      if (id && !existing) throw new Error('任务已被删除');
      if (list.archived && existing?.listId !== list.id) throw new Error('请先恢复归档清单');
      const task = taskSchema.parse({
        ...(existing ? touched(existing) : metadata()), ...input,
        subtasks: input.subtasks ?? existing?.subtasks ?? [], tagIds: input.tagIds ?? existing?.tagIds ?? [],
        order: existing?.order ?? Math.max(0, ...data.tasks.map((t) => t.order)) + 1,
        completedAt: input.status === 'done' ? existing?.completedAt ?? new Date().toISOString() : undefined,
      });
      data.tasks = [...data.tasks.filter((e) => e.id !== task.id), task];
      return task.id;
    });
  }

  setTaskStatus(id: string, status: Task['status']): Promise<void> {
    return this.mutate((data) => {
      const task = data.tasks.find((e) => e.id === id);
      if (!task) throw new Error('任务已被删除');
      Object.assign(task, touched({ ...task, status, completedAt: status === 'done' ? task.completedAt ?? new Date().toISOString() : undefined }));
    });
  }

  reorderTask(id: string, direction: -1 | 1): Promise<void> {
    return this.mutate((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error('任务不存在');
      const items = sort(data.tasks.filter((t) => t.listId === task.listId));
      const index = items.findIndex((t) => t.id === id);
      const next = index + direction;
      if (next < 0 || next >= items.length) return;
      [items[index], items[next]] = [items[next], items[index]];
      const order = new Map(items.map((t, n) => [t.id, n]));
      data.tasks = data.tasks.map((t) => order.has(t.id) ? touched({ ...t, order: order.get(t.id)! }) : t);
    });
  }

  deleteTask(id: string, confirmLinked = false): Promise<void> {
    return this.mutate((data) => {
      if (!data.tasks.some((t) => t.id === id)) throw new Error('任务已被删除');
      const linked = data.scheduleBlocks.some((b) => b.type === 'task' && b.taskId === id);
      if (linked && !confirmLinked) throw new Error('任务有关联时间块，需要确认删除');
      data.tasks = data.tasks.filter((e) => e.id !== id);
      data.scheduleBlocks = data.scheduleBlocks.filter((b) => b.type !== 'task' || b.taskId !== id);
    }, (data) => ({ task: data.tasks.find((t) => t.id === id), blocks: data.scheduleBlocks.filter((b) => b.type === 'task' && b.taskId === id), exceptions: [], label: '删除任务' }));
  }

  saveBlock(input: BlockInput, id?: string): Promise<string> {
    return this.mutate((data) => {
      const previous = id ? data.scheduleBlocks.find((b) => b.id === id) : undefined;
      if (id && !previous) throw new Error('时间块已被删除');
      const priorTaskBlock = previous?.type === 'task' ? previous : undefined;
      const execution = input.type === 'task' ? {
        executionStatus: input.executionStatus ?? priorTaskBlock?.executionStatus ?? 'pending',
        completedAt: input.executionStatus === undefined && priorTaskBlock ? priorTaskBlock.completedAt
          : input.executionStatus === 'completed' ? input.completedAt ?? (priorTaskBlock?.executionStatus === 'completed' ? priorTaskBlock.completedAt : new Date().toISOString())
            : input.completedAt,
      } : {};
      const block = blockSchema.parse({ ...input, ...execution, ...(previous ? {
        id: previous.id, createdAt: previous.createdAt, updatedAt: new Date().toISOString(), revision: previous.revision + 1,
      } : metadata()) });
      data.scheduleBlocks = [...data.scheduleBlocks.filter((b) => b.id !== block.id), block];
      if (block.type !== 'event' || !block.recurrence) data.exceptions = data.exceptions.filter((e) => e.seriesId !== block.id);
      return block.id;
    });
  }

  setBlockCompleted(id: string, completed: boolean): Promise<void> {
    return this.mutate((data) => {
      const block = data.scheduleBlocks.find((item) => item.id === id);
      if (!block) throw new Error('时间块已被删除');
      if (block.type !== 'task') throw new Error('只有任务安排可以标记本次完成');
      const executionStatus = completed ? 'completed' : 'pending';
      if (block.executionStatus === executionStatus) return;
      Object.assign(block, touched({ ...block, executionStatus,
        completedAt: completed ? new Date().toISOString() : undefined }));
    });
  }

  deleteBlock(id: string): Promise<void> {
    return this.mutate((data) => {
      if (!data.scheduleBlocks.some((b) => b.id === id)) throw new Error('时间块已被删除');
      data.scheduleBlocks = data.scheduleBlocks.filter((b) => b.id !== id);
      data.exceptions = data.exceptions.filter((e) => e.seriesId !== id);
    }, (data) => ({ blocks: data.scheduleBlocks.filter((b) => b.id === id), exceptions: data.exceptions.filter((e) => e.seriesId === id), label: '删除安排' }));
  }

  saveOccurrence(seriesId: string, occurrenceDate: string, input: BlockInput): Promise<string> {
    return this.mutate((data) => {
      const series = data.scheduleBlocks.find((b) => b.id === seriesId);
      if (!series || series.type !== 'event' || !series.recurrence || input.type !== 'event') throw new Error('重复系列不存在或类型无效');
      const current = data.exceptions.find((e) => e.seriesId === seriesId && e.occurrenceDate === occurrenceDate);
      const { type: _type, title, description, color, display, recurrence: _rule, ...range } = input;
      const entry: RecurrenceException = { ...(current ? touched(current) : metadata()), seriesId, occurrenceDate, cancelled: false,
        replacement: { title, description, color, display: display ?? 'normal', range } };
      data.exceptions = [...data.exceptions.filter((e) => e.id !== entry.id), entry];
      return entry.id;
    });
  }

  deleteOccurrence(seriesId: string, occurrenceDate: string): Promise<void> {
    return this.mutate((data) => {
      if (!data.scheduleBlocks.some((b) => b.id === seriesId && b.type === 'event' && b.recurrence)) throw new Error('重复系列不存在');
      const current = data.exceptions.find((e) => e.seriesId === seriesId && e.occurrenceDate === occurrenceDate);
      const entry: RecurrenceException = { ...(current ? touched(current) : metadata()), seriesId, occurrenceDate, cancelled: true };
      data.exceptions = [...data.exceptions.filter((e) => e.id !== entry.id), entry];
    });
  }

  saveTag(input: Pick<Tag, 'title' | 'color'>, id?: string): Promise<string> {
    return this.mutate((data) => {
      const existing = id ? data.tags.find((t) => t.id === id) : undefined;
      if (id && !existing) throw new Error('标签已被删除');
      const tag: Tag = { ...(existing ? touched(existing) : metadata()), ...input };
      data.tags = [...data.tags.filter((t) => t.id !== tag.id), tag];
      return tag.id;
    });
  }

  deleteTag(id: string): Promise<void> {
    return this.mutate((data) => {
      if (!data.tags.some((t) => t.id === id)) throw new Error('标签已被删除');
      data.tasks = data.tasks.map((t) => t.tagIds.includes(id) ? touched({ ...t, tagIds: t.tagIds.filter((v) => v !== id) }) : t);
      data.tags = data.tags.filter((t) => t.id !== id);
    });
  }

  async latestUndo(): Promise<UndoEntry | null> {
    const entry = await this.db.undo.orderBy('createdAt').last();
    return entry && entry.expiresAt > new Date().toISOString() ? entry : null;
  }

  async undoLast(id: string): Promise<void> {
    await this.db.transaction('rw', [...this.db.dataTables, this.db.undo], async () => {
      const entry = await this.db.undo.get(id);
      if (!entry || entry.expiresAt <= new Date().toISOString()) throw new Error('撤销已过期（30 秒），请使用备份恢复');
      await this.mutate((data) => {
        const restored: Array<{ entityType: Tombstone['entityType']; id: string }> = [];
        if (entry.task) {
          if (data.tasks.some((t) => t.id === entry.task!.id)) throw new Error('任务已存在，不能覆盖恢复');
          const listId = data.lists.some((l) => l.id === entry.task!.listId) ? entry.task.listId : INBOX_ID;
          const tagIds = entry.task.tagIds.filter((id) => data.tags.some((t) => t.id === id));
          data.tasks.push(touched({ ...entry.task, listId, tagIds })); restored.push({ entityType: 'task', id: entry.task.id });
        }
        for (const block of entry.blocks) {
          if (data.scheduleBlocks.some((b) => b.id === block.id)) throw new Error('安排已存在，不能覆盖恢复');
          data.scheduleBlocks.push(touched(block)); restored.push({ entityType: 'scheduleBlock', id: block.id });
        }
        for (const item of entry.exceptions) {
          if (data.exceptions.some((e) => e.id === item.id)) throw new Error('重复例外已存在，不能覆盖恢复');
          data.exceptions.push(touched(item)); restored.push({ entityType: 'exception', id: item.id });
        }
        data.tombstones = data.tombstones.filter((t) => !restored.some((e) => e.entityType === t.entityType && e.id === t.id));
      });
      await this.db.undo.delete(id);
    });
  }

  updateSettings(patch: Partial<Settings>): Promise<void> {
    return this.mutate((data) => { data.settings = { ...data.settings, ...patch }; });
  }

  toggleListVisibility(id: string): Promise<void> {
    return this.mutate((data) => {
      if (!data.lists.some((l) => l.id === id)) throw new Error('清单已被删除');
      const hidden = data.settings.hiddenListIds;
      data.settings.hiddenListIds = hidden.includes(id) ? hidden.filter((v) => v !== id) : [...hidden, id];
    });
  }

  async replaceData(input: ScheduleData): Promise<void> {
    const parsed = dataSchema.parse(input);
    await this.db.transaction('rw', [...this.db.dataTables, this.db.backups, this.db.undo], async () => {
      const previous = await this.read();
      const last = await this.db.backups.orderBy('createdAt').last();
      const backupTime = Math.max(Date.now(), last ? Date.parse(last.createdAt) + 1 : 0);
      await this.db.backups.add({ id: crypto.randomUUID(), createdAt: new Date(backupTime).toISOString(), data: previous, kind: 'import' });
      const old = await this.db.backups.orderBy('createdAt').reverse().filter((backup) => backup.kind !== 'migration').offset(3).primaryKeys();
      await this.db.backups.bulkDelete(old);
      await Promise.all(this.db.dataTables.map((table) => table.clear()));
      await this.write(parsed);
      // Restoring a snapshot establishes a new local state; old undo payloads cannot cross this boundary.
      await this.db.undo.clear();
    });
  }

  async latestBackup(): Promise<ScheduleData | null> {
    const backup = await this.db.backups.orderBy('createdAt').last();
    return backup ? migrateData(backup.data) : null;
  }

  async acknowledgeSync(start: ScheduleData, acknowledged: ScheduleData, state: SyncState): Promise<void> {
    await this.db.transaction('rw', [...this.db.dataTables, this.db.backups, this.db.syncStates], async () => {
      const stored = await this.db.syncStates.get(state.key);
      if (!stored?.enabled || stored.authorizationId !== state.authorizationId) return;
      const current = await this.read();
      const reconciled = merge(start, current, acknowledged);
      if (!reconciled.data || reconciled.conflicts.length) {
        await this.db.syncStates.put({ ...stored, inflight: undefined, preview: { kind: 'conflict', local: current, remote: acknowledged,
          sha: state.sha ?? null, conflicts: reconciled.conflicts, upload: 0, download: 0 }, error: '同步期间发生本地并发修改，请处理冲突。' });
        return;
      }
      const next = localSettings(reconciled.data, current);
      if (fingerprint(current) !== fingerprint(next)) {
        await this.db.backups.add({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), data: current, kind: 'sync' });
        for (const key of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions'] as const) {
          const ids = new Set(next[key].map((item) => item.id));
          await this.db[key].bulkDelete(current[key].filter((item) => !ids.has(item.id)).map((item) => item.id));
        }
        await this.db.tombstones.bulkDelete(current.tombstones.filter((item) => !next.tombstones.some((t) => t.id === item.id && t.entityType === item.entityType)).map((item) => [item.entityType, item.id]));
        await this.write(next);
      }
      await this.db.syncStates.put(state);
    });
  }
}

export async function readRecoveryData(name = 'polar-schedule'): Promise<unknown> {
  // Native open without a version can read the untouched old DB if Dexie's upgrade failed.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    const names = ['lists', 'tasks', 'scheduleBlocks', 'metadata', 'tombstones', 'tags', 'exceptions', 'backups', 'undo'].filter((key) => db.objectStoreNames.contains(key));
    if (!names.length) throw new Error('没有可导出的本地记录');
    const tx = db.transaction(names, 'readonly');
    const rows = await Promise.all(names.map((key) => new Promise<[string, unknown[]]>((resolve, reject) => {
      const request = tx.objectStore(key).getAll(); request.onsuccess = () => resolve([key, request.result as unknown[]]); request.onerror = () => reject(request.error);
    })));
    return { recoveryFormat: 1, databaseName: name, exportedAt: new Date().toISOString(), tables: Object.fromEntries(rows) };
  } finally { db.close(); }
}

export const database = new ScheduleDatabase();
export const repository = new ScheduleRepository(database);
