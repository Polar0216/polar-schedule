import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import type { ScheduleData } from '../domain/schema';
import { readRecoveryData, repository, type ScheduleRepository, type UndoEntry } from '../storage/database';

export interface Store {
  data: ScheduleData;
  repo: ScheduleRepository;
  saving: boolean;
  error: string | null;
  notice: string | null;
  undo: UndoEntry | null;
  undoLast: () => Promise<void>;
  clearError: () => void;
  notify: (text: string) => void;
  run: <T>(operation: () => Promise<T>, message?: string) => Promise<T | undefined>;
}
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void repository.initialize().then(() => {
      if (disposed) return;
      const subscription = liveQuery(() => repository.db.transaction('r', [...repository.db.dataTables, repository.db.undo], async () => ({
        data: await repository.snapshot(), undo: await repository.latestUndo(),
      }))).subscribe({
        next: (state) => { setData(state.data); setUndo(state.undo); },
        error: (e: unknown) => setFatal(errorMessage(e)),
      });
      unsubscribe = () => subscription.unsubscribe();
    }).catch((e: unknown) => { if (!disposed) setFatal(errorMessage(e)); });
    return () => { disposed = true; unsubscribe?.(); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!undo) return;
    const remaining = Date.parse(undo.expiresAt) - Date.now();
    const timer = window.setTimeout(() => setUndo(null), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [undo]);

  async function run<T>(operation: () => Promise<T>, message?: string): Promise<T | undefined> {
    setPending((v) => v + 1);
    setError(null);
    try {
      const result = await operation();
      try {
        setData(await repository.snapshot());
        setUndo(await repository.latestUndo());
        if (message) setNotice(message);
      } catch (refreshError) {
        // A committed write must not be reported as failed or retried as a new entity.
        setError(`操作已提交，但界面读取失败：${errorMessage(refreshError)}。请重新读取页面，避免重复提交。`);
      }
      return result;
    } catch (e) { setError(errorMessage(e)); return undefined; }
    finally { setPending((v) => v - 1); }
  }

  async function undoLast() {
    if (!undo) return;
    await run(async () => { await repository.undoLast(undo.id); }, '已撤销删除，内容与关联已恢复');
  }

  if (fatal) return <main className="startup"><div className="startup-card"><h1>本地数据暂时无法读取</h1>
    <p role="alert">{fatal}</p><p>请保留浏览器中的原始数据。若处于隐私模式或存储受限，请使用普通浏览器窗口重试。</p>
    <button onClick={() => location.reload()}>重新读取</button>
    <button onClick={() => void readRecoveryData().then((raw) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'polar-schedule-recovery.json'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    }).catch((e: unknown) => setFatal(errorMessage(e)))}>导出原始恢复数据</button></div></main>;
  if (!data) return <main className="startup"><div className="brand-mark">✦</div><p>正在打开你的日程…</p></main>;
  return <StoreContext.Provider value={{ data, repo: repository, run, saving: pending > 0, error, notice, undo, undoLast,
    clearError: () => setError(null), notify: setNotice }}>{children}</StoreContext.Provider>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return '浏览器存储空间不足，保存失败。请先导出备份，再释放空间。';
    if (error.name === 'ZodError') return '数据校验失败，操作已撤销。请检查日期、必填项或关联记录。';
    return error.message;
  }
  return '操作未能保存，请重试';
}

export function useStore(): Store {
  const value = useContext(StoreContext);
  if (!value) throw new Error('缺少 StoreProvider');
  return value;
}
