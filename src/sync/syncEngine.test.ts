import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { readRecoveryData, ScheduleDatabase, ScheduleRepository } from '../storage/database';
import { SyncEngine } from './syncEngine';
import { FakeGitHub, fixture } from './testSupport';
import { fingerprint, project } from './snapshotCodec';
import { TEST_TARGET, targetKey } from './types';
import { saveActiveState } from './syncState';

const dbs: ScheduleDatabase[] = [];
afterEach(async () => { for (const db of dbs) { db.close(); await Dexie.delete(db.name); } dbs.length = 0; });
async function device(fake: FakeGitHub, count = 2) {
  const db = new ScheduleDatabase(`phase3-test-${crypto.randomUUID()}`); dbs.push(db);
  const repo = new ScheduleRepository(db); await repo.initialize(); await repo.replaceData(fixture(count));
  return { db, repo, engine: new SyncEngine(repo, fake.fetch) };
}
async function linked(fake: FakeGitHub) { const d = await device(fake); await d.engine.connect('mock-phase3-token', true); await d.engine.sync({ first: 'local' }); return d; }
const key = targetKey(TEST_TARGET);

describe('持久队列、首次确认和多设备协调', () => {
  it.each([[0, 0], [2, 0], [0, 2], [2, 2]])('首次组合 local%s / remote%s 都先预览，零写入零丢失', async (local, remote) => {
    const fake = new FakeGitHub(remote ? fixture(remote) : null), d = await device(fake, local), before = await d.repo.snapshot();
    await d.engine.connect('mock', false); expect(fake.puts).toBe(0); expect(await d.repo.snapshot()).toEqual(before);
    expect((await d.db.syncStates.get(key))?.preview?.kind).toBe('first');
    await d.engine.sync(); expect(fake.puts).toBe(0); expect(await d.repo.snapshot()).toEqual(before);
  });
  it('确认采用远端自动备份原本地，主题/侧栏本机保留，清凭据保留所有数据', async () => {
    const fake = new FakeGitHub(fixture(1)), d = await device(fake, 2); await d.repo.updateSettings({ theme: 'dark', sidebarCollapsed: true });
    await d.engine.connect('mock', true); const before = await d.repo.snapshot(); await d.engine.sync({ first: 'remote' });
    const next = await d.repo.snapshot(); expect(next.tasks).toHaveLength(1); expect(next.settings.theme).toBe('dark'); expect(next.settings.sidebarCollapsed).toBe(true);
    expect((await d.db.backups.filter((b) => b.kind === 'sync').last())?.data).toEqual(before);
    await d.engine.disconnect(); expect(await d.db.credentials.count()).toBe(0); expect(await d.repo.snapshot()).toEqual(next);
    const recovery = JSON.stringify(await readRecoveryData(d.db.name)); expect(recovery).not.toContain('mock-phase3-token'); expect(recovery).not.toContain('credentials');
  });
  it('可信模式重开恢复，session模式不落盘，导出/同步状态不含凭据', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); const next = new SyncEngine(d.repo, fake.fetch); await next.sync();
    expect(next.getView().connected).toBe(true); expect(fake.puts).toBe(1);
    expect(JSON.stringify(await d.db.syncStates.toArray())).not.toContain('mock-phase3-token'); expect(JSON.stringify(await d.repo.snapshot())).not.toContain('mock-phase3-token');
    await next.disconnect(); await next.connect('mock-session', false); expect(await d.db.credentials.count()).toBe(0);
    const reopened = new SyncEngine(d.repo, fake.fetch); await reopened.sync(); expect(reopened.getView().status).toBe('auth');
  });
  it('首次确认前两端变化必须重新预览，不能使用旧选择覆盖', async () => {
    const fake = new FakeGitHub(), d = await device(fake); await d.engine.connect('mock', true);
    await d.repo.saveTask({ ...fixture().tasks[0], title: 'updated' }, fixture().tasks[0].id);
    await d.engine.sync({ first: 'local' }); expect(fake.puts).toBe(0);
    await d.engine.sync({ first: 'local' }); expect(fake.puts).toBe(1);
  });
  it('不同设备修改不同任务/新增任务自动合并；重复同步不产生提交', async () => {
    const fake = new FakeGitHub(), a = await linked(fake), b = await device(fake);
    await b.engine.connect('mock', true); await b.engine.sync({ first: 'remote' });
    await a.repo.saveTask({ ...fixture().tasks[0], title: 'deviceA' }, fixture().tasks[0].id);
    await b.repo.saveTask({ ...fixture().tasks[1], title: 'deviceB' }, fixture().tasks[1].id);
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
    expect((await a.repo.snapshot()).tasks.map((t) => t.title)).toEqual(['deviceA', 'deviceB']); expect(fingerprint(await a.repo.snapshot())).toBe(fingerprint(await b.repo.snapshot()));
    const count = fake.puts; await a.engine.sync(); await b.engine.sync(); expect(fake.puts).toBe(count);
  });
  it('相同任务不同内容和删除/编辑暂停，刷新仍有两端版本，显式解决保留本地', async () => {
    const fake = new FakeGitHub(), a = await linked(fake), b = await device(fake); await b.engine.connect('mock', true); await b.engine.sync({ first: 'remote' });
    const task = (await a.repo.snapshot()).tasks[0]; await a.repo.deleteTask(task.id);
    await b.repo.saveTask({ ...task, title: '另一端编辑' }, task.id); await a.engine.sync(); const count = fake.puts;
    await b.engine.sync(); expect(fake.puts).toBe(count); const state = await b.db.syncStates.get(key); expect(state?.preview?.conflicts).toHaveLength(1);
    const reloaded = new SyncEngine(b.repo, fake.fetch); await reloaded.sync(); expect(reloaded.getView().status).toBe('conflict');
    await reloaded.sync({ choices: { [state!.preview!.conflicts[0].key]: 'local' } });
    expect(fake.data?.tasks.some((t) => t.title === '另一端编辑')).toBe(true); expect(fake.data?.tombstones.some((t) => t.id === task.id)).toBe(false);
  });
  it('离线三次保存后重开保留队列，单个提交上传，设备主题改变不提交', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); const before = fake.puts;
    for (let n = 0; n < 3; n++) await d.repo.saveTask({ title: `offline${n}`, description: '', listId: fixture().lists[0].id, status: 'todo', priority: 'none' });
    const reopened = new SyncEngine(d.repo, fake.fetch); await reopened.sync(); expect(fake.puts).toBe(before + 1); expect(fake.data?.tasks).toHaveLength(5);
    await d.repo.updateSettings({ theme: 'dark', tasksCollapsed: true }); await reopened.sync(); expect(fake.puts).toBe(before + 1);
  });
  it('SHA409重新拉取合并；PUT提交成功但响应丢失核实一次不重复提交', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); await d.repo.saveTask({ ...fixture().tasks[0], title: 'local-edit' }, fixture().tasks[0].id);
    fake.beforePut = async () => { fake.beforePut = undefined; fake.data!.tasks[1].title = 'remote-race'; fake.serial++; };
    await d.engine.sync(); expect(fake.data?.tasks.map((t) => t.title)).toEqual(['local-edit', 'remote-race']);
    await d.repo.saveTask({ ...fixture().tasks[0], title: 'lost-response' }, fixture().tasks[0].id); fake.losePutResponse = true; const count = fake.puts;
    await d.engine.sync(); expect(fake.puts).toBe(count + 1); expect(d.engine.getView().status).toBe('synced');
  });
  it('上传期间新的本地编辑保留为待同步，不能把其误记为已上传', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); const first = fixture().tasks[0]; await d.repo.saveTask({ ...first, title: 'uploading' }, first.id);
    fake.beforePut = async () => { fake.beforePut = undefined; await d.repo.saveTask({ ...first, title: 'new-local' }, first.id); };
    await d.engine.sync(); expect((await d.repo.snapshot()).tasks[0].title).toBe('new-local'); expect(fake.data?.tasks[0].title).toBe('uploading');
    expect(d.engine.getView().pending).toBeGreaterThan(0); await d.engine.sync(); expect(fake.data?.tasks[0].title).toBe('new-local');
  });
  it('多标签共享IDB锁，仅一个并发PUT，SHA/base不跨目标', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); await d.repo.saveTask({ ...fixture().tasks[0], title: 'shared' }, fixture().tasks[0].id);
    const other = new SyncEngine(d.repo, fake.fetch), count = fake.puts; await Promise.all([d.engine.sync(), other.sync()]);
    expect(fake.puts).toBe(count + 1); expect((await d.db.syncStates.get(key))?.target).toEqual(TEST_TARGET); expect(await d.db.syncLeases.count()).toBe(0);
  });
  it('另一标签清凭据使会话令牌失效；重新启用不能复活旧凭据', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); await d.engine.connect('mock-session', false);
    const other = new SyncEngine(d.repo, fake.fetch); await other.disconnect(); await d.engine.setEnabled(true); const calls = fake.calls.length;
    await d.engine.sync(); expect(fake.calls.length).toBe(calls); expect(d.engine.getView().status).toBe('auth');
  });
  it('迟到的状态写入不能复活另一标签已暂停或重新授权的同步', async () => {
    const fake = new FakeGitHub(), d = await linked(fake), old = (await d.db.syncStates.get(key))!;
    await d.db.syncStates.update(key, { enabled: false }); expect(await saveActiveState(d.db, { ...old, error: 'stale' })).toBe(false);
    expect((await d.db.syncStates.get(key))?.enabled).toBe(false);
    await d.engine.connect('mock-new-authorization', true); const fresh = (await d.db.syncStates.get(key))!;
    expect(await saveActiveState(d.db, { ...old, error: 'stale' })).toBe(false); expect(await d.db.syncStates.get(key)).toEqual(fresh);
  });
  it('损坏的目标绑定停在可恢复错误，不请求远端或形成重试循环', async () => {
    const fake = new FakeGitHub(), d = await linked(fake), state = (await d.db.syncStates.get(key))!;
    await d.db.syncStates.put({ ...state, target: { ...TEST_TARGET, path: 'data/phase3-e2e/different-target.json' } });
    const calls = fake.calls.length; await d.engine.sync(); expect(fake.calls.length).toBe(calls); expect(d.engine.getView().status).toBe('error');
  });
  it.each([401, 403, 404, 422, 429, 500])('HTTP%s 不丢本地、不推进base/时间，限流停止自动重试', async (status) => {
    const fake = new FakeGitHub(), d = await linked(fake), state = await d.db.syncStates.get(key);
    await d.repo.saveTask({ ...fixture().tasks[0], title: 'pending' }, fixture().tasks[0].id); const before = await d.repo.snapshot();
    fake.failNext = status; await d.engine.sync(); expect(await d.repo.snapshot()).toEqual(before);
    const after = await d.db.syncStates.get(key); expect(after?.base).toEqual(state?.base); expect(after?.lastSyncedAt).toBe(state?.lastSyncedAt); expect(after?.error).toBeTruthy();
    if (status === 429) { const count = fake.calls.length; await d.engine.sync(); expect(fake.calls).toHaveLength(count); }
  });
  it('三次持续SHA冲突有上限，不更新共同祖先', async () => {
    const fake = new FakeGitHub(), d = await linked(fake), before = await d.db.syncStates.get(key); await d.repo.saveTask({ ...fixture().tasks[0], title: 'pending' }, fixture().tasks[0].id);
    fake.beforePut = async () => { fake.serial++; }; const count = fake.calls.length; await d.engine.sync();
    expect(fake.calls.slice(count).filter((c) => c.method === 'PUT')).toHaveLength(3); expect((await d.db.syncStates.get(key))?.base).toEqual(before?.base);
  });
  it('确认写入后本地事务失败保留inflight，重试核实恢复', async () => {
    const fake = new FakeGitHub(), d = await linked(fake); await d.repo.saveTask({ ...fixture().tasks[0], title: 'persist' }, fixture().tasks[0].id);
    const original = d.repo.acknowledgeSync.bind(d.repo); d.repo.acknowledgeSync = async () => { throw new Error('injected quota'); };
    await d.engine.sync(); expect((await d.db.syncStates.get(key))?.inflight).toBeTruthy(); const count = fake.puts;
    d.repo.acknowledgeSync = original; await d.engine.sync(); expect(fake.puts).toBe(count); expect(d.engine.getView().status).toBe('synced');
  });
  it('真实v3数据库增量升级到v4，实体/完成/系列/备份/撤销/主题不改写', async () => {
    const name = `phase3-test-${crypto.randomUUID()}`, old = new Dexie(name);
    old.version(3).stores({ lists: 'id,order,archived', tasks: 'id,listId,status,order,dueDate', scheduleBlocks: 'id,type,taskId,executionStatus', metadata: 'key', tombstones: '[entityType+id],deletedAt',
      backups: 'id,createdAt', tags: 'id,title', exceptions: 'id,seriesId,&[seriesId+occurrenceDate]', undo: 'id,createdAt,expiresAt' });
    const data = fixture(); data.settings.theme = 'dark';
    const meta = { revision: 7, createdAt: data.updatedAt, updatedAt: data.updatedAt };
    const tag = { ...meta, id: crypto.randomUUID(), title: '旧标签', color: '#123456' }; data.tags = [tag]; data.tasks[0].tagIds = [tag.id];
    data.tasks[0].subtasks = [{ id: crypto.randomUUID(), title: '旧子任务', done: true, order: 0 }];
    const range = { allDay: false as const, timeZone: 'Asia/Shanghai', startAt: data.updatedAt, endAt: '2026-10-23T03:00:00.000Z' };
    const seriesId = crypto.randomUUID();
    data.scheduleBlocks = [
      { ...meta, ...range, id: crypto.randomUUID(), type: 'task', taskId: data.tasks[0].id, executionStatus: 'completed', completedAt: data.updatedAt },
      { ...meta, ...range, id: crypto.randomUUID(), type: 'task', taskId: data.tasks[0].id, executionStatus: 'pending' },
      { ...meta, ...range, id: seriesId, type: 'event', title: '旧背景系列', description: '', display: 'background', recurrence: { frequency: 'weekly', interval: 1, weekdays: [5], startDate: '2026-10-23', localTime: '09:00', durationMinutes: 120 } },
    ];
    data.exceptions = [{ ...meta, id: crypto.randomUUID(), seriesId, occurrenceDate: '2026-10-30', cancelled: true }];
    data.tombstones = [{ entityType: 'task', id: crypto.randomUUID(), deletedAt: data.updatedAt }];
    data.scheduleBlocks.sort((a, b) => a.id.localeCompare(b.id)); // IDB getAll returns primary-key order, including in the old v3 DB.
    const backup = { id: 'before-v4', createdAt: data.updatedAt, data, kind: 'import' }, undo = { id: 'keep-undo', createdAt: data.updatedAt, expiresAt: '2099-01-01T00:00:00.000Z', label: '保留撤销', blocks: [], exceptions: [] };
    await old.transaction('rw', old.tables, async () => {
      for (const table of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions', 'tombstones'] as const) await old.table(table).bulkPut(data[table]);
      await old.table('metadata').put({ key: 'state', schemaVersion: 3, updatedAt: data.updatedAt, settings: data.settings });
      await old.table('backups').put(backup); await old.table('undo').put(undo);
    }); old.close();
    const db = new ScheduleDatabase(name); dbs.push(db); const repo = new ScheduleRepository(db); await repo.initialize();
    expect(db.verno).toBe(4); expect(await repo.snapshot()).toEqual(data); expect(await db.backups.toArray()).toEqual([backup]); expect(await db.undo.toArray()).toEqual([undo]);
    expect(await db.syncStates.count()).toBe(0); expect(await db.credentials.count()).toBe(0); expect(project(await repo.snapshot()).tasks).toEqual(data.tasks);
  });
});
