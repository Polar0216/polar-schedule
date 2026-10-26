import { useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarPlus, Check, ChevronRight, Clock3, Flag, GripVertical, ListTodo, Plus, Search, SlidersHorizontal, Tags, Trash2 } from 'lucide-react';
import { useStore } from '../../app/Store';
import { ConfirmDialog, IconButton } from '../../components/Controls';
import { DateTimePicker } from '../../components/DateTimePicker';
import { formatInstant, isDateOnly, localDate } from '../../domain/dates';
import { INBOX_ID, type ScheduleBlock, type Subtask, type Task, type TaskInput } from '../../domain/schema';
import { filterLabels, priorityLabels, selectTasks, statusLabels, type TaskFilter } from '../../domain/selectors';
import { useTaskDrag } from '../../hooks/useTaskDrag';
import { TagsDialog } from './TagsDialog';
import './tasks.css';

export function TasksPanel({ listId, filter, onFilter, onEdit, onSchedule }: {
  listId: string | null; filter: TaskFilter; onFilter: (value: TaskFilter) => void;
  onEdit: (id: string | 'new') => void; onSchedule: (id: string) => void;
}) {
  const { data, repo, run } = useStore();
  const dragRef = useTaskDrag(data.settings.defaultDurationMinutes);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [scope, setScope] = useState('all');
  const [scopeChanged, setScopeChanged] = useState(false);
  const [tagId, setTagId] = useState('');
  const [status, setStatus] = useState<Task['status'] | 'all'>('all');
  const [dueAfter, setDueAfter] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(true);
  const invalidDueAfter = Boolean(dueAfter && !isDateOnly(dueAfter));
  const invalidDueBefore = Boolean(dueBefore && !isDateOnly(dueBefore));
  const refined = Boolean(query.trim() || tagId || status !== 'all' || dueAfter || dueBefore || scopeChanged || includeArchived);
  const selectedScope = !refined || scope === 'current' ? listId : scope === 'all' ? null : scope;
  const tasks = selectTasks(data, selectedScope, filter, refined ? {
    query, tagId, status, dueAfter: invalidDueAfter ? '' : dueAfter, dueBefore: invalidDueBefore ? '' : dueBefore, includeArchived, includeHidden,
  } : undefined);
  const resetSearch = () => {
    setQuery(''); setScope('all'); setScopeChanged(false); setTagId(''); setStatus('all');
    setDueAfter(''); setDueBefore(''); setIncludeArchived(false); setIncludeHidden(true);
  };
  const scheduled = new Map<string, number>();
  const completedScheduled = new Map<string, number>();
  data.scheduleBlocks.forEach((b) => { if (b.type === 'task') {
    scheduled.set(b.taskId, (scheduled.get(b.taskId) ?? 0) + 1);
    if (b.executionStatus === 'completed') completedScheduled.set(b.taskId, (completedScheduled.get(b.taskId) ?? 0) + 1);
  } });
  const listTitle = data.lists.find((l) => l.id === listId)?.title;
  return <>
    <div className="tasks-heading"><div><span className="eyebrow">把想法变成行动</span><h2>{refined ? '搜索结果' : listTitle ?? '我的待办'}<span>{tasks.length}</span></h2></div>
      <div className="tasks-heading-actions"><IconButton label="标签管理" onClick={() => setShowTags(true)}><Tags size={17} /></IconButton>
        <IconButton label="新建任务" className="tinted" onClick={() => onEdit('new')}><Plus size={19} /></IconButton></div></div>
    <div className="task-filters"><label className="sr-only" htmlFor="task-filter">任务筛选</label><select id="task-filter" value={filter} onChange={(e) => { onFilter(e.target.value as TaskFilter); setStatus('all'); }}>
      {(Object.keys(filterLabels) as TaskFilter[]).map((key) => <option key={key} value={key}>{filterLabels[key]}</option>)}</select>
      <span className="subtle">按清单顺序</span></div>
    <div className="task-search"><div className="task-search-row"><label className="task-search-field"><Search size={15} aria-hidden="true" /><span className="sr-only">搜索任务</span>
      <input type="search" aria-label="搜索任务" placeholder="跨清单搜索标题和描述" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <button type="button" className="icon-button" title="搜索筛选" aria-label="搜索筛选" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={16} /></button></div>
      {showFilters && <div className="task-search-options">
        <label className="search-scope">搜索清单<select aria-label="搜索清单" value={scope} onChange={(e) => { setScope(e.target.value); setScopeChanged(true); }}>
          <option value="all">所有清单</option><option value="current">当前选中的清单范围</option>
          {[...data.lists].sort((a, b) => a.order - b.order).filter((l) => (includeArchived || !l.archived) && (includeHidden || !data.settings.hiddenListIds.includes(l.id))).map((l) => <option key={l.id} value={l.id}>{l.title}{l.archived ? '（已归档）' : ''}</option>)}
        </select></label>
        <label>任务状态<select aria-label="搜索任务状态" value={status} onChange={(e) => { setStatus(e.target.value as Task['status'] | 'all'); onFilter('all'); }}>
          <option value="all">沿用上方筛选</option><option value="todo">待办</option><option value="in_progress">进行中</option><option value="done">已完成</option></select></label>
        <label>标签<select aria-label="筛选标签" value={tagId} onChange={(e) => setTagId(e.target.value)}><option value="">所有标签</option>{data.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.title}</option>)}</select></label>
        <DateTimePicker label="截止日期从" dateOnly required={false} value={dueAfter} onChange={setDueAfter} />
        <DateTimePicker label="截止日期至" dateOnly required={false} value={dueBefore} onChange={setDueBefore} />
        {(invalidDueAfter || invalidDueBefore) && <p className="validation-error" role="alert">请输入有效截止日期 YYYY-MM-DD；无效日期暂不参与筛选。</p>}
        <label className="search-checkbox"><input type="checkbox" checked={includeHidden} onChange={(e) => { setIncludeHidden(e.target.checked); setScopeChanged(true); setScope('all'); }} />包含隐藏清单</label>
        <label className="search-checkbox"><input type="checkbox" checked={includeArchived} onChange={(e) => { setIncludeArchived(e.target.checked); setScopeChanged(true); setScope('all'); }} />包含归档清单</label>
      </div>}
      {refined && <p className="search-summary" role="status">{selectedScope ? '指定清单' : '跨清单'} · {includeHidden ? '含隐藏清单' : '不含隐藏清单'} · {includeArchived ? '含归档清单' : '不含归档清单'}
        <button type="button" className="search-reset" onClick={resetSearch}>清除搜索筛选</button>{dueAfter && dueBefore && !invalidDueAfter && !invalidDueBefore && dueAfter > dueBefore && <span> · 截止日期范围无效</span>}</p>}
    </div>
    <div className="tasks-scroll" ref={dragRef}>
      {tasks.length === 0 ? <div className="task-empty"><div className="empty-icon"><ListTodo size={28} /></div><h3>{refined ? '没有匹配的任务' : filter === 'completed' ? '还没有完成的任务' : '给下一步留个位置'}</h3>
        <p>{refined ? '没有符合当前搜索与筛选条件的任务，可清除筛选后查看。' : filter === 'unscheduled' ? '所有待办都已有时间安排，或尚未创建任务。' : '在这里记下待办，再安排到合适的时间。'}</p>
        <button className="button secondary" onClick={() => onEdit('new')}><Plus size={16} />添加任务</button></div> : tasks.map((task) => {
        const list = data.lists.find((l) => l.id === task.listId)!;
        const blockCount = scheduled.get(task.id) ?? 0;
        return <article key={task.id} className={`task-card ${task.status === 'done' ? 'is-done' : ''}`} data-testid="task-card" data-task-id={task.id}>
          <div className="task-card-main"><button className={`task-check ${task.status === 'done' ? 'checked' : ''}`} aria-label={`${task.status === 'done' ? '撤销完成' : '完成任务'} ${task.title}`} title={task.status === 'done' ? '撤销整个任务完成' : '完成整个任务'}
            onClick={() => void run(() => repo.setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done'))}>{task.status === 'done' && <Check size={13} />}</button>
            <button className="task-title" onClick={() => onEdit(task.id)}>{task.title}</button>
            <span className="drag-handle" role="img" aria-label={`拖动安排 ${task.title}`} title="拖动此手柄到日历，可重复安排" data-task-id={task.id} data-task-title={task.title}><GripVertical size={16} /></span></div>
          <div className="task-meta"><span className="list-dot" style={{ background: list.color }} /><span>{list.title}</span>
            {task.priority !== 'none' && <span className={`priority priority-${task.priority}`}><Flag size={11} />{priorityLabels[task.priority]}</span>}
            <span className="task-parent-state">整个任务 · {statusLabels[task.status]}</span></div>
          {blockCount > 0 && <p className="task-execution-progress">安排完成 {completedScheduled.get(task.id) ?? 0}/{blockCount}</p>}
          {task.subtasks.length > 0 && <p className="subtask-progress">子任务 {task.subtasks.filter((item) => item.done).length}/{task.subtasks.length}</p>}
          {task.tagIds.length > 0 && <div className="task-tags">{task.tagIds.map((id) => data.tags.find((tag) => tag.id === id)).filter((tag) => tag !== undefined).map((tag) => <span className="tag-chip" key={tag.id}><span className="list-dot" style={{ background: tag.color }} />{tag.title}</span>)}</div>}
          <div className="task-card-footer"><span className={`due-date ${task.dueDate && task.dueDate < localDate() && task.status !== 'done' ? 'overdue' : ''}`}>
            {task.dueDate ? `${task.dueDate.slice(5).replace('-', '/')} 截止` : blockCount ? `${blockCount} 段安排` : '尚未安排时间'}</span>
            <button onClick={() => onSchedule(task.id)} aria-label={`安排时间 ${task.title}`}><CalendarPlus size={13} />安排</button></div>
        </article>;
      })}
      {tasks.length > 0 && <button className="quick-add" onClick={() => onEdit('new')}><Plus size={16} />添加任务</button>}
    </div>
    <div className="panel-tip"><GripVertical size={15} /><span>拖动手柄到日历，或点击「安排」</span></div>
    {showTags && <TagsDialog onClose={() => setShowTags(false)} />}
  </>;
}

export function TaskEditor({ taskId, defaultListId, onClose, onSaved, onSchedule, onBlock, activeBlockId }: {
  taskId: string | 'new'; defaultListId: string | null; onClose: () => void; onSaved: (id: string) => void;
  onSchedule: (taskId: string) => void; onBlock: (block: ScheduleBlock) => void; activeBlockId?: string;
}) {
  const { data, repo, run, saving } = useStore();
  const task = data.tasks.find((t) => t.id === taskId);
  const [form, setForm] = useState<TaskInput>(() => ({ title: task?.title ?? '', description: task?.description ?? '',
    listId: task?.listId ?? (data.lists.find((l) => l.id === defaultListId && !l.archived)?.id ?? INBOX_ID),
    dueDate: task?.dueDate, status: task?.status ?? 'todo', priority: task?.priority ?? 'none',
    subtasks: [...(task?.subtasks ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), tagIds: task?.tagIds ?? [] }));
  const [confirm, setConfirm] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const linked = data.scheduleBlocks.filter((b): b is Extract<ScheduleBlock, { type: 'task' }> => b.type === 'task' && b.taskId === taskId).sort((a, b) =>
    (a.allDay ? a.startDate : a.startAt).localeCompare(b.allDay ? b.startDate : b.startAt));
  const completedExecutions = linked.filter((block) => block.executionStatus === 'completed').length;
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const subtasks = form.subtasks ?? [];
  const changeSubtask = (id: string, values: Partial<Pick<Subtask, 'title' | 'done'>>) => {
    update('subtasks', subtasks.map((item) => item.id === id ? { ...item, ...values } : item));
  };
  const addSubtask = () => {
    if (!subtaskTitle.trim()) return;
    update('subtasks', [...subtasks, { id: crypto.randomUUID(), title: subtaskTitle.trim(), done: false, order: subtasks.length }]);
    setSubtaskTitle('');
  };
  const reorderSubtask = (index: number, direction: -1 | 1) => {
    const next = [...subtasks]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update('subtasks', next.map((item, order) => ({ ...item, order })));
  };
  const save = async () => {
    if (!formRef.current?.reportValidity()) return undefined;
    const id = await run(() => repo.saveTask({ ...form,
      tagIds: (form.tagIds ?? []).filter((id) => data.tags.some((tag) => tag.id === id)),
    }, task?.id), '任务已保存');
    if (id) onSaved(id);
    return id;
  };
  if (taskId !== 'new' && !task) return <div className="task-empty"><h3>此任务已被删除</h3><button className="button secondary" onClick={onClose}>返回待办</button></div>;
  return <>
    <div className="editor-heading"><IconButton label="返回待办" onClick={onClose}><ArrowLeft size={19} /></IconButton><h2>{task ? '任务详情' : '新建任务'}</h2>
      {task && <IconButton label="删除任务" onClick={() => setConfirm(true)}><Trash2 size={17} /></IconButton>}</div>
    <div className="editor-scroll task-editor-scroll"><form ref={formRef} className="form-stack task-form compact-task-form" onSubmit={(e) => { e.preventDefault(); void save(); }}
      onInvalidCapture={(e) => { if (e.target instanceof HTMLElement) e.target.closest('details')?.setAttribute('open', ''); }}>
      <label>任务标题<input aria-label="任务标题" placeholder="想完成什么？" required maxLength={200} value={form.title} onChange={(e) => update('title', e.target.value)} autoFocus /></label>
      <div className="task-primary-meta"><label>整个任务状态<select aria-label="任务状态" value={form.status} onChange={(e) => update('status', e.target.value as Task['status'])}>
        <option value="todo">待办</option><option value="in_progress">进行中</option><option value="done">已完成</option></select></label>
        <DateTimePicker label="截止日期" value={form.dueDate ?? ''} dateOnly required={false} onChange={(value) => update('dueDate', value || undefined)} /></div>
      <p className="field-help task-state-help">截止日期属于整个任务；每次执行安排分别勾选完成。</p>
      <div className="form-actions task-primary-actions"><button className="button primary grow" disabled={saving}>保存任务</button>
        <button type="button" className="button secondary" disabled={saving || !form.title.trim()} onClick={() => void save().then((id) => { if (id) onSchedule(id); })}><CalendarPlus size={15} />保存并安排时间</button></div>
      <section className="linked-section task-executions" aria-label="任务执行安排">
        <div className="section-heading"><h3>执行安排</h3><span className="execution-count" aria-label={`已完成安排 ${completedExecutions}/${linked.length}`}>{completedExecutions}/{linked.length} 已完成</span></div>
        {linked.length === 0 ? <p className="field-help">{task ? '还没有执行安排，点击上方「保存并安排时间」添加。' : '保存后可安排多个时间段，每段独立记录完成状态。'}</p> : linked.map((block, index) => {
          const completed = block.executionStatus === 'completed';
          const start = block.allDay ? `${block.startDate} · 全天` : formatInstant(block.startAt);
          return <div className={`execution-row ${completed ? 'is-completed' : ''} ${activeBlockId === block.id ? 'active' : ''}`} key={block.id} data-block-id={block.id}>
            <button type="button" className={`task-check execution-check ${completed ? 'checked' : ''}`} aria-label={`${completed ? '撤销完成本次安排' : '完成本次安排'} 第${index + 1}段 ${start}`}
              aria-pressed={completed} disabled={saving} onClick={() => void run(() => repo.setBlockCompleted(block.id, !completed), completed ? '本次安排已恢复待执行' : '本次安排已完成')}>
              {completed && <Check size={14} />}</button>
            <button type="button" className="linked-block" aria-label={`编辑第${index + 1}段安排 ${start}`} onClick={() => onBlock(block)}>
              <Clock3 size={15} /><span><small className="execution-state">第 {index + 1} 段 · {completed ? '本次已完成' : '本次待执行'}</small>{start}<small>{block.allDay ? `结束于 ${block.endDate}（不含）` : `至 ${formatInstant(block.endAt)}`}</small></span><ChevronRight size={15} />
            </button>
          </div>;
        })}
        {linked.length > 0 && <p className="field-help execution-help">点击时段修改本次安排；勾选只记录这一次，整个任务状态不变。</p>}
        {form.status === 'done' && completedExecutions < linked.length && <p className="task-pending-note">整个任务设为已完成，仍有 {linked.length - completedExecutions} 段安排待执行。每段记录会保留。</p>}
      </section>
      <details className="task-detail-group"><summary><span>描述与任务属性</span><span className="detail-summary-value">{data.lists.find((list) => list.id === form.listId)?.title}<ChevronRight size={15} /></span></summary>
        <div className="task-detail-content">
          <label>描述<textarea aria-label="任务描述" rows={3} maxLength={20000} placeholder="写下想法、步骤或备注…" value={form.description} onChange={(e) => update('description', e.target.value)} /></label>
          <label>所属清单<select aria-label="所属清单" value={form.listId} onChange={(e) => update('listId', e.target.value)}>
            {[...data.lists].sort((a, b) => a.order - b.order).filter((l) => !l.archived || l.id === form.listId).map((l) => <option key={l.id} value={l.id}>{l.title}{l.archived ? '（已归档）' : ''}</option>)}</select></label>
          <label>优先级<select aria-label="优先级" value={form.priority} onChange={(e) => update('priority', e.target.value as Task['priority'])}>
            {(Object.keys(priorityLabels) as Task['priority'][]).map((p) => <option key={p} value={p}>{priorityLabels[p]}</option>)}</select></label>
          {task && <div className="task-sort"><span>任务顺序</span><IconButton label="任务上移" onClick={() => void run(() => repo.reorderTask(task.id, -1))}><ArrowUp size={16} /></IconButton>
            <IconButton label="任务下移" onClick={() => void run(() => repo.reorderTask(task.id, 1))}><ArrowDown size={16} /></IconButton></div>}
        </div>
      </details>
      <details className="task-detail-group"><summary><span>标签</span><span className="detail-summary-value">{(form.tagIds ?? []).filter((id) => data.tags.some((tag) => tag.id === id)).length} 个<ChevronRight size={15} /></span></summary>
        <fieldset className="task-tags-field task-detail-content"><legend className="sr-only">任务标签</legend><div className="task-tags-heading"><span className="field-help">可选择多个标签</span><button type="button" onClick={() => setShowTags(true)}>管理标签</button></div>
        <div className="task-tag-options">{data.tags.map((tag) => <label className="tag-chip" key={tag.id}><input type="checkbox" aria-label={`任务标签 ${tag.title}`}
          checked={(form.tagIds ?? []).includes(tag.id)} onChange={(e) => update('tagIds', e.target.checked ? [...(form.tagIds ?? []), tag.id] : (form.tagIds ?? []).filter((id) => id !== tag.id))} />
          <span className="list-dot" style={{ background: tag.color }} />{tag.title}</label>)}</div>
        {data.tags.length === 0 && <p className="field-help">暂无标签，可点击「管理标签」创建。</p>}
        </fieldset>
      </details>
      <details className="task-detail-group"><summary><span>子任务</span><span className="detail-summary-value">{subtasks.filter((item) => item.done).length}/{subtasks.length}<ChevronRight size={15} /></span></summary>
        <section className="subtask-editor task-detail-content" aria-label="子任务">
        <p className="field-help">父任务由你手动完成。子任务随任务保存，不会自动生成日历安排。</p>
        <ol className="subtask-list">{subtasks.map((item, index) => <li key={item.id}>
          <input type="checkbox" aria-label={`${item.done ? '撤销完成子任务' : '完成子任务'} ${item.title}`} checked={item.done} onChange={(e) => changeSubtask(item.id, { done: e.target.checked })} />
          <input type="text" className={item.done ? 'subtask-done' : ''} aria-label={`子任务标题 ${index + 1}`} required maxLength={200} value={item.title} onChange={(e) => changeSubtask(item.id, { title: e.target.value })} />
          <span className="subtask-actions"><IconButton label={`子任务上移 ${item.title}`} disabled={index === 0} onClick={() => reorderSubtask(index, -1)}><ArrowUp size={13} /></IconButton>
            <IconButton label={`子任务下移 ${item.title}`} disabled={index === subtasks.length - 1} onClick={() => reorderSubtask(index, 1)}><ArrowDown size={13} /></IconButton>
            <IconButton label={`删除子任务 ${item.title}`} onClick={() => update('subtasks', subtasks.filter((subtask) => subtask.id !== item.id).map((subtask, order) => ({ ...subtask, order })))}><Trash2 size={13} /></IconButton></span>
        </li>)}</ol>
        <div className="subtask-add"><input aria-label="新子任务" maxLength={200} placeholder="写下一个具体步骤" value={subtaskTitle} onChange={(e) => setSubtaskTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }} />
          <IconButton label="添加子任务" disabled={!subtaskTitle.trim() || subtasks.length >= 1000} onClick={addSubtask}><Plus size={17} /></IconButton></div>
        </section>
      </details>
    </form></div>
    {confirm && task && <ConfirmDialog title="删除这条任务？" onClose={() => setConfirm(false)} busy={saving} onConfirm={() => void run(async () => { await repo.deleteTask(task.id, true); return true; }, '任务与关联安排已删除').then((ok) => { if (ok) onClose(); })}>
      <p>「{task.title}」将被删除{linked.length > 0 ? `，同时移除 ${linked.length} 段关联安排` : ''}。操作前可在设置中导出备份。</p></ConfirmDialog>}
    {showTags && <TagsDialog onClose={() => setShowTags(false)} />}
  </>;
}
