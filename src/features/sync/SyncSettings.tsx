import { useRef, useState } from 'react';
import { useStore } from '../../app/Store';
import { downloadData } from '../settings/SettingsDialog';
import { statusLabels, useSync } from './SyncProvider';
import { type Choices, type SyncEnvironment } from '../../sync/types';
import { ConfirmDialog } from '../../components/Controls';
import type { ScheduleData } from '../../domain/schema';
import './sync.css';

function summary(data: ScheduleData | null) {
  return data ? `${data.lists.length} 清单 / ${data.tasks.length} 任务 / ${data.scheduleBlocks.length} 安排 / ${data.tags.length} 标签 / ${data.exceptions.length} 例外 / ${data.tombstones.length} 删除记录` : '无远端快照（尚未创建）';
}
function versionText(value: unknown): string { return value === undefined ? '已删除 / 不存在' : JSON.stringify(value, null, 2); }
export function SyncSettings() {
  const { data } = useStore();
  const { engine, status, pending, state, connected, target } = useSync();
  const environmentLabel = target.environment === 'production' ? '正式' : '测试';
  const token = useRef<HTMLInputElement>(null);
  const remember = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<Choices>({});
  const [exported, setExported] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [switchTo, setSwitchTo] = useState<SyncEnvironment | null>(null);
  const preview = state?.preview;
  const action = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。本地内容保留。'); }
    finally { setBusy(false); }
  };
  return <section data-settings-section="sync" tabIndex={-1} className="sync-settings"><h3>GitHub 同步 <span className="sync-badge">私有{environmentLabel}环境</span></h3>
    <p className="field-help">先保存到本机，再同步到当前选定的私有仓库。首次连接或更换凭据必须重新预览确认，测试数据不会自动复制到正式仓库。</p>
    <label className="setting-row"><span>同步环境</span><select aria-label="同步环境" value={target.environment} disabled={busy}
      onChange={(event) => setSwitchTo(event.target.value as SyncEnvironment)}><option value="test">测试仓库</option><option value="production">正式仓库</option></select></label>
    <div className="sync-target"><label>Owner<input aria-label="同步 Owner" value={target.owner} readOnly /></label>
      <label>Repository<input aria-label="同步 Repository" value={target.repo} readOnly /></label></div>
    <p className="field-help sync-path">main / {target.path}</p>
    <div className="sync-current" role="status">{statusLabels[status]}{pending ? ` · ${pending} 项待同步` : ''}
      {state?.lastSyncedAt && <small>最近成功：{new Date(state.lastSyncedAt).toLocaleString()}</small>}</div>
    <form onSubmit={(event) => { event.preventDefault(); const value = token.current?.value ?? ''; if (token.current) token.current.value = '';
      void action(async () => { await engine?.connect(value, remember.current?.checked ?? false); setChoices({}); setExported(false); setAcknowledged(false); }); }}>
      <label className="sync-token-label">{connected ? '更换授权（停止当前同步并重新确认绑定）' : `${environmentLabel}仓库 fine-grained PAT`}
        <input ref={token} type="password" aria-label={`${environmentLabel}仓库 PAT`} autoComplete="off" spellCheck={false} required placeholder="仅 Contents: Read and write" /></label>
      <label className="sync-check"><input ref={remember} type="checkbox" />记住此设备（可信设备便捷模式）</label>
      <p className="field-help">勾选后，此来源的 IndexedDB 保存可用凭据；刷新或重开可自动连接。这不是加密保护。此 GitHub Pages 与同账号其他项目共享 origin，路径不能隔离凭据；同源脚本、扩展或本机受控都可能泄露令牌。仅授权当前单个仓库，设置有效期并保留随时撤销能力。</p>
      <button className="button" type="submit" disabled={busy || status === 'syncing' || !engine}>验证并连接{environmentLabel}仓库</button>
    </form>
    <div className="sync-actions"><label className="sync-check"><input type="checkbox" aria-label="自动同步" checked={Boolean(state?.enabled)} disabled={!state || busy}
      onChange={(e) => void action(async () => { await engine?.setEnabled(e.target.checked); })} />自动同步</label>
      <button className="button" disabled={!connected || busy || status === 'syncing'} onClick={() => void action(async () => { await engine?.sync(); })}>立即同步</button>
      <button className="button" disabled={!state || busy} onClick={() => void action(async () => { await engine?.disconnect(); })}>断开并清除本设备凭据</button>
      <button className="button" onClick={() => downloadData(data)}>导出本地 JSON</button></div>
    {(error || state?.error) && <p role="alert" className="sync-error">{error || state?.error}</p>}
    {state?.retryAt && state.retryAt > Date.now() && <p className="field-help">下次可重试：{new Date(state.retryAt).toLocaleString()}，本地编辑不受影响。</p>}
    {preview && <div className="sync-preview" key={`${preview.sha}:${preview.local.updatedAt}`}><h4>{preview.kind === 'first' ? '首次同步预览 · 需要确认' : '同步冲突 · 需要选择'}</h4>
      <p className="sync-path">目标：{target.owner}/{target.repo} · main · {target.path}</p>
      <dl><dt>本地</dt><dd>{summary(preview.local)}</dd><dt>远端</dt><dd>{summary(preview.remote)}</dd></dl>
      <p>版本差异：上传 {preview.upload} 项 / 下载 {preview.download} 项 / 冲突 {preview.conflicts.length} 项。首次保留一端会整体替换另一端；没有可信共同祖先时不会自动合并。确认前自动复核两端是否改变。</p>
      <div className="sync-actions"><button className="button" onClick={() => { downloadData(preview.local, 'sync-local'); if (preview.remote) downloadData(preview.remote, 'sync-remote'); setExported(true); }}>导出预览两端 JSON</button></div>
      {preview.conflicts.map((conflict) => <fieldset className="sync-conflict" key={conflict.key}><legend>{conflict.kind} · {conflict.title}</legend>
        <div className="sync-versions"><div><strong>本地版本</strong><pre>{versionText(conflict.local)}</pre></div><div><strong>远端版本</strong><pre>{versionText(conflict.remote)}</pre></div></div>
        <label className="sync-check"><input type="radio" name={conflict.key} checked={choices[conflict.key] === 'local'} onChange={() => setChoices({ ...choices, [conflict.key]: 'local' })} />保留本地</label>
        <label className="sync-check"><input type="radio" name={conflict.key} checked={choices[conflict.key] === 'remote'} onChange={() => setChoices({ ...choices, [conflict.key]: 'remote' })} />保留远端</label>
      </fieldset>)}
      <label className="sync-check"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />已检查目标和两端摘要，确认所选内容将替换对应记录</label>
      <div className="sync-actions">{preview.kind === 'first' ? <>
        <button className="button primary" disabled={!acknowledged || busy || !connected} onClick={() => void action(async () => { await engine?.sync({ first: 'local' }); setAcknowledged(false); })}>确认以本地创建 / 替换{environmentLabel}快照</button>
        {preview.remote && <button className="button" disabled={!acknowledged || !exported || busy || !connected} onClick={() => void action(async () => { await engine?.sync({ first: 'remote' }); setAcknowledged(false); })}>确认备份后采用远端</button>}</>
        : <button className="button primary" disabled={!acknowledged || !exported || busy || !connected || preview.conflicts.some((c) => !choices[c.key])}
          onClick={() => void action(async () => { await engine?.sync({ choices }); setChoices({}); setExported(false); setAcknowledged(false); })}>确认冲突选择并同步</button>}</div>
      <p className="field-help">本地接收变更前自动保留恢复快照。冲突处理需先导出两端；保持窗口打开直到浏览器完成下载。断开同步不会删除本地日程。</p>
    </div>}
    {switchTo && <ConfirmDialog title={`切换到${switchTo === 'production' ? '正式' : '测试'}环境？`} confirmLabel="确认断开并切换" busy={busy} onClose={() => setSwitchTo(null)}
      onConfirm={() => void action(async () => { await engine?.selectEnvironment(switchTo, true); if (token.current) token.current.value = ''; if (remember.current) remember.current.checked = false;
        setChoices({}); setAcknowledged(false); setExported(false); setSwitchTo(null); })}>
      <p>当前目标 {target.repo}，有 {pending} 项待同步。请先导出需要保留的本地 JSON；这些内容会留在本机，不会自动上传到新仓库。</p>
      <p>确认后停止当前同步、清除设备连接凭据，建立新的仓库绑定。需要为新环境输入对应单仓库 PAT，再查看两端摘要并确认首次同步。原有日程与备份保留。</p>
    </ConfirmDialog>}
  </section>;
}
