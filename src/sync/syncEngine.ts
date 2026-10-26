import { liveQuery } from 'dexie';
import type { ScheduleRepository } from '../storage/database';
import type { ScheduleData } from '../domain/schema';
import { CredentialVault } from './credentialVault';
import { GitHubClient, GitHubError } from './githubClient';
import { merge } from './merge';
import { countChanges, fingerprint, project } from './snapshotCodec';
import { saveActiveState, withSyncLock } from './syncState';
import { TEST_TARGET, targetFor, targetKey, type Choices, type Conflict, type RemoteFile, type SyncEnvironment, type SyncState, type SyncTarget, type SyncView } from './types';

export class SyncEngine {
  #target: SyncTarget = TEST_TARGET;
  get key() { return targetKey(this.#target); }
  get target() { return this.#target; }
  readonly vault: CredentialVault;
  #client?: GitHubClient;
  #busy = false;
  #timer?: ReturnType<typeof setTimeout>;
  #lastTrigger = 0;
  #generation = 0;
  #observing = false;
  #listeners = new Set<() => void>();
  #view: SyncView = { status: 'local', pending: 0, state: null, connected: false, target: TEST_TARGET };
  #idle = new Set<() => void>();
  #local?: ScheduleData;
  constructor(readonly repo: ScheduleRepository, private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis)) { this.vault = new CredentialVault(repo.db); }
  getView = () => this.#view;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  private emit() { this.#listeners.forEach((listener) => listener()); }
  private async adoptSelection() {
    const states = await this.repo.db.syncStates.toArray();
    // Old Phase 3 rows have no selected field and remain in test mode.
    const selected = states.find((state) => state.selected);
    const target = selected ? targetFor(selected.target.environment) : TEST_TARGET;
    if (targetKey(target) !== this.key) {
      this.#generation++; clearTimeout(this.#timer); this.#client?.clear(); this.vault.forgetSession(); this.#target = target;
    }
  }
  private async refresh() {
    await this.adoptSelection();
    const key = this.key, generation = this.#generation;
    const [data, state, token] = await Promise.all([this.repo.snapshot(), this.repo.db.syncStates.get(key), this.vault.get(key)]);
    if (key !== this.key || generation !== this.#generation) return;
    this.#local = data;
    const pending = state?.base ? countChanges(state.base, project(data)) : countChanges(null, data);
    const connected = Boolean(state?.enabled && token);
    const status = !state?.enabled ? 'local' : !connected || state.authExpired ? 'auth' : this.#busy ? 'syncing'
      : state.preview ? state.preview.kind === 'first' ? 'preview' : 'conflict' : globalThis.navigator?.onLine === false ? 'offline'
      : state.error ? 'error' : pending ? 'pending' : state.base ? 'synced' : 'pending';
    this.#view = { status, pending: state?.enabled ? pending : 0, state: state ?? null, connected, target: this.target }; this.emit();
  }
  start(): () => void {
    this.#observing = true;
    let fingerprintBefore = ''; let stopped = false;
    const subscription = liveQuery(async () => ({ data: await this.repo.snapshot(), states: await this.repo.db.syncStates.toArray(), credentialCount: await this.repo.db.credentials.count() })).subscribe({
      next: ({ data }) => {
        void this.refresh().then(() => {
          if (stopped) return;
          const state = this.#view.state;
          const mark = `${this.key}:${fingerprint(data)}:${state?.authorizationId}:${state?.enabled}`;
          if (mark !== fingerprintBefore) {
            fingerprintBefore = mark;
            if (this.#view.connected && state?.enabled && !state.preview && !state.error) this.schedule();
          }
        }).catch(() => undefined);
      }, error: () => { this.#view = { ...this.#view, status: 'error' }; this.emit(); },
    });
    const trigger = () => {
      if (Date.now() - this.#lastTrigger < 10000 || !this.#view.connected) return;
      this.#lastTrigger = Date.now(); this.schedule();
    };
    globalThis.addEventListener?.('online', trigger); globalThis.addEventListener?.('focus', trigger);
    return () => { stopped = true; this.#observing = false; subscription.unsubscribe(); clearTimeout(this.#timer); globalThis.removeEventListener?.('online', trigger); globalThis.removeEventListener?.('focus', trigger); };
  }
  schedule() { clearTimeout(this.#timer); this.#timer = setTimeout(() => { void this.sync(); }, 3000); }
  async connect(token: string, remember: boolean): Promise<void> {
    await this.adoptSelection();
    await this.disconnect();
    const key = this.key, target = this.target, generation = this.#generation;
    const client = new GitHubClient(target, token, this.transport);
    this.#client = client;
    try {
      await client.validateRepository();
      // Validate remote before persisting any credential or enabling automation.
      await client.read();
      if (generation !== this.#generation || key !== this.key) { client.clear(); return; }
      const authorizationId = crypto.randomUUID();
      await this.repo.db.transaction('rw', [this.repo.db.credentials, this.repo.db.syncStates], async () => {
        const states = await this.repo.db.syncStates.toArray();
        const selected = states.find((state) => state.selected);
        if (selected && selected.key !== key) throw new Error('同步环境已在另一标签页改变，请重新检查目标。');
        for (const state of states) if (state.key !== key && (state.enabled || state.selected)) {
          await this.vault.clear(state.key); await this.repo.db.syncStates.put({ ...state, enabled: false, selected: false, authorizationId: crypto.randomUUID() });
        }
        await this.vault.set(key, token, remember, authorizationId);
        // Explicit authorization always establishes a fresh binding. Saved-device
        // resume uses sync(), so normal restarts still keep their trusted base.
        await this.repo.db.syncStates.put({ key, target, enabled: true, selected: true, authorizationId });
      });
      await this.sync();
    } catch (error) {
      client.clear();
      throw new Error(error instanceof GitHubError ? error.message : '无法连接指定私有仓库：请检查所选环境、main 分支、快照格式和单仓库权限。');
    }
  }
  async disconnect(): Promise<void> {
    const key = this.key;
    this.#generation++; clearTimeout(this.#timer); this.#client?.clear(); this.#client = undefined;
    await this.repo.db.transaction('rw', [this.repo.db.credentials, this.repo.db.syncStates], async () => {
      await this.vault.clear(key);
      const state = await this.repo.db.syncStates.get(key);
      if (state) await this.repo.db.syncStates.put({ ...state, enabled: false, authorizationId: crypto.randomUUID(), error: undefined, authExpired: false });
    });
    if (this.#busy) await new Promise<void>((resolve) => this.#idle.add(resolve));
    await this.refresh();
  }
  async selectEnvironment(environment: SyncEnvironment, confirmed = false): Promise<void> {
    if (!confirmed) throw new Error('请先确认待同步内容与新的仓库绑定。');
    const target = targetFor(environment);
    await this.disconnect();
    await this.repo.db.transaction('rw', [this.repo.db.credentials, this.repo.db.syncStates], async () => {
      for (const state of await this.repo.db.syncStates.toArray()) {
        await this.vault.clear(state.key);
        await this.repo.db.syncStates.put({ ...state, enabled: false, selected: false, authorizationId: crypto.randomUUID() });
      }
      await this.repo.db.syncStates.put({ key: targetKey(target), target, enabled: false, selected: true, authorizationId: crypto.randomUUID() });
    });
    await this.adoptSelection(); await this.refresh();
  }
  async setEnabled(enabled: boolean) {
    await this.adoptSelection();
    await this.repo.db.syncStates.update(this.key, { enabled });
    if (!enabled) clearTimeout(this.#timer); else this.schedule();
    await this.refresh();
  }
  private preview(state: SyncState, local: ScheduleData, remote: RemoteFile | null, conflicts: Conflict[] = []) {
    return saveActiveState(this.repo.db, { ...state, error: undefined, preview: { kind: state.base && remote ? 'conflict' : 'first', local: project(local),
      remote: remote?.data ?? null, sha: remote?.sha ?? null, conflicts, upload: remote ? countChanges(remote.data, local) : countChanges(null, local),
      download: remote ? countChanges(local, remote.data) : 0 } });
  }
  async sync(confirmation?: { first?: 'local' | 'remote'; choices?: Choices }): Promise<void> {
    await this.adoptSelection();
    if (this.#busy) return;
    clearTimeout(this.#timer);
    if (globalThis.navigator?.onLine === false) { await this.refresh(); return; }
    this.#busy = true;
    const generation = this.#generation;
    const key = this.key;
    let operationAuthorization: string | undefined;
    try {
      await this.refresh();
      await withSyncLock(this.repo.db, key, async () => {
        let state = await this.repo.db.syncStates.get(key);
        if (!state?.enabled || state.authExpired || (state.retryAt && state.retryAt > Date.now())) return;
        operationAuthorization = state.authorizationId;
        if (state.key !== targetKey(state.target) || state.key !== key || key !== this.key) throw new Error('同步目标与共同祖先绑定不一致。');
        const token = await this.vault.get(key);
        if (!token) return;
        this.#client?.clear();
        const client = new GitHubClient(state.target, token, this.transport); this.#client = client;
        await client.validateRepository();
        for (let attempt = 0; attempt < 3; attempt++) {
          const local = project(await this.repo.snapshot());
          const remote = await client.read();
          const latest = await this.repo.db.syncStates.get(key);
          if (!latest?.enabled || latest.authorizationId !== state.authorizationId || generation !== this.#generation) return;
          if (state.inflight && remote && fingerprint(remote.data) === fingerprint(state.inflight)) {
            await this.acknowledge(state.inflightLocal ?? local, remote.data, remote.sha, state); return;
          }
          let candidate: ScheduleData;
          if (!state.base || !remote) {
            if (!confirmation?.first || !state.preview || state.preview.sha !== (remote?.sha ?? null) || fingerprint(state.preview.local) !== fingerprint(local)) {
              await this.preview(state, local, remote); return;
            }
            candidate = confirmation.first === 'remote' && remote ? remote.data : local;
          } else {
            if (state.preview && confirmation && (state.preview.sha !== remote.sha || fingerprint(state.preview.local) !== fingerprint(local))) {
              const newer = merge(state.base, local, remote.data); await this.preview(state, local, remote, newer.conflicts); return;
            }
            const merged = merge(state.base, local, remote.data, confirmation?.choices);
            if (!merged.data || merged.conflicts.length) { await this.preview(state, local, remote, merged.conflicts); return; }
            candidate = merged.data;
          }
          // A persisted preview is always a barrier until explicitly confirmed.
          if (state.preview && !confirmation) { await this.preview(state, local, remote, state.preview.conflicts); return; }
          if (remote && fingerprint(candidate) === fingerprint(remote.data)) { await this.acknowledge(local, candidate, remote.sha, state); return; }
          state = { ...state, inflight: candidate, inflightLocal: local };
          if (!await saveActiveState(this.repo.db, state)) return;
          const stillAuthorized = await this.repo.db.syncStates.get(key);
          if (!stillAuthorized?.enabled || stillAuthorized.authorizationId !== state.authorizationId || generation !== this.#generation) return;
          try {
            const sha = await client.write(candidate, remote?.sha);
            await this.acknowledge(local, candidate, sha, state); return;
          } catch (error) {
            if (error instanceof GitHubError && [0, 409, 422].includes(error.status) && attempt < 2) {
              // Re-read first: an unknown PUT may already have committed. Never blind retry.
              await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
              confirmation = undefined;
              continue;
            }
            throw error;
          }
        }
      });
    } catch (error) {
      const state = await this.repo.db.syncStates.get(key);
      if (state?.enabled && state.authorizationId === operationAuthorization && generation === this.#generation) {
        const retryAt = error instanceof GitHubError ? error.retryAt : undefined;
        await saveActiveState(this.repo.db, { ...state, authExpired: error instanceof GitHubError && error.status === 401,
          error: error instanceof GitHubError ? error.message : '快照校验、大小或本地事务失败；未确认的修改已保留。请导出 JSON 后重试。',
          retryAt: retryAt ?? (error instanceof GitHubError && (error.status === 429 || error.status >= 500) ? Date.now() + 30000 : undefined) });
      }
    } finally {
      this.#busy = false; this.#idle.forEach((resolve) => resolve()); this.#idle.clear();
      await this.refresh(); if (this.#observing && this.#view.status === 'pending') this.schedule();
    }
  }
  private async acknowledge(start: ScheduleData, candidate: ScheduleData, sha: string, state: SyncState) {
    await this.repo.acknowledgeSync(start, candidate, { ...state, base: project(candidate), sha, lastSyncedAt: new Date().toISOString(),
      inflight: undefined, inflightLocal: undefined, preview: undefined, error: undefined, retryAt: undefined, authExpired: false });
  }
  get localData() { return this.#local; }
}
