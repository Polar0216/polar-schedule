import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from '../../app/Store';
import { SyncEngine } from '../../sync/syncEngine';
import type { SyncStatus, SyncView } from '../../sync/types';
import { TEST_TARGET } from '../../sync/types';

const Context = createContext<SyncEngine | null>(null);
const empty: SyncView = { status: 'local', pending: 0, state: null, connected: false, target: TEST_TARGET };
const noopSubscribe = () => () => undefined;
const emptyView = () => empty;
export const statusLabels: Record<SyncStatus, string> = { local: '仅本地', pending: '待同步', syncing: '同步中…', synced: '已同步',
  preview: '等待首次确认', conflict: '需要处理冲突', offline: '离线 · 待同步', error: '同步需重试', auth: '需要授权' };
export function SyncProvider({ children }: { children: ReactNode }) {
  const { repo } = useStore();
  const engine = useMemo(() => new SyncEngine(repo), [repo]);
  useEffect(() => engine.start(), [engine]);
  return <Context.Provider value={engine}>{children}</Context.Provider>;
}
export function useSync() {
  const engine = useContext(Context);
  const view = useSyncExternalStore(engine?.subscribe ?? noopSubscribe, engine?.getView ?? emptyView);
  return { engine, ...view };
}
export function SyncStatusButton({ onClick }: { onClick: () => void }) {
  const { status, pending, state, target } = useSync();
  const label = target.environment === 'production' ? '正式' : '测试';
  return <button type="button" className={`sync-status sync-${status}`} onClick={onClick}
    title={state?.lastSyncedAt ? `${label}仓库 · 最近同步 ${new Date(state.lastSyncedAt).toLocaleString()}` : `前往 GitHub 同步设置 · ${label}环境`}>
    <span aria-hidden="true" className="sync-dot" /><span>{state?.enabled ? `${label} · ` : ''}{statusLabels[status]}{pending > 0 ? ` (${pending})` : ''}</span></button>;
}
