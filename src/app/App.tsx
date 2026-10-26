import { useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, ListTodo, Menu, Moon, PanelLeftClose, PanelRightClose, Plus, Settings2, Sun, WifiOff, X } from 'lucide-react';
import { useStore } from './Store';
import { IconButton } from '../components/Controls';
import { DateTimePopup } from '../components/DateTimePicker';
import { localDate } from '../domain/dates';
import { Calendar, viewNames } from '../features/calendar/Calendar';
import { BlockDialog, type BlockEditorState } from '../features/calendar/BlockDialog';
import { Sidebar } from '../features/lists/Lists';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { SyncStatusButton } from '../features/sync/SyncProvider';
import { MigrationNotice } from '../features/pwa/MigrationNotice';
import { TaskEditor, TasksPanel } from '../features/tasks/Tasks';
import type { ScheduleBlock, Settings } from '../domain/schema';
import type { TaskFilter } from '../domain/selectors';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const sync = () => setOnline(navigator.onLine); window.addEventListener('online', sync); window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); }; }, []);
  return online;
}

export default function App() {
  const { data, repo, run, saving, error, clearError, notice, undo, undoLast } = useStore();
  const calendarRef = useRef<FullCalendar>(null);
  const [initialView] = useState<Settings['defaultView']>(() => window.matchMedia('(max-width: 700px)').matches ? 'day' : data.settings.defaultView);
  const [view, setView] = useState<Settings['defaultView']>(initialView);
  const [dateTitle, setDateTitle] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('incomplete');
  const [taskId, setTaskId] = useState<string | 'new' | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | undefined>();
  const [blockEditor, setBlockEditor] = useState<BlockEditorState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string>();
  const [jumpDate, setJumpDate] = useState<string | null>(null);
  const [mobileLists, setMobileLists] = useState(false);
  const [mobileTasks, setMobileTasks] = useState(false);
  const [mobileView, setMobileView] = useState<'calendar' | 'tasks'>('calendar');
  const online = useOnline();
  const [offlineShell, setOfflineShell] = useState(() => Boolean(navigator.serviceWorker?.controller));
  const [cacheFailed, setCacheFailed] = useState(false);
  const [systemDark, setSystemDark] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = data.settings.theme === 'dark' || (data.settings.theme === 'system' && systemDark);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const ready = () => setOfflineShell(Boolean(navigator.serviceWorker?.controller));
    const failed = () => setCacheFailed(true);
    navigator.serviceWorker?.addEventListener('controllerchange', ready);
    window.addEventListener('offline-cache-failed', failed);
    return () => { navigator.serviceWorker?.removeEventListener('controllerchange', ready); window.removeEventListener('offline-cache-failed', failed); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => {
    if (!saving) return;
    const protectPendingWrite = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectPendingWrite);
    return () => window.removeEventListener('beforeunload', protectPendingWrite);
  }, [saving]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const change = () => { if (query.matches) { calendarRef.current?.getApi().changeView(viewNames.day); setView('day'); } };
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => { if (listId && !data.lists.some((l) => l.id === listId)) setListId(null); }, [data.lists, listId]);

  const openTask = (id: string | 'new') => {
    setTaskId(id); setActiveBlockId(undefined); setMobileTasks(true);
    if (data.settings.tasksCollapsed) void run(() => repo.updateSettings({ tasksCollapsed: false }));
  };
  const onBlock = (block: ScheduleBlock, occurrence?: { seriesId: string; occurrenceDate: string }) => {
    setBlockEditor({ block, occurrence });
  };
  const selectList = (id: string | null) => { setListId(id); setTaskId(null); setFilter('incomplete'); };
  const closeTask = () => { setTaskId(null); setMobileTasks(false); };
  return <div className={`app ${data.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''} ${data.settings.tasksCollapsed ? 'tasks-collapsed' : ''} ${mobileView === 'tasks' ? 'mobile-task-view' : ''}`}>
    <header className="topbar"><div className="brand"><IconButton label="打开清单导航" className="mobile-only" onClick={() => setMobileLists(true)}><Menu size={21} /></IconButton>
      <div className="brand-mark">✦</div><div><strong>Polar<span> Schedule</span></strong><small>留一点时间，给重要的事</small></div></div>
      <div className="topbar-actions"><span className={`save-status ${error ? 'text-danger' : ''}`} role="status" title={import.meta.env.DEV ? '开发模式不缓存页面。离线刷新请使用生产构建。' : offlineShell ? '页面已缓存，支持离线重新打开' : cacheFailed ? '页面缓存失败，请联网重试；已打开页面仍可编辑本地数据' : '正在准备离线页面缓存'}>{online ? <CheckCheck size={15} /> : <WifiOff size={15} />}<span>{saving ? '正在保存…' : error ? '操作未保存，请重试' : online ? '已保存到本机' : '离线 · 本地可用'}</span></span>
        <IconButton label={dark ? '切换浅色模式' : '切换深色模式'} onClick={() => void run(() => repo.updateSettings({ theme: dark ? 'light' : 'dark' }))}>{dark ? <Sun size={19} /> : <Moon size={19} />}</IconButton>
        <SyncStatusButton onClick={() => { setSettingsSection('sync'); setSettingsOpen(true); }} />
        <IconButton label="设置与数据" onClick={() => { setSettingsSection(undefined); setSettingsOpen(true); }}><Settings2 size={19} /></IconButton></div></header>
    <aside className={`sidebar ${mobileLists ? 'mobile-open' : ''}`} aria-label="清单侧栏"><div className="mobile-sidebar-header"><strong>我的清单</strong><IconButton label="关闭清单导航" onClick={() => setMobileLists(false)}><X size={19} /></IconButton></div>
      <Sidebar selected={listId} onSelect={selectList} onClose={() => setMobileLists(false)} /></aside>
    {mobileLists && <button className="mobile-scrim" aria-label="关闭清单遮罩" onClick={() => setMobileLists(false)} />}
    <main className="main-content"><MigrationNotice onOpen={() => { setSettingsSection('data'); setSettingsOpen(true); }} /><div className="calendar-toolbar"><div className="date-area"><div className="calendar-eyebrow"><span className="list-dot" />{listId ? data.lists.find((l) => l.id === listId)?.title : '每一天，都有余地'}</div>
      <h1>{dateTitle || '我的日程'}</h1></div><div className="calendar-controls"><div className="date-navigation">
        <IconButton label="上一段日期" onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft size={18} /></IconButton><button className="today-button" onClick={() => calendarRef.current?.getApi().today()}>今天</button>
        <IconButton label="下一段日期" onClick={() => calendarRef.current?.getApi().next()}><ChevronRight size={18} /></IconButton>
        <button type="button" className="jump-date-button" aria-label="跳转日期" aria-haspopup="dialog" aria-expanded={Boolean(jumpDate)} title="选择日期，跳转到当天 / 所在周 / 所在月" onClick={() => setJumpDate(localDate(calendarRef.current?.getApi().getDate() ?? new Date()))}><CalendarDays size={14} /><span>跳转</span></button></div>
        <div className="view-switch" role="group" aria-label="日历视图">{(['day', 'week', 'month'] as const).map((key) => <button key={key} aria-pressed={view === key} className={view === key ? 'active' : ''}
          onClick={() => { calendarRef.current?.getApi().changeView(viewNames[key]); setView(key); }}>{key === 'day' ? '日' : key === 'week' ? '周' : '月'}</button>)}</div>
        <button className="button primary new-event" onClick={() => setBlockEditor({})}><Plus size={17} /><span>新建日程</span></button>
      </div></div>
      <div className="calendar-frame"><Calendar calendarRef={calendarRef} initialView={initialView} listId={listId}
        onTitle={(title, next) => { setDateTitle(title); setView(next); }} onSelect={(selection) => setBlockEditor({ selection })} onBlock={onBlock} />
      </div><footer className="calendar-footer"><span>点击空白处安排时间 · 支持重叠与跨日</span><div className="layout-buttons">
        <IconButton label={data.settings.sidebarCollapsed ? '展开清单侧栏' : '折叠清单侧栏'} disabled={saving} onClick={() => void run(() => repo.updateSettings({ sidebarCollapsed: !data.settings.sidebarCollapsed }))}><PanelLeftClose size={16} /></IconButton>
        <IconButton label={data.settings.tasksCollapsed ? '展开待办侧栏' : '折叠待办侧栏'} disabled={saving} onClick={() => void run(() => repo.updateSettings({ tasksCollapsed: !data.settings.tasksCollapsed }))}><PanelRightClose size={16} /></IconButton></div></footer>
    </main>
    <aside className={`tasks-panel ${mobileTasks ? 'mobile-editor-open' : ''}`} aria-label="待办与详情">
      {taskId ? <TaskEditor key={taskId} taskId={taskId} defaultListId={listId} onClose={closeTask} onSaved={(id) => { setTaskId(id); }} activeBlockId={activeBlockId}
        onSchedule={(id) => setBlockEditor({ taskId: id })} onBlock={(block) => setBlockEditor({ block })} /> :
        <TasksPanel listId={listId} filter={filter} onFilter={setFilter} onEdit={openTask} onSchedule={(id) => setBlockEditor({ taskId: id })} />}
    </aside>
    <nav className="mobile-bottom-nav" aria-label="主要页面"><button className={mobileView === 'calendar' ? 'active' : ''} onClick={() => { setMobileView('calendar'); closeTask(); }}><CalendarDays size={20} />日程</button>
      <button className="mobile-create" aria-label="快速新建任务" onClick={() => { setMobileView('tasks'); openTask('new'); }}><Plus size={23} /></button>
      <button className={mobileView === 'tasks' ? 'active' : ''} onClick={() => { setMobileView('tasks'); closeTask(); }}><ListTodo size={20} />待办</button></nav>
    {(error || notice) && <div className={`toast ${error ? 'error-toast' : ''}`} role={error ? 'alert' : 'status'}><span>{error ?? notice}</span>{error && <IconButton label="关闭提示" onClick={clearError}><X size={16} /></IconButton>}</div>}
    {undo && <div className="undo-toast" role="status"><span>{undo.label} · 30 秒内可撤销</span><button type="button" disabled={saving} onClick={() => void undoLast()}>撤销删除</button></div>}
    {blockEditor && <BlockDialog key={`${blockEditor.block?.id ?? blockEditor.taskId ?? 'new'}:${blockEditor.occurrence?.occurrenceDate ?? blockEditor.selection?.start ?? ''}`} editor={blockEditor} onClose={() => setBlockEditor(null)} onTask={(id, blockId) => {
      setBlockEditor(null); openTask(id); setActiveBlockId(blockId);
    }} />}
    {settingsOpen && <SettingsDialog initialSection={settingsSection} onClose={() => setSettingsOpen(false)} onImported={() => { selectList(null); closeTask(); }} />}
    {jumpDate && <DateTimePopup label="跳转日期" value={jumpDate} dateOnly manualInput allowMonth={view === 'month'} confirmLabel="跳转"
      onClose={() => setJumpDate(null)} onConfirm={(date) => { calendarRef.current?.getApi().gotoDate(date); setJumpDate(null); }} />}
  </div>;
}
