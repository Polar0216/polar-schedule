import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleDatabase, ScheduleRepository } from './database';
import { blockTitle, selectTasks, visibleBlocks } from '../domain/selectors';
import { browserTimeZone, localDate, addDays } from '../domain/dates';
import { INBOX_ID, parseImport, type BlockInput, type ScheduleData, type TaskInput } from '../domain/schema';

let db: ScheduleDatabase;
let repo: ScheduleRepository;
const taskInput = (overrides: Partial<TaskInput> = {}): TaskInput => ({
  title: '完成实验报告', listId: INBOX_ID, description: '整理测量数据', status: 'todo', priority: 'high', dueDate: '2026-10-23', ...overrides,
});
const range = { allDay: false as const, startAt: '2026-10-21T11:00:00.000Z', endAt: '2026-10-21T13:00:00.000Z', timeZone: 'Asia/Shanghai' };
const arranged = (taskId: string) => ({ ...range, type: 'task' as const, taskId });
const eventInput = { ...range, type: 'event' as const, title: '课程', description: '', color: '#4b91c3' } satisfies BlockInput;

beforeEach(async () => { db = new ScheduleDatabase(`test-${crypto.randomUUID()}`); repo = new ScheduleRepository(db); await repo.initialize(); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

describe('事务 CRUD 与实体关系', () => {
  it('只初始化收集箱，不注入示例数据；重复初始化不覆盖内容', async () => {
    await repo.saveTask(taskInput()); await repo.initialize();
    const data = await repo.snapshot();
    expect(data.lists).toHaveLength(1); expect(data.tasks).toHaveLength(1); expect(data.scheduleBlocks).toHaveLength(0);
    expect(data.settings.timeZone).toBe(browserTimeZone());
  });
  it('清单 CRUD、顺序、图标、颜色、显隐、归档在数据库重开后保留', async () => {
    const one = await repo.saveList({ title: '学习', color: '#123456', icon: 'book' });
    const two = await repo.saveList({ title: '项目', color: '#abcdef', icon: 'code' });
    await repo.saveList({ title: '课程学习', color: '#654321', icon: 'star' }, one);
    await repo.reorderList(two, -1); await repo.toggleListVisibility(one); await repo.archiveList(two, true);
    db.close(); await db.open(); const data = await repo.snapshot();
    expect(data.lists.find((l) => l.id === one)).toMatchObject({ title: '课程学习', color: '#654321', icon: 'star' });
    expect(data.lists.find((l) => l.id === two)).toMatchObject({ archived: true });
    expect(data.lists.find((l) => l.id === two)!.order).toBeLessThan(data.lists.find((l) => l.id === one)!.order);
    expect(data.settings.hiddenListIds).toContain(one);
  });
  it('收集箱不可删除、归档和改名，失败不改变数据库', async () => {
    await expect(repo.deleteList(INBOX_ID)).rejects.toThrow('不可删除');
    await expect(repo.archiveList(INBOX_ID, true)).rejects.toThrow('不可归档');
    await expect(repo.saveList({ title: '其他', color: '#123456', icon: 'book' }, INBOX_ID)).rejects.toThrow('不可重命名');
    expect((await repo.snapshot()).lists[0].title).toBe('收集箱');
  });
  it('任务编辑生效，保留 ID、createdAt，并增加 revision', async () => {
    const id = await repo.saveTask(taskInput()); const before = (await repo.snapshot()).tasks[0];
    await repo.saveTask(taskInput({ title: '修订报告', priority: 'low', status: 'in_progress', dueDate: undefined }), id);
    const after = (await repo.snapshot()).tasks[0];
    expect(after).toMatchObject({ id, title: '修订报告', priority: 'low', status: 'in_progress', createdAt: before.createdAt, revision: 2 });
    expect(after.dueDate).toBeUndefined();
  });
  it('一任务安排两段，移动只改变时间块，完成和撤销不丢安排', async () => {
    const id = await repo.saveTask(taskInput());
    const one = await repo.saveBlock(arranged(id)); await repo.saveBlock({ ...arranged(id), startAt: '2026-10-22T12:00:00.000Z', endAt: '2026-10-22T13:00:00.000Z' });
    await repo.saveBlock({ ...arranged(id), startAt: '2026-10-21T10:00:00.000Z' }, one);
    await repo.setTaskStatus(id, 'done'); let data = await repo.snapshot();
    expect(data.tasks).toHaveLength(1); expect(data.tasks[0].dueDate).toBe('2026-10-23');
    expect(data.tasks[0].completedAt).toBeDefined(); expect(data.scheduleBlocks).toHaveLength(2);
    await repo.setTaskStatus(id, 'todo'); data = await repo.snapshot();
    expect(data.tasks[0].completedAt).toBeUndefined(); expect(data.scheduleBlocks).toHaveLength(2);
  });
  it('删除一段安排只写时间块墓碑，原任务及另一段保留', async () => {
    const id = await repo.saveTask(taskInput()); const one = await repo.saveBlock(arranged(id)); await repo.saveBlock(arranged(id));
    await repo.deleteBlock(one); const data = await repo.snapshot();
    expect(data.tasks).toHaveLength(1); expect(data.scheduleBlocks).toHaveLength(1);
    expect(data.tombstones).toEqual([expect.objectContaining({ entityType: 'scheduleBlock', id: one })]);
  });
  it('改任务标题使所有时间块的派生标题同步更新，不复制任务内容', async () => {
    const id = await repo.saveTask(taskInput()); await repo.saveBlock(arranged(id)); await repo.saveBlock(arranged(id));
    await repo.saveTask(taskInput({ title: '最终版实验报告' }), id); const data = await repo.snapshot();
    expect(data.scheduleBlocks.map((b) => blockTitle(b, data))).toEqual(['最终版实验报告', '最终版实验报告']);
    expect(data.scheduleBlocks.every((b) => !('title' in b))).toBe(true);
  });
  it('有关联的任务删除需确认，确认后在一个事务内级联删除并写墓碑', async () => {
    const id = await repo.saveTask(taskInput()); await repo.saveBlock(arranged(id)); await repo.saveBlock(eventInput);
    await expect(repo.deleteTask(id)).rejects.toThrow('需要确认');
    expect((await repo.snapshot()).tasks).toHaveLength(1);
    await repo.deleteTask(id, true); const data = await repo.snapshot();
    expect(data.tasks).toHaveLength(0); expect(data.scheduleBlocks).toHaveLength(1);
    expect(data.tombstones.map((t) => t.entityType).sort()).toEqual(['scheduleBlock', 'task']);
  });
  it('删除清单安全迁移到收集箱，安排保留且隐藏设置清理', async () => {
    const listId = await repo.saveList({ title: '学习', color: '#123456', icon: 'book' });
    const taskId = await repo.saveTask(taskInput({ listId })); await repo.saveBlock(arranged(taskId)); await repo.toggleListVisibility(listId);
    await repo.deleteList(listId); const data = await repo.snapshot();
    expect(data.tasks[0].listId).toBe(INBOX_ID); expect(data.scheduleBlocks).toHaveLength(1);
    expect(data.settings.hiddenListIds).not.toContain(listId); expect(data.tombstones[0]).toMatchObject({ entityType: 'list', id: listId });
  });
  it('事务运行时校验拒绝悬空引用和反向时间，现有内容保持', async () => {
    await repo.saveBlock(eventInput);
    await expect(repo.saveBlock(arranged(crypto.randomUUID()))).rejects.toThrow();
    await expect(repo.saveBlock({ ...eventInput, endAt: range.startAt })).rejects.toThrow();
    await expect(repo.saveTask(taskInput({ listId: crypto.randomUUID() }))).rejects.toThrow();
    expect((await repo.snapshot()).scheduleBlocks).toHaveLength(1);
  });
  it('全天区间显式建模，跨年与重叠均保留', async () => {
    await repo.saveBlock({ type: 'event', title: '跨年', description: '', allDay: true, startDate: '2026-12-31', endDate: '2027-01-02', timeZone: 'Asia/Shanghai' });
    await repo.saveBlock(eventInput); await repo.saveBlock(eventInput);
    const data = await repo.snapshot(); expect(data.scheduleBlocks).toHaveLength(3);
    expect(data.scheduleBlocks.find((b) => b.allDay)).toMatchObject({ startDate: '2026-12-31', endDate: '2027-01-02' });
  });
  it('手动任务排序稳定并持久化', async () => {
    const one = await repo.saveTask(taskInput({ title: '一' })); const two = await repo.saveTask(taskInput({ title: '二' }));
    await repo.reorderTask(two, -1); db.close(); await db.open();
    expect(selectTasks(await repo.snapshot(), null, 'all').map((t) => t.id)).toEqual([two, one]);
  });
  it('多实例并发写入同一数据库不丢任务', async () => {
    const other = new ScheduleDatabase(db.name); const otherRepo = new ScheduleRepository(other);
    try { await Promise.all([repo.saveTask(taskInput({ title: '窗口一' })), otherRepo.saveTask(taskInput({ title: '窗口二' }))]);
      expect((await repo.snapshot()).tasks.map((t) => t.title).sort()).toEqual(['窗口一', '窗口二']);
    } finally { other.close(); }
  });
});

describe('备份恢复、导入校验与筛选', () => {
  it('导出往返可解析，完整替换后可下载原内容备份', async () => {
    await repo.saveTask(taskInput()); const original = await repo.snapshot();
    const imported = parseImport(JSON.stringify(original)); imported.tasks[0].title = '导入后的任务';
    await repo.replaceData(imported);
    expect((await repo.snapshot()).tasks[0].title).toBe('导入后的任务');
    expect((await repo.latestBackup())?.tasks[0].title).toBe('完成实验报告');
  });
  it('拒绝损坏 JSON、未知版本、缺字段、重复 ID、无效日期与关联', async () => {
    const source = await repo.snapshot();
    expect(() => parseImport('{broken')).toThrow('有效的 JSON');
    for (const corrupt of [
      { ...source, schemaVersion: 999 }, { ...source, lists: [] },
      { ...source, lists: [...source.lists, source.lists[0]] },
      { ...source, settings: { ...source.settings, hiddenListIds: [crypto.randomUUID()] } },
      { ...source, updatedAt: '2026-02-30T00:00:00.000Z' },
    ]) expect(() => parseImport(JSON.stringify(corrupt))).toThrow();
    const id = await repo.saveTask(taskInput()); await repo.saveBlock(arranged(id)); const data = await repo.snapshot();
    expect(() => parseImport(JSON.stringify({ ...data, tasks: [] }))).toThrow('不存在的任务');
    expect(() => parseImport(JSON.stringify({ ...data, tasks: [{ ...data.tasks[0], dueDate: '2026-02-30' }] }))).toThrow();
  });
  it('非法导入不触碰数据库', async () => {
    const id = await repo.saveTask(taskInput()); const original = await repo.snapshot();
    await expect(repo.replaceData({ ...original, schemaVersion: 999 } as unknown as ScheduleData)).rejects.toThrow();
    expect((await repo.snapshot()).tasks[0].id).toBe(id); expect(await repo.latestBackup()).toBeNull();
  });
  it('替换过程写入失败时，旧数据库与备份一起回滚', async () => {
    await repo.saveTask(taskInput()); const original = await repo.snapshot();
    const imported = structuredClone(original); imported.tasks[0].title = '不应保存';
    vi.spyOn(db.scheduleBlocks, 'bulkPut').mockRejectedValueOnce(new Error('模拟磁盘写入失败'));
    await expect(repo.replaceData(imported)).rejects.toThrow('模拟磁盘');
    expect((await repo.snapshot()).tasks[0].title).toBe('完成实验报告'); expect(await repo.latestBackup()).toBeNull();
  });
  it('只保留最近 3 次导入前快照', async () => {
    const data = await repo.snapshot();
    for (let i = 0; i < 4; i++) await repo.replaceData(data);
    expect(await db.backups.count()).toBe(3);
  });
  it('筛选分清已安排/未安排、已完成/未完成和未来七天及逾期', async () => {
    const one = await repo.saveTask(taskInput({ dueDate: localDate() }));
    await repo.saveTask(taskInput({ title: '远期', dueDate: addDays(localDate(), 8) }));
    const done = await repo.saveTask(taskInput({ title: '完成', status: 'done' }));
    await repo.saveBlock(arranged(one)); const data = await repo.snapshot();
    expect(selectTasks(data, null, 'unscheduled').map((t) => t.title)).toEqual(['远期']);
    expect(selectTasks(data, null, 'due').map((t) => t.id)).toEqual([one]);
    expect(selectTasks(data, null, 'completed').map((t) => t.id)).toEqual([done]);
    expect(selectTasks(data, null, 'incomplete')).toHaveLength(2);
  });
  it('隐藏/归档清单从总览与日历隐藏，独立日程保留', async () => {
    const listId = await repo.saveList({ title: '项目', color: '#123456', icon: 'code' });
    const id = await repo.saveTask(taskInput({ listId })); await repo.saveBlock(arranged(id)); await repo.saveBlock(eventInput);
    await repo.toggleListVisibility(listId); let data = await repo.snapshot();
    expect(visibleBlocks(data, null)).toHaveLength(1); expect(selectTasks(data, null, 'all')).toHaveLength(0);
    expect(selectTasks(data, listId, 'all')).toHaveLength(1);
    await repo.toggleListVisibility(listId); await repo.archiveList(listId, true); data = await repo.snapshot();
    expect(visibleBlocks(data, null)).toHaveLength(1);
  });
  it('主题、默认视图、布局状态重开后保留', async () => {
    await repo.updateSettings({ theme: 'dark', defaultView: 'month', tasksCollapsed: true, sidebarCollapsed: true });
    db.close(); await db.open(); expect((await repo.snapshot()).settings).toMatchObject({ theme: 'dark', defaultView: 'month', tasksCollapsed: true, sidebarCollapsed: true });
  });
});
