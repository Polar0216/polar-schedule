import { useEffect, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, Briefcase, Code2, Coffee, Eye, EyeOff, Heart, Inbox, Layers3, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react';
import { useStore } from '../../app/Store';
import { ConfirmDialog, Dialog, IconButton } from '../../components/Controls';
import { COLOR_PRESETS, ColorPicker } from '../../components/ColorPicker';
import { INBOX_ID, type List } from '../../domain/schema';

export const palette = COLOR_PRESETS;
export const iconMap = { inbox: Inbox, book: BookOpen, code: Code2, heart: Heart, coffee: Coffee, star: Star, briefcase: Briefcase };
const iconLabels: Record<List['icon'], string> = { inbox: '收纳', book: '学习', code: '代码', heart: '生活', coffee: '休闲', star: '星标', briefcase: '工作' };

export function ListIcon({ list, size = 17 }: { list: List; size?: number }) {
  const Icon = iconMap[list.icon];
  return <Icon size={size} style={{ color: list.color }} aria-hidden="true" />;
}

export function Sidebar({ selected, onSelect, onClose }: {
  selected: string | null; onSelect: (id: string | null) => void; onClose: () => void;
}) {
  const { data, repo, run, saving, error } = useStore();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const [editing, setEditing] = useState<List | 'new' | null>(null);
  const [archived, setArchived] = useState(false);
  const lists = [...data.lists].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const choose = (id: string | null) => { onSelect(id); onClose(); };
  const count = (id?: string) => data.tasks.filter((t) => (!id || t.listId === id) && t.status !== 'done').length;
  return <>
    <div className="sidebar-top"><span className="eyebrow">工作空间</span></div>
    <nav aria-label="清单导航" className="list-nav">
      <button className={`list-row all-lists ${selected === null ? 'selected' : ''}`} onClick={() => choose(null)}><Layers3 size={18} />
        <span>全部日程</span><span className="count">{count()}</span></button>
      <div className="section-heading"><span>我的清单</span><IconButton label="新建清单" onClick={() => setEditing('new')}><Plus size={16} /></IconButton></div>
      {lists.filter((l) => !l.archived).map((list) => <div key={list.id} className={`list-row-wrap ${selected === list.id ? 'selected' : ''}`}>
        <button className={`list-row ${data.settings.hiddenListIds.includes(list.id) ? 'muted-list' : ''}`} onClick={() => choose(list.id)}>
          <ListIcon list={list} /><span>{list.title}</span><span className="count">{count(list.id)}</span></button>
        <IconButton label={`管理清单 ${list.title}`} className="list-more" onClick={() => setEditing(list)}><MoreHorizontal size={16} /></IconButton>
      </div>)}
      <button className="add-list" onClick={() => setEditing('new')}><Plus size={16} />新建清单</button>
      {lists.some((l) => l.archived) && <>
        <button className="archive-toggle" onClick={() => setArchived(!archived)} aria-expanded={archived}><Archive size={15} />已归档清单<span>{lists.filter((l) => l.archived).length}</span></button>
        {archived && lists.filter((l) => l.archived).map((list) => <div className="list-row-wrap" key={list.id}>
          <button className="list-row muted-list" onClick={() => choose(list.id)}><ListIcon list={list} /><span>{list.title}</span></button>
          <IconButton label={`管理清单 ${list.title}`} onClick={() => setEditing(list)}><MoreHorizontal size={16} /></IconButton></div>)}
      </>}
    </nav>
    <div className="sidebar-bottom"><div className="local-note" role="status"><span className="status-dot" /><span>{saving ? '正在保存…' : error ? '操作未保存，请重试' : online ? '已保存到本机' : '离线 · 本地可用'}</span></div></div>
    {editing && <ListDialog list={editing === 'new' ? undefined : data.lists.find((l) => l.id === editing.id)} onClose={() => setEditing(null)}
      onDelete={() => { if (editing !== 'new' && selected === editing.id) onSelect(null); }}
      onVisibility={(id) => void run(() => repo.toggleListVisibility(id))} />}
  </>;
}

function ListDialog({ list, onClose, onDelete, onVisibility }: {
  list?: List; onClose: () => void; onDelete: () => void; onVisibility: (id: string) => void;
}) {
  const { data, repo, run, saving } = useStore();
  const [title, setTitle] = useState(list?.title ?? '');
  const [color, setColor] = useState(list?.color ?? palette[0]);
  const [icon, setIcon] = useState<List['icon']>(list?.icon ?? 'book');
  const [confirm, setConfirm] = useState(false);
  const isInbox = list?.id === INBOX_ID;
  const taskCount = data.tasks.filter((t) => t.listId === list?.id).length;
  return <Dialog title={list ? '管理清单' : '新建清单'} onClose={onClose}>
    <form className="dialog-body form-stack" onSubmit={(e) => { e.preventDefault(); void run(() => repo.saveList({ title, color, icon }, list?.id), '清单已保存').then((id) => { if (id) onClose(); }); }}>
      <label>清单名称<input aria-label="清单名称" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} readOnly={isInbox} autoFocus /></label>
      <ColorPicker label="清单颜色" value={color} onChange={setColor} disabled={saving} />
      <fieldset><legend>清单图标</legend><div className="icon-options">{(Object.keys(iconMap) as List['icon'][]).map((key) => {
        const Icon = iconMap[key];
        return <button type="button" key={key} className={icon === key ? 'active' : ''} aria-label={`图标 ${iconLabels[key]}`} aria-pressed={icon === key} onClick={() => setIcon(key)}><Icon size={20} /></button>;
      })}</div></fieldset>
      {list && <div className="list-management"><div><span>清单顺序</span><div className="button-group">
        <IconButton label="清单上移" disabled={saving} onClick={() => void run(() => repo.reorderList(list.id, -1))}><ArrowUp size={17} /></IconButton>
        <IconButton label="清单下移" disabled={saving} onClick={() => void run(() => repo.reorderList(list.id, 1))}><ArrowDown size={17} /></IconButton></div></div>
        <button type="button" onClick={() => onVisibility(list.id)}>{data.settings.hiddenListIds.includes(list.id) ? <Eye size={17} /> : <EyeOff size={17} />}
          {data.settings.hiddenListIds.includes(list.id) ? '显示清单与安排' : '从总览隐藏此清单'}</button>
        {!isInbox && <button type="button" onClick={() => void run(async () => { await repo.archiveList(list.id, !list.archived); return true; }, list.archived ? '清单已恢复' : '清单已归档').then((ok) => { if (ok) onClose(); })}>
          <Archive size={17} />{list.archived ? '恢复清单' : '归档清单'}</button>}
        {!isInbox && <button type="button" className="text-danger" onClick={() => setConfirm(true)}><Trash2 size={17} />删除清单</button>}
      </div>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>保存清单</button></div>
    </form>
    {confirm && list && <ConfirmDialog title={`删除「${list.title}」？`} onClose={() => setConfirm(false)} busy={saving} confirmLabel="迁移任务并删除清单"
      onConfirm={() => void run(async () => { await repo.deleteList(list.id); return true; }, '任务已迁移到收集箱').then((ok) => { if (ok) { onDelete(); onClose(); } })}>
      <p>{taskCount > 0 ? `${taskCount} 条任务将移到收集箱，所有已安排的时间块都会保留。` : '此清单没有任务。删除后可通过备份恢复。'}</p></ConfirmDialog>}
  </Dialog>;
}
