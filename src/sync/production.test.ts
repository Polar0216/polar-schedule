import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleDatabase, ScheduleRepository } from '../storage/database';
import { GitHubClient, validateTarget } from './githubClient';
import { SyncEngine } from './syncEngine';
import { FakeGitHub, fixture } from './testSupport';
import { PRODUCTION_TARGET, TEST_TARGET, targetKey } from './types';

const databases: ScheduleDatabase[] = [];
afterEach(async () => { for (const db of databases) { db.close(); await Dexie.delete(db.name); } databases.length = 0; });
async function device(local = 2, remote = 0) {
  const db = new ScheduleDatabase(`phase4-mock-${crypto.randomUUID()}`); databases.push(db);
  const repo = new ScheduleRepository(db); await repo.initialize(); await repo.replaceData(fixture(local));
  const test = new FakeGitHub(), production = new FakeGitHub(remote ? fixture(remote) : null, PRODUCTION_TARGET);
  const transport: typeof fetch = async (url, init) => {
    const current = new URL(String(url)).pathname.startsWith('/repos/Polar0216/polar-schedule-data-test') ? test : production;
    const authorization = new Headers(init?.headers).get('authorization');
    if (authorization !== `Bearer mock-${current === test ? 'test' : 'production'}`) return new Response('{}', { status: 403 });
    return current.fetch(url, init);
  };
  return { db, repo, test, production, transport, engine: new SyncEngine(repo, transport) };
}
describe('正式环境 allowlist、显式绑定和凭据隔离（完全Mock）', () => {
  it('只允许环境与仓库的精确配对；正式路径不可使用测试目录', () => {
    expect(() => validateTarget(PRODUCTION_TARGET)).not.toThrow();
    for (const target of [{ ...TEST_TARGET, repo: PRODUCTION_TARGET.repo }, { ...PRODUCTION_TARGET, repo: TEST_TARGET.repo },
      { ...PRODUCTION_TARGET, owner: 'other' }, { ...PRODUCTION_TARGET, branch: 'master' }, { ...PRODUCTION_TARGET, path: 'data/phase3-e2e/run.json' }]) expect(() => validateTarget(target)).toThrow();
  });
  it('切换先确认、保留本地，旧测试base/SHA/凭据不进入正式环境', async () => {
    const d = await device(); await d.engine.connect('mock-test', true); await d.engine.sync({ first: 'local' });
    const before = await d.repo.snapshot(), oldKey = targetKey(TEST_TARGET); expect((await d.db.syncStates.get(oldKey))?.sha).toBeTruthy();
    await expect(d.engine.selectEnvironment('production')).rejects.toThrow('确认');
    await d.engine.selectEnvironment('production', true); const key = targetKey(PRODUCTION_TARGET);
    expect((await d.db.syncStates.get(key))?.base).toBeUndefined(); expect((await d.db.syncStates.get(key))?.sha).toBeUndefined();
    expect((await d.db.syncStates.get(oldKey))?.enabled).toBe(false); expect(await d.db.credentials.count()).toBe(0); expect(await d.repo.snapshot()).toEqual(before); expect(d.production.calls).toHaveLength(0);
    await expect(d.engine.connect('mock-test', true)).rejects.toThrow('权限'); expect(d.production.puts).toBe(0); expect(await d.repo.snapshot()).toEqual(before);
    await d.engine.connect('mock-production', true); expect(d.production.puts).toBe(0); expect(d.engine.getView().status).toBe('preview');
    await d.engine.sync(); expect(d.production.puts).toBe(0); await d.engine.sync({ first: 'local' }); expect(d.production.puts).toBe(1);
    const reopened = new SyncEngine(d.repo, d.transport); await reopened.sync(); expect(reopened.getView().target).toEqual(PRODUCTION_TARGET); expect(d.production.puts).toBe(1);
    await reopened.selectEnvironment('test', true); await reopened.connect('mock-test', true); expect(reopened.getView().status).toBe('preview'); expect(d.test.puts).toBe(1);
  });
  it.each([[0, 0], [2, 0], [0, 2], [2, 2]])('正式首次local%s/remote%s都不自动覆盖', async (local, remote) => {
    const d = await device(local, remote), before = await d.repo.snapshot(); await d.engine.selectEnvironment('production', true);
    await d.engine.connect('mock-production', false); await d.engine.sync(); expect(d.production.puts).toBe(0); expect(await d.repo.snapshot()).toEqual(before);
    expect((await d.db.syncStates.get(targetKey(PRODUCTION_TARGET)))?.preview?.kind).toBe('first');
  });
  it('主动更换PAT强制新预览；清凭据不删除数据', async () => {
    const d = await device(); await d.engine.selectEnvironment('production', true); await d.engine.connect('mock-production', true); await d.engine.sync({ first: 'local' });
    await d.repo.saveTask({ title: '尚未上传的新任务', description: '', listId: fixture().lists[0].id, status: 'todo', priority: 'none' });
    const before = await d.repo.snapshot(), count = d.production.puts; await d.engine.connect('mock-production', true);
    expect(d.engine.getView().status).toBe('preview'); expect(d.production.puts).toBe(count); expect((await d.db.syncStates.get(d.engine.key))?.base).toBeUndefined();
    await d.engine.disconnect(); expect(await d.repo.snapshot()).toEqual(before); expect(await d.db.credentials.count()).toBe(0);
  });
  it('切换取消旧在途请求，迟到结果不恢复旧环境', async () => {
    const d = await device(); await d.engine.connect('mock-test', true); await d.engine.sync({ first: 'local' });
    let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
    const paused: typeof fetch = async (url, init) => {
      if (String(url).includes('/contents/')) { started(); await new Promise((_, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('Mock canceled')), { once: true }); }); }
      return d.transport(url, init);
    };
    const running = new SyncEngine(d.repo, paused); const pending = running.sync(); await ready; await running.selectEnvironment('production', true); await pending;
    expect(running.getView().target).toEqual(PRODUCTION_TARGET); expect(running.getView().connected).toBe(false); expect(d.production.calls).toHaveLength(0);
    expect((await d.db.syncStates.get(targetKey(TEST_TARGET)))?.enabled).toBe(false);
  });
  it('错误owner/private/default branch的正式元数据不会造成PUT', async () => {
    for (const fields of [{ full_name: 'other/polar-schedule-data' }, { private: false }, { default_branch: 'other' }]) {
      const client = new GitHubClient(PRODUCTION_TARGET, 'mock-production', async () => new Response(JSON.stringify({ full_name: 'Polar0216/polar-schedule-data', private: true, default_branch: 'main', ...fields })));
      await expect(client.validateRepository()).rejects.toThrow('私有'); await expect(client.write(fixture())).rejects.toThrow('验证');
    }
  });
});
