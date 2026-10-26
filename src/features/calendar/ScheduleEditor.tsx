import { useState } from 'react';
import { CalendarDays, Check, Trash2 } from 'lucide-react';
import { useStore } from '../../app/Store';
import { ConfirmDialog, Dialog } from '../../components/Controls';
import { DateTimePicker } from '../../components/DateTimePicker';
import { ColorPicker } from '../../components/ColorPicker';
import { addDays, browserTimeZone, defaultRange, fromLocalInput, isTimeZone, localDate, toLocalInput } from '../../domain/dates';
import { recurrenceSchema, type BlockInput, type RecurrenceRule, type ScheduleBlock, type TimeRange } from '../../domain/schema';
import { wallTimeToInstant, zonedLocalInput } from '../../domain/zonedTime';
import { palette } from '../lists/Lists';
import './block-form.css';

export interface CalendarSelection { start: string; end: string; allDay: boolean }
export interface BlockEditorState {
  block?: ScheduleBlock; taskId?: string; selection?: CalendarSelection;
  occurrence?: { seriesId: string; occurrenceDate: string };
}

export function BlockDialog({ editor, onClose, onTask }: { editor: BlockEditorState; onClose: () => void; onTask?: (taskId: string, blockId?: string) => void }) {
  const { data } = useStore();
  const [scope, setScope] = useState<'occurrence' | 'series'>(editor.occurrence ? 'occurrence' : 'series');
  const [path, setPath] = useState<'event' | 'task'>(editor.taskId ? 'task' : 'event');
  const [selectedTaskId, setSelectedTaskId] = useState(editor.taskId ?? data.tasks.find((t) => t.status !== 'done')?.id ?? data.tasks[0]?.id ?? '');
  const source = editor.occurrence && scope === 'series' ? data.scheduleBlocks.find((b) => b.id === editor.occurrence?.seriesId)
    : !editor.occurrence && editor.block ? data.scheduleBlocks.find((b) => b.id === editor.block?.id) ?? editor.block : editor.block;
  const taskId = source?.type === 'task' ? source.taskId : editor.taskId ?? (!source && path === 'task' ? selectedTaskId : undefined);
  const editable = { ...editor, block: source, taskId };
  const title = taskId ? editor.block ? '编辑任务安排' : '安排执行时间' : editor.occurrence || (source?.type === 'event' && source.recurrence) ? '编辑重复日程' : editor.block ? '编辑日程' : '新建日程';
  return <Dialog title={title} onClose={onClose}>
    {!editor.block && !editor.taskId && <div className="creation-path">
      <div role="group" aria-label="创建安排方式"><button type="button" aria-pressed={path === 'event'} onClick={() => setPath('event')}>新建日程</button>
        <button type="button" aria-pressed={path === 'task'} onClick={() => setPath('task')}>安排已有任务</button></div>
      {path === 'task' && <label>选择已有任务<select aria-label="选择已有任务" value={selectedTaskId} onChange={(e) => setSelectedTaskId(e.target.value)}>
        {!data.tasks.length && <option value="">请先在待办中新建任务</option>}
        {data.tasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {data.lists.find((list) => list.id === task.listId)?.title}{task.status === 'done' ? '（整个任务已完成）' : ''}</option>)}
      </select></label>}
    </div>}
    {editor.occurrence && <label className="scope-picker">编辑范围<select aria-label="编辑范围" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
      <option value="occurrence">仅本次（{editor.occurrence.occurrenceDate}）</option><option value="series">整个系列</option></select></label>}
    {!editor.occurrence && source?.type === 'event' && source.recurrence && <p className="scope-picker">当前编辑整个重复系列；已有单次例外会保留。</p>}
    {path === 'task' && !taskId && !source ? <p className="dialog-body field-help">任务表示要完成的事，安排表示执行它的某段时间。先创建待办，再在此选择；不会复制任务。</p>
      : <BlockForm key={scope} editor={editable} scope={scope} onClose={onClose} onTask={onTask} />}
  </Dialog>;
}

function BlockForm({ editor, scope, onClose, onTask }: { editor: BlockEditorState; scope: 'occurrence' | 'series'; onClose: () => void; onTask?: (taskId: string, blockId?: string) => void }) {
  const { data, repo, run, saving } = useStore();
  const { block, selection, occurrence } = editor;
  const taskId = block?.type === 'task' ? block.taskId : editor.taskId;
  const task = data.tasks.find((t) => t.id === taskId);
  const linked = data.scheduleBlocks.filter((b) => b.type === 'task' && b.taskId === taskId).sort((a, b) => (a.allDay ? a.startDate : a.startAt).localeCompare(b.allDay ? b.startDate : b.startAt) || a.id.localeCompare(b.id));
  const segment = linked.findIndex((b) => b.id === block?.id) + 1;
  const rule = block?.type === 'event' ? block.recurrence : undefined;
  const isOccurrence = Boolean(occurrence && scope === 'occurrence');
  const initialRange = defaultRange();
  const formatInput = (instant: string) => rule && !isOccurrence && block ? zonedLocalInput(instant, block.timeZone) : toLocalInput(instant);
  const [title, setTitle] = useState(block?.type === 'event' ? block.title : '');
  const [description, setDescription] = useState(block?.type === 'event' ? block.description : '');
  const [color, setColor] = useState(block?.color ?? palette[1]);
  const [allDay, setAllDay] = useState(block?.allDay ?? selection?.allDay ?? false);
  const [start, setStart] = useState(block && !block.allDay ? formatInput(block.startAt) : selection && !selection.allDay ? toLocalInput(selection.start) : initialRange.start);
  const [end, setEnd] = useState(block && !block.allDay ? formatInput(block.endAt) : selection && !selection.allDay ? toLocalInput(selection.end) : initialRange.end);
  const [startDate, setStartDate] = useState(block?.allDay ? block.startDate : selection?.allDay ? selection.start.slice(0, 10) : start.slice(0, 10));
  const [endDate, setEndDate] = useState(block?.allDay ? addDays(block.endDate, -1) : selection?.allDay ? addDays(selection.end.slice(0, 10), -1) : startDate);
  const [frequency, setFrequency] = useState<RecurrenceRule['frequency'] | 'none'>(rule?.frequency ?? 'none');
  const [interval, setInterval] = useState(rule?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays ?? [new Date(`${start.slice(0, 10)}T12:00:00Z`).getUTCDay()]);
  const [zone, setZone] = useState(rule && block ? block.timeZone : browserTimeZone());
  const [endMode, setEndMode] = useState<'never' | 'until' | 'count'>(rule?.until ? 'until' : rule?.count ? 'count' : 'never');
  const [until, setUntil] = useState(rule?.until ?? start.slice(0, 10));
  const [count, setCount] = useState(rule?.count ?? 12);
  const [validation, setValidation] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const repeating = !taskId && frequency !== 'none' && !isOccurrence;

  function getRange(): TimeRange {
    if (repeating && !isTimeZone(zone)) throw new Error('请输入有效 IANA 时区，例如 Asia/Shanghai');
    if (allDay) {
      if (endDate < startDate) throw new Error('结束日期不能早于开始日期');
      return { allDay: true, startDate, endDate: addDays(endDate, 1), timeZone: repeating ? zone : browserTimeZone() };
    }
    const convert = (value: string) => {
      if (!repeating) return fromLocalInput(value);
      const instant = wallTimeToInstant(value, zone);
      if (zonedLocalInput(instant, zone) !== value) throw new Error('该时刻处于夏令时跳时区间，请选择有效时间');
      return instant;
    };
    const startAt = convert(start); const endAt = convert(end);
    if (endAt <= startAt) throw new Error('结束时间必须晚于开始时间；跨日安排请同时修改日期');
    return { allDay: false, startAt, endAt, timeZone: repeating ? zone : browserTimeZone() };
  }

  function getRule(): RecurrenceRule | undefined {
    if (!repeating) return undefined;
    const durationMinutes = allDay ? Math.round((Date.parse(`${addDays(endDate, 1)}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 60000)
      : Math.round((Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60000);
    return recurrenceSchema.parse({ frequency, interval, weekdays: frequency === 'weekly' ? weekdays : [],
      startDate: allDay ? startDate : start.slice(0, 10), localTime: allDay ? '00:00' : start.slice(11, 16), durationMinutes,
      until: endMode === 'until' ? until : undefined, count: endMode === 'count' ? count : undefined });
  }

  const rangeDirty = Boolean(block && (allDay !== block.allDay || (allDay
    ? startDate !== (block.allDay ? block.startDate : '') || endDate !== (block.allDay ? addDays(block.endDate, -1) : '')
    : start !== (!block.allDay ? formatInput(block.startAt) : '') || end !== (!block.allDay ? formatInput(block.endAt) : ''))));

  function saveArrangement(afterSave?: (id: string) => void) {
    setValidation(null);
    try {
      if (taskId && !task) throw new Error('任务已被删除，请关闭此窗口');
      if (occurrence && !data.scheduleBlocks.some((item) => item.id === occurrence.seriesId && item.type === 'event' && item.recurrence)) {
        throw new Error('重复系列已被删除，请关闭此窗口');
      }
      const range = getRange();
      const input: BlockInput = taskId ? { ...range, type: 'task', taskId, color: block?.color } : { ...range, type: 'event', title, description, color,
        display: block?.type === 'event' ? block.display : 'normal', recurrence: getRule() };
      const operation = () => isOccurrence && occurrence ? repo.saveOccurrence(occurrence.seriesId, occurrence.occurrenceDate, input) : repo.saveBlock(input, block?.id);
      void run(operation, isOccurrence ? '已保存本次例外，其他日期不变' : '时间安排已保存').then((id) => { if (id) { if (afterSave) afterSave(id); else onClose(); } });
    } catch (error) { setValidation(error instanceof Error && error.name !== 'ZodError' ? error.message : '请检查重复星期、结束日期、次数与时长'); }
  }

  return <>
    <form className="schedule-editor-form" onSubmit={(e) => {
      e.preventDefault(); saveArrangement();
    }}>
      <div className="dialog-body form-stack schedule-editor-scroll">
      {taskId ? <section className="scheduled-task-quick">
        <div className="scheduled-task"><CalendarDays size={20} /><div><strong>{task?.title ?? '任务不存在'}</strong>
          <p>{data.lists.find((list) => list.id === task?.listId)?.title} · {segment ? `本次是第 ${segment} / ${linked.length} 段安排` : '新增一段执行时间'}</p></div></div>
        <div className="execution-status"><span>整个任务：{task?.status === 'done' ? '已完成' : task?.status === 'in_progress' ? '进行中' : '待办'}</span>
          {block?.type === 'task' && <button type="button" className={`button ${block.executionStatus === 'completed' ? 'secondary' : 'primary'}`} disabled={saving}
            onClick={() => void run(() => repo.setBlockCompleted(block.id, block.executionStatus !== 'completed'), block.executionStatus === 'completed' ? '已撤销本次完成' : '本次安排已完成；整个任务状态不变')}>
            <Check size={15} />{block.executionStatus === 'completed' ? '撤销本次完成' : '本次完成'}</button>}</div>
        <p className="field-help">本次安排与整个任务分别记录完成；修改执行时间不会改变任务截止日期。</p>
        {onTask && taskId && <div className="task-detail-links"><button type="button" disabled={saving} onClick={() => rangeDirty ? saveArrangement((id) => onTask(taskId, id)) : onTask(taskId, block?.id)}>{rangeDirty ? '保存并查看完整任务' : '查看完整任务'}</button>
          <button type="button" disabled={saving} onClick={() => rangeDirty ? saveArrangement((id) => onTask(taskId, id)) : onTask(taskId, block?.id)}>{rangeDirty ? '保存并修改任务属性' : '修改任务属性'}</button></div>}
      </section> :
        <label>日程标题<input aria-label="日程标题" value={title} required maxLength={200} autoFocus placeholder="为这段时间起个名字" onChange={(e) => setTitle(e.target.value)} /></label>}
      <label className="checkbox-label"><input type="checkbox" checked={allDay} aria-label="全天" onChange={(e) => {
        setAllDay(e.target.checked);
        if (e.target.checked) { setStartDate(start.slice(0, 10)); setEndDate(end.slice(0, 10)); }
        else { setStart(`${startDate}T09:00`); setEnd(`${endDate}T10:00`); }
      }} />全天安排</label>
      {allDay ? <div className="form-grid"><DateTimePicker label="开始日期" dateOnly value={startDate} onChange={setStartDate} />
        <DateTimePicker label="结束日期" dateOnly value={endDate} onChange={setEndDate} /></div> : <>
        <DateTimePicker label="开始时间" value={start} onChange={setStart} timeZone={repeating ? zone : browserTimeZone()} />
        <DateTimePicker label="结束时间" value={end} onChange={setEnd} timeZone={repeating ? zone : browserTimeZone()} />
        {start.slice(0, 10) !== end.slice(0, 10) && <p className="field-help">此安排跨越多个日期，日历将连续展示。</p>}
      </>}
      <p className="field-help">{allDay ? '全天按日期保存，不受时区转换影响。' : `输入时区：${repeating ? zone : browserTimeZone()} · 24 小时制`}</p>
      {!taskId && !isOccurrence && <section className="recurrence-fields"><label>重复频率<select aria-label="重复频率" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
        <option value="none" disabled={Boolean(rule)}>不重复</option><option value="daily">每天</option><option value="weekly">每周 / 指定星期</option><option value="monthly">每月同日</option></select></label>
        {repeating && <><div className="form-grid"><label>重复间隔<input type="number" min={1} max={365} required aria-label="重复间隔" value={interval} onChange={(e) => setInterval(Number(e.target.value))} /></label>
          <label>结束条件<select aria-label="重复结束条件" value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}><option value="never">一直重复</option><option value="until">到指定日期</option><option value="count">到指定次数</option></select></label></div>
          {frequency === 'weekly' && <fieldset><legend>重复星期（每 {interval} 周）</legend><div className="weekday-options">{[1, 2, 3, 4, 5, 6, 0].map((day) => <label key={day}>
            <input type="checkbox" aria-label={`重复${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day]}`} checked={weekdays.includes(day)} onChange={() => setWeekdays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])} />{['日', '一', '二', '三', '四', '五', '六'][day]}</label>)}</div></fieldset>}
          {endMode === 'until' && <DateTimePicker label="重复结束日期" dateOnly value={until} onChange={setUntil} />}
          {endMode === 'count' && <label>重复次数<input aria-label="重复次数" type="number" required min={1} max={100000} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>}
          <label>系列时区（IANA）<input aria-label="系列时区" required value={zone} onChange={(e) => setZone(e.target.value)} /></label>
          <p className="field-help">按当地钟点重复。缺少日期的月份跳过；夏令时跳时向后调整，回拨取较早一次。整系列修改保留单次例外；结束系列请设置结束日期或删除整个系列。</p>
        </>}
      </section>}
      {!taskId && <><label>备注<textarea aria-label="日程备注" rows={3} value={description} maxLength={20000} placeholder="地点或其他需要记住的事…" onChange={(e) => setDescription(e.target.value)} /></label>
        <ColorPicker label="日程颜色" value={color} onChange={setColor} disabled={saving} /></>}
      {validation && <p role="alert" className="validation-error">{validation}</p>}
      </div>
      <footer className="form-actions schedule-editor-footer">{block && <button type="button" className="button text-danger push-left" onClick={() => setConfirm(true)}><Trash2 size={15} />{isOccurrence ? '删除本次' : rule ? '删除整个系列' : '删除此安排'}</button>}
        <button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>保存安排</button></footer>
    </form>
    {confirm && block && <ConfirmDialog title={isOccurrence ? '删除本次安排？' : rule ? '删除整个重复系列？' : '删除这段安排？'} onClose={() => setConfirm(false)} busy={saving} onConfirm={() => void run(async () => {
      if (isOccurrence && occurrence) await repo.deleteOccurrence(occurrence.seriesId, occurrence.occurrenceDate);
      else await repo.deleteBlock(block.id);
      return true;
    }, isOccurrence ? '已取消本次，其他日期不变' : '安排已删除，30 秒内可撤销').then((ok) => { if (ok) onClose(); })}>
      <p>{isOccurrence ? '只取消当前这一次，系列规则与其他日期保留。' : rule ? '整个系列及其全部单次例外将被删除。' : taskId ? '只删除这一段执行时间，原任务和其他安排都会保留。' : '此独立日程将被删除。'}</p></ConfirmDialog>}
  </>;
}

export function selectionForDay(date = localDate()): CalendarSelection {
  return { allDay: false, start: `${date}T09:00`, end: `${date}T10:00` };
}
