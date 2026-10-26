import { useEffect, useRef, useState } from 'react';
import { SyncSettings } from '../sync/SyncSettings';
import { PwaSettings } from '../pwa/PwaSettings';
import { CheckCircle2, Download, FileJson, Monitor, Moon, ShieldCheck, Sun, Upload } from 'lucide-react';
import { useStore } from '../../app/Store';
import { ConfirmDialog, Dialog } from '../../components/Controls';
import { browserTimeZone, localDate } from '../../domain/dates';
import { parseImport, type ScheduleData, type Settings } from '../../domain/schema';
import { ListIcon } from '../lists/Lists';
import './settings.css';

export function downloadData(data: ScheduleData, label = 'backup'): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `polar-schedule-${label}-${localDate()}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function SettingsDialog({ onClose, onImported, initialSection }: { onClose: () => void; onImported: () => void; initialSection?: string }) {
  const { data, repo, run, saving, notify } = useStore();
  const [pending, setPending] = useState<ScheduleData | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusSection = (id: string) => {
    const section = body.current?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
    section?.focus({ preventScroll: true });
    if (section && body.current) body.current.scrollTo({ top: body.current.scrollTop + section.getBoundingClientRect().top - body.current.getBoundingClientRect().top, behavior: 'smooth' });
  };
  const themes = [{ id: 'light', label: '浅色', Icon: Sun }, { id: 'dark', label: '深色', Icon: Moon }, { id: 'system', label: '跟随系统', Icon: Monitor }] as const;
  const [storageStatus, setStorageStatus] = useState('');
  useEffect(() => { if (initialSection) focusSection(initialSection); }, [initialSection]);
  return <Dialog title="设置与数据" onClose={onClose} wide>
    <nav className="settings-nav" aria-label="设置分组">{[['appearance', '外观'], ['calendar', '日历与时间轴'], ['visibility', '清单与显示'], ['data', '数据备份与恢复'], ['sync', 'GitHub 同步'], ['pwa', '安装与更新']].map(([id, title]) =>
      <button type="button" key={id} title={`前往${title}`} onClick={() => focusSection(id)}>{title}</button>)}</nav>
    <div className="dialog-body settings-body" ref={body}>
      <section data-settings-section="appearance" tabIndex={-1}><h3>外观</h3><div className="theme-options">{themes.map(({ id, label, Icon }) => <button key={id}
        aria-pressed={data.settings.theme === id} className={data.settings.theme === id ? 'active' : ''}
        onClick={() => void run(() => repo.updateSettings({ theme: id }))}><Icon size={20} /><span>{label}</span></button>)}</div>
      </section>
      <section data-settings-section="calendar" tabIndex={-1}><h3>日历与时间轴</h3>
        <label className="setting-row"><span>默认日历视图<small>在桌面端下次打开时生效；手机优先日视图</small></span>
          <select aria-label="默认日历视图" value={data.settings.defaultView} onChange={(e) => void run(() => repo.updateSettings({ defaultView: e.target.value as Settings['defaultView'] }))}>
            <option value="day">日视图</option><option value="week">周视图</option><option value="month">月视图</option></select></label>
        <div className="setting-row"><span>显示时区<small>跟随当前浏览器；全天安排按日期保存</small></span><code>{browserTimeZone()}</code></div>
        <label className="setting-row"><span>时间粒度</span><select aria-label="时间粒度" value={data.settings.slotMinutes} onChange={(e) => void run(() => repo.updateSettings({ slotMinutes: Number(e.target.value) as Settings['slotMinutes'] }))}>
          <option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>60 分钟</option></select></label>
        <div className="setting-row"><span>显示时段<small>范围外的安排仍可从“本段安排”查看</small></span><div className="hour-settings">
          <select aria-label="显示开始小时" value={data.settings.startHour} onChange={(e) => void run(() => repo.updateSettings({ startHour: Number(e.target.value) }))}>
            {Array.from({ length: data.settings.endHour }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select><span>—</span>
          <select aria-label="显示结束小时" value={data.settings.endHour} onChange={(e) => void run(() => repo.updateSettings({ endHour: Number(e.target.value) }))}>
            {Array.from({ length: 24 - data.settings.startHour }, (_, n) => n + data.settings.startHour + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></div></div>
        <label className="setting-row"><span>一周开始于</span><select aria-label="周起始日" value={data.settings.weekStartsOn} onChange={(e) => void run(() => repo.updateSettings({ weekStartsOn: Number(e.target.value) as 0 | 1 }))}>
          <option value={1}>周一</option><option value={0}>周日</option></select></label>
        <label className="setting-row"><span>页面密度</span><select aria-label="页面密度" value={data.settings.density} onChange={(e) => void run(() => repo.updateSettings({ density: e.target.value as Settings['density'] }))}>
          <option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
        <label className="setting-row"><span>拖入任务默认时长<small>拖到月视图或全天区时创建全天安排</small></span><select aria-label="默认安排时长" value={data.settings.defaultDurationMinutes} onChange={(e) => void run(() => repo.updateSettings({ defaultDurationMinutes: Number(e.target.value) }))}>
          {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label>
      </section>
      <section data-settings-section="visibility" tabIndex={-1}><h3>清单与显示</h3><p className="field-help">隐藏或归档清单会从总览与日历隐藏相关任务，内容仍保留。可从清单导航查看。</p>
        <div className="visibility-list">{[...data.lists].sort((a, b) => a.order - b.order).map((list) => <label key={list.id}>
          <ListIcon list={list} /><span>{list.title}{list.archived && <small> · 已归档</small>}</span>
          <input type="checkbox" aria-label={`显示清单 ${list.title}`} checked={!data.settings.hiddenListIds.includes(list.id)} onChange={() => void run(() => repo.toggleListVisibility(list.id))} /></label>)}</div>
      </section>
      <section data-settings-section="data" tabIndex={-1}><h3>数据备份与恢复</h3><div className="backup-note"><ShieldCheck size={22} /><p>数据保存在当前浏览器来源，已启用的同步另存于所选私有仓库。请定期导出 JSON，清理浏览器数据或更换设备前尤其需要备份。</p></div>
        <p className="field-help">从旧 127.0.0.1:4173 迁移：先在旧站导出完整 JSON，确认下载成功，再在新站预览并确认导入。新站空白不表示旧数据丢失；保留旧浏览器供回退。测试仓库不会自动迁移到正式仓库。</p>
        <div className="data-buttons"><button className="button secondary" onClick={() => void run(async () => { downloadData(await repo.snapshot()); }, '备份文件已生成，请确认浏览器下载成功')}><Download size={16} />导出完整 JSON</button>
          <button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={16} />导入 JSON</button>
          <input type="file" accept="application/json,.json" ref={fileInput} className="sr-only" aria-label="选择导入文件" onChange={(e) => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            setValidation(null); setPending(null);
            if (file.size > 30 * 1024 * 1024) { setValidation('文件超过 30 MB'); return; }
            void file.text().then((text) => { setPending(parseImport(text)); }).catch((err: unknown) => setValidation(err instanceof Error ? err.message : '文件读取失败'));
          }} /></div>
        {validation && <p role="alert" className="validation-error">{validation}。现有数据未改动。</p>}
        {pending && <div className="import-preview"><div><FileJson size={20} /><strong>导入预览 · schemaVersion {pending.schemaVersion}</strong></div>
          <p>{pending.lists.length} 个清单 · {pending.tasks.length} 条任务 · {pending.scheduleBlocks.length} 段安排 · {pending.tags.length} 个标签 · {pending.exceptions.length} 个重复例外 · {pending.tombstones.length} 条删除记录</p>
          <p className="field-help">替换会覆盖当前内容。请先导出备份。应用还会在本地保留导入前快照，最近 3 次可恢复。</p>
          <button className="button primary" disabled={saving} onClick={() => setConfirm(true)}>继续替换导入…</button>
          <button className="button" onClick={() => setPending(null)}>取消导入</button>
        </div>}
        <button className="text-link" onClick={() => void run(async () => {
          const backup = await repo.latestBackup();
          if (backup) { downloadData(backup, 'pre-import'); notify('导入前备份已生成，可通过导入入口恢复'); }
          else notify('还没有导入前备份');
        })}>下载最近一次导入前备份</button>
      <div className="storage-section"><h4>本地存储</h4><p><CheckCircle2 size={15} />IndexedDB · 数据格式 v3 · 兼容 v1 / v2 备份 · 无须登录</p>
        <p className="field-help">{import.meta.env.DEV ? '当前为开发模式。离线重新打开页面，请使用 npm run build 后的预览版本。' : navigator.serviceWorker?.controller ? '离线页面已就绪，可以断网刷新和重新打开。' : '离线页面尚未就绪，请保持联网后重新打开此设置确认。'}</p>
        <button className="text-link" onClick={() => void run(async () => {
          const granted = await navigator.storage?.persist?.();
          setStorageStatus(granted ? '已获得持久存储许可，降低自动回收风险。仍建议定期导出。' : '浏览器暂未授予持久存储许可。数据仍会保存，请定期导出备份。');
        })}>申请浏览器持久存储</button>{storageStatus && <p className="field-help">{storageStatus}</p>}
      </div></section>
      <SyncSettings />
      <PwaSettings />
    </div>
    {confirm && pending && <ConfirmDialog title="确认替换全部本地数据？" confirmLabel="确认备份并替换" onClose={() => setConfirm(false)} busy={saving} onConfirm={() => {
      void run(async () => { await repo.replaceData(pending); return true; }, '导入完成，原内容已保存为本地备份').then((ok) => {
        if (ok) { setConfirm(false); setPending(null); onImported(); }
      });
    }}><p>当前 {data.tasks.length} 条任务、{data.scheduleBlocks.length} 段安排将被导入文件替换。请确认已下载需要保留的独立备份。</p><p>文件已通过结构、日期、重复 ID 和关联校验。此次操作会先保存原内容，再原子替换；失败将回滚。</p></ConfirmDialog>}
  </Dialog>;
}
