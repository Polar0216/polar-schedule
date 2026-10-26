import { useMemo, useEffect, useId, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import zhCn from '@fullcalendar/core/locales/zh-cn';
import type { EventApi, EventInput } from '@fullcalendar/core';
import { useStore } from '../../app/Store';
import { addDays, browserTimeZone, formatInstant, localDate } from '../../domain/dates';
import { expandBlocks, type CalendarOccurrence } from '../../domain/recurrence';
import type { BlockInput, ScheduleBlock, ScheduleData, TimeRange, Settings } from '../../domain/schema';
import { blockTitle, visibleBlocks } from '../../domain/selectors';
import type { CalendarSelection } from './BlockDialog';
import { dayPreviewItems } from './calendarPresentation';
import './calendar.css';
import './calendar-ux.css';

export const viewNames = { day: 'timeGridDay', week: 'timeGridWeek', month: 'dayGridMonth' } as const;
export type OccurrenceSelection = { seriesId: string; occurrenceDate: string };

function rangeFromEvent(event: EventApi): TimeRange {
  if (!event.start) throw new Error('日程缺少开始时间');
  if (event.allDay) return { allDay: true, startDate: localDate(event.start),
    endDate: event.end ? localDate(event.end) : addDays(localDate(event.start), 1), timeZone: browserTimeZone() };
  return { allDay: false, startAt: event.start.toISOString(),
    endAt: (event.end ?? new Date(event.start.getTime() + 3600000)).toISOString(), timeZone: browserTimeZone() };
}

function timeLabel(block: ScheduleBlock): string {
  return block.allDay ? `${block.startDate} 全天${addDays(block.startDate, 1) !== block.endDate ? ` — ${addDays(block.endDate, -1)}` : ''}`
    : `${formatInstant(block.startAt)} — ${formatInstant(block.endAt)}`;
}

/** A partly clipped block also needs an entry: visible-hour settings never hide its real range. */
function outsideHours(block: ScheduleBlock, settings: Settings, rangeStart: string, rangeEnd: string): boolean {
  if (block.allDay || (settings.startHour === 0 && settings.endHour === 24)) return false;
  const start = new Date(block.startAt); const end = new Date(block.endAt);
  const firstDate = localDate(start) < rangeStart ? rangeStart : localDate(start);
  const lastDate = localDate(end) < rangeEnd ? localDate(end) : addDays(rangeEnd, -1);
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const activeStart = Math.max(start.getTime(), dayStart.getTime());
    const activeEnd = Math.min(end.getTime(), dayEnd.getTime());
    if (activeStart >= activeEnd) continue;
    const visibleStart = new Date(dayStart); visibleStart.setHours(settings.startHour);
    const visibleEnd = new Date(dayStart); visibleEnd.setHours(settings.endHour);
    if (activeStart < visibleStart.getTime() || activeEnd > visibleEnd.getTime()) return true;
  }
  return false;
}

function instantBounds(range: TimeRange): { start: number; end: number } {
  return range.allDay ? { start: new Date(`${range.startDate}T00:00:00`).getTime(), end: new Date(`${range.endDate}T00:00:00`).getTime() }
    : { start: Date.parse(range.startAt), end: Date.parse(range.endAt) };
}

function conflictCount(range: TimeRange, data: ScheduleData, excludeOccurrenceId?: string): number {
  const target = instantBounds(range);
  const startDate = localDate(new Date(target.start));
  const endDate = addDays(localDate(new Date(target.end - 1)), 1);
  // Conflict feedback includes every list, independently of the visual filter.
  return expandBlocks(data.scheduleBlocks, data.exceptions, startDate, endDate).filter((occurrence) => {
    if (occurrence.id === excludeOccurrenceId) return false;
    const existing = instantBounds(occurrence.block);
    return existing.start < target.end && existing.end > target.start;
  }).length;
}

export function Calendar({ calendarRef, initialView, listId, onTitle, onSelect, onBlock }: {
  calendarRef: RefObject<FullCalendar | null>; initialView: Settings['defaultView']; listId: string | null;
  onTitle: (title: string, view: Settings['defaultView']) => void;
  onSelect: (selection: CalendarSelection) => void;
  onBlock: (block: ScheduleBlock, occurrence?: OccurrenceSelection) => void;
}) {
  const { data, repo, run, notify } = useStore();
  const stage = useRef<HTMLDivElement>(null);
  const snapshot = useRef(data); snapshot.current = data;
  const handledDrops = useRef(new WeakSet<Event>());
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const [range, setRange] = useState({ start: addDays(localDate(), -7), end: addDays(localDate(), 42), view: initialView });
  const expansion = useMemo(() => {
    try { return { items: expandBlocks(visibleBlocks(data, listId), data.exceptions, range.start, range.end), error: null }; }
    catch (error) { return { items: [] as CalendarOccurrence[], error: error instanceof Error ? error.message : '重复安排无法展开，请导出备份并检查规则' }; }
  }, [data, listId, range.start, range.end]);
  const occurrences = expansion.items;
  const recurringSeries = visibleBlocks(data, listId).filter((block) => block.type === 'event' && block.recurrence);
  const occurrenceSnapshot = useRef(occurrences); occurrenceSnapshot.current = occurrences;
  const outOfRange = range.view === 'month' ? [] : occurrences.filter(({ block }) => outsideHours(block, data.settings, range.start, range.end));
  const events: EventInput[] = useMemo(() => occurrences.map((occurrence) => {
    const { block } = occurrence;
    const task = block.type === 'task' ? data.tasks.find((t) => t.id === block.taskId) : undefined;
    const list = task ? data.lists.find((l) => l.id === task.listId) : undefined;
    const color = block.color ?? list?.color ?? '#7774d5';
    return {
      id: occurrence.id, title: blockTitle(block, data), allDay: block.allDay,
      start: block.allDay ? block.startDate : block.startAt,
      end: block.allDay ? block.endDate : block.endAt,
      // Legacy display/showBackground values remain stored, but every arrangement
      // has the same ordinary, directly editable presentation in every view.
      display: 'block', editable: true,
      backgroundColor: `color-mix(in srgb, ${color} 12%, var(--surface))`, borderColor: color,
      classNames: ['schedule-event', `kind-${block.type}`, block.type === 'task' && block.executionStatus === 'completed' ? 'completed-event' : ''],
      extendedProps: { kind: block.type, color, fullTime: timeLabel(block), recurring: Boolean(occurrence.seriesId),
        executionStatus: block.type === 'task' ? block.executionStatus : undefined },
    };
  }), [data, occurrences]);

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(() => { calendarRef.current?.getApi().updateSize(); });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [calendarRef]);

  useEffect(() => {
    const byId = new Map(events.map((event) => [event.id, event]));
    stage.current?.querySelectorAll<HTMLElement>('[data-occurrence-id]').forEach((element) => {
      const event = byId.get(element.dataset.occurrenceId);
      if (!event) return;
      const description = `${event.title ?? ''}，${String(event.extendedProps?.fullTime ?? '')}${event.extendedProps?.kind === 'task' ? event.extendedProps?.executionStatus === 'completed' ? '，本次已完成' : '，本次待完成' : '，独立日程'}${event.extendedProps?.recurring ? '，重复日程' : ''}`;
      element.setAttribute('title', description); element.setAttribute('aria-label', description);
    });
  }, [events]);

  function openOccurrence(occurrence: CalendarOccurrence) {
    setPreviewDate(null);
    onBlock(occurrence.block, occurrence.seriesId && occurrence.occurrenceDate ? {
      seriesId: occurrence.seriesId, occurrenceDate: occurrence.occurrenceDate,
    } : undefined);
  }

  function announceSaved(message: string, range: TimeRange, before: ScheduleData, excludeOccurrenceId?: string) {
    try {
      const count = conflictCount(range, before, excludeOccurrenceId);
      notify(count > 0 ? `${message}。该时段另有${count}条安排，已保留重叠` : message);
    } catch {
      notify(`${message}。此区间超出冲突检查范围，请从本段安排核对重叠`);
    }
  }

  function persistMove(event: EventApi, revert: () => void) {
    void run(async () => {
      try {
        const before = snapshot.current;
        const occurrence = occurrenceSnapshot.current.find((item) => item.id === event.id);
        if (!occurrence) throw new Error('此安排已不存在');
        const { block } = occurrence;
        const details = block.type === 'task' ? { type: 'task' as const, taskId: block.taskId } : {
          type: 'event' as const, title: block.title, description: block.description, display: block.display,
        };
        const range = rangeFromEvent(event);
        const input: BlockInput = { ...range, ...details, color: block.color };
        if (occurrence.seriesId && occurrence.occurrenceDate) await repo.saveOccurrence(occurrence.seriesId, occurrence.occurrenceDate, input);
        else await repo.saveBlock(input, block.id);
        announceSaved('时间安排已保存', range, before, occurrence.id);
      } catch (error) { revert(); throw error; }
    });
  }

  function occurrenceList(items: CalendarOccurrence[], day?: string) {
    const dayItems = day ? dayPreviewItems(items, day) : null;
    const sorted = dayItems ? dayItems.map((item) => item.occurrence) : items;
    return <ul className="calendar-detail-list">{sorted.map((item) => {
      const block = item.block;
      const task = block.type === 'task' ? data.tasks.find((task) => task.id === block.taskId) : undefined;
      const color = item.block.color ?? data.lists.find((list) => list.id === task?.listId)?.color ?? '#7774d5';
      const intersection = dayItems?.find((entry) => entry.occurrence.id === item.id);
      return <li key={item.id}><button onClick={() => openOccurrence(item)} aria-label={`查看安排 ${blockTitle(item.block, data)} ${intersection?.time ?? timeLabel(item.block)}`}>
        <span className="calendar-list-color" style={{ background: color }} />
        <span><strong><span className="calendar-list-kind" aria-hidden="true">{block.type === 'task' ? block.executionStatus === 'completed' ? '✓ ' : '□ ' : '◇ '}</span>{blockTitle(item.block, data)}</strong><small>{intersection?.time ?? timeLabel(item.block)}{intersection?.crossDay ? ' · 跨日' : ''}{block.type === 'task' ? block.executionStatus === 'completed' ? ' · 本次已完成' : ' · 本次待完成' : ''}{item.seriesId ? ' · 重复' : ''}</small></span><span aria-hidden="true">查看 ›</span>
      </button></li>;
    })}</ul>;
  }

  const hour = (value: number) => `${String(value).padStart(2, '0')}:00:00`;
  return <div className={`calendar-host density-${data.settings.density} ${range.view === 'month' ? 'is-month' : ''}`} data-testid="calendar">
    <div className="calendar-stage" ref={stage}>
      <FullCalendar ref={calendarRef} plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]} locale={zhCn}
        timeZone="local" initialView={viewNames[initialView]} headerToolbar={false} height="100%" firstDay={data.settings.weekStartsOn}
        allDayText="全天" nowIndicator dayMaxEvents={3} editable selectable selectMirror droppable
        eventOrder="duration,start,title" eventOrderStrict fixedWeekCount={false}
        eventResizableFromStart eventOverlap selectOverlap slotEventOverlap={false} allDayMaintainDuration
        slotDuration={{ minutes: data.settings.slotMinutes }} snapDuration={{ minutes: data.settings.slotMinutes }} scrollTime="08:00:00" scrollTimeReset={false}
        slotMinTime={hour(data.settings.startHour)} slotMaxTime={hour(data.settings.endHour)}
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        longPressDelay={350} selectLongPressDelay={350} eventLongPressDelay={350}
        dropAccept=".drag-handle[data-task-id]" events={events}
        datesSet={(info) => {
          const next = info.view.type === 'timeGridDay' ? 'day' : info.view.type === 'timeGridWeek' ? 'week' : 'month';
          const start = localDate(info.start); const end = localDate(info.end);
          setRange((previous) => previous.start === start && previous.end === end && previous.view === next ? previous : { start, end, view: next });
          onTitle(info.view.title, next);
        }}
        dateClick={(info) => {
          const end = info.allDay ? addDays(info.dateStr.slice(0, 10), 1) : new Date(info.date.getTime() + data.settings.defaultDurationMinutes * 60000).toISOString();
          onSelect({ start: info.dateStr, end, allDay: info.allDay });
        }}
        select={(info) => { onSelect({ start: info.startStr, end: info.endStr, allDay: info.allDay }); calendarRef.current?.getApi().unselect(); }}
        eventClick={(info) => { const occurrence = occurrenceSnapshot.current.find((item) => item.id === info.event.id); if (occurrence) openOccurrence(occurrence); }}
        eventDrop={(info) => persistMove(info.event, info.revert)}
        eventResize={(info) => persistMove(info.event, info.revert)}
        drop={(info) => {
          // create:false gives previews without an inserted event. Only this callback writes.
          if (handledDrops.current.has(info.jsEvent)) return;
          handledDrops.current.add(info.jsEvent);
          void run(async () => {
            const taskId = info.draggedEl.dataset.taskId;
            const current = snapshot.current;
            if (!taskId || !current.tasks.some((task) => task.id === taskId)) throw new Error('任务已不存在，请刷新待办列表后重试');
            if (!Number.isFinite(info.date.getTime())) throw new Error('放置日期无效，任务未被更改');
            const allDay = info.allDay || info.view.type === 'dayGridMonth';
            const timeRange: TimeRange = allDay ? {
              allDay: true, startDate: localDate(info.date), endDate: addDays(localDate(info.date), 1), timeZone: browserTimeZone(),
            } : { allDay: false, startAt: info.date.toISOString(), endAt: new Date(info.date.getTime() + current.settings.defaultDurationMinutes * 60000).toISOString(), timeZone: browserTimeZone() };
            const id = await repo.saveBlock({ ...timeRange, type: 'task', taskId });
            announceSaved(allDay ? '已添加全天安排，原任务保持不变' : `已安排 ${current.settings.defaultDurationMinutes} 分钟，可拖动边缘调整`, timeRange, current);
            return id;
          });
        }}
        dayCellContent={(arg) => arg.view.type === 'dayGridMonth' ? <button type="button" className="calendar-date-preview-trigger" aria-label={`预览${localDate(arg.date)}的安排`} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setPreviewDate(localDate(arg.date)); }}>{arg.dayNumberText}</button> : arg.dayNumberText}
        dayHeaderContent={(arg) => <div className={`day-heading ${arg.isToday ? 'today' : ''}`}>
          {arg.view.type !== 'dayGridMonth' ? <button type="button" className="calendar-week-preview-trigger" aria-label={`预览${localDate(arg.date)}的安排`} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setPreviewDate(localDate(arg.date)); }}><span>{['周日', '周一', '周二', '周三', '周四', '周五', '周六'][arg.date.getDay()]}</span><strong>{arg.date.getDate()}</strong></button> : <span>{['周日', '周一', '周二', '周三', '周四', '周五', '周六'][arg.date.getDay()]}</span>}
        </div>}
        eventDidMount={(arg) => {
          const description = `${arg.event.title}，${String(arg.event.extendedProps.fullTime ?? '')}${arg.event.extendedProps.kind === 'task' ? arg.event.extendedProps.executionStatus === 'completed' ? '，本次已完成' : '，本次待完成' : '，独立日程'}${arg.event.extendedProps.recurring ? '，重复日程' : ''}`;
          arg.el.setAttribute('title', description); arg.el.setAttribute('aria-label', description);
          arg.el.dataset.occurrenceId = arg.event.id;
          arg.el.dataset.blockId = occurrenceSnapshot.current.find((item) => item.id === arg.event.id)?.block.id ?? arg.event.id;
          arg.el.setAttribute('tabindex', '0'); arg.el.setAttribute('role', 'button');
          arg.el.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); arg.el.click(); } };
        }}
        eventContent={(arg) => <div className="block-content" style={{ '--event-color': arg.event.extendedProps.color } as CSSProperties}><span className="calendar-event-heading"><span className="calendar-kind-symbol" aria-hidden="true">{arg.event.extendedProps.kind === 'task' ? arg.event.extendedProps.executionStatus === 'completed' ? '✓' : '□' : '◇'}</span>{arg.event.extendedProps.kind === 'task' && arg.event.extendedProps.executionStatus === 'completed' && <span className="calendar-completion-label">已完成</span>}{arg.timeText && <span className="block-time">{arg.view.type === 'timeGridWeek' && arg.event.start && !arg.event.allDay ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(arg.event.start) : arg.timeText}</span>}</span><strong>{arg.event.title}</strong>
          <small className="calendar-popover-time">{String(arg.event.extendedProps.fullTime ?? '')}</small>
          {arg.view.type !== 'dayGridMonth' && arg.event.extendedProps.kind === 'task' && <small>任务安排</small>}</div>}
      />
    </div>
    <div className="calendar-details" aria-label="当前日期范围安排入口">
      {expansion.error && <p className="calendar-list-error" role="alert">{expansion.error}。本地原始数据仍保留，可在设置中导出完整备份。</p>}
      <details className="calendar-agenda" onToggle={() => calendarRef.current?.getApi().updateSize()}>
        <summary>本段安排 · {occurrences.length}<span>展开查看完整标题与时间</span></summary>
        {occurrences.length > 0 ? occurrenceList(occurrences) : <p className="calendar-list-empty">这段日期还没有安排</p>}
      </details>
      {outOfRange.length > 0 && <details className="calendar-outside-list" onToggle={() => calendarRef.current?.getApi().updateSize()}>
        <summary>显示时段外安排 · {outOfRange.length}<span>包含部分超出时段的安排</span></summary>{occurrenceList(outOfRange)}
      </details>}
      {recurringSeries.length > 0 && <details className="calendar-series-list" onToggle={() => calendarRef.current?.getApi().updateSize()}>
        <summary>重复系列 · {recurringSeries.length}<span>管理全部系列，包含已结束或本次取消</span></summary>
        <ul className="calendar-detail-list">{recurringSeries.map((series) => <li key={series.id}>
          <button onClick={() => onBlock(series)} aria-label={`管理重复系列 ${blockTitle(series, data)}`}>
            <span className="calendar-list-color" style={{ background: series.color ?? '#7774d5' }} />
            <span><strong>{blockTitle(series, data)}</strong><small>{timeLabel(series)} · 编辑整个系列</small></span><span aria-hidden="true">管理 ›</span>
          </button></li>)}</ul>
      </details>}
    </div>
    {previewDate && <DayPreview date={previewDate} onClose={() => setPreviewDate(null)} onFullDay={() => { const date = previewDate; setPreviewDate(null); calendarRef.current?.getApi().changeView(viewNames.day, date); }}>
      {dayPreviewItems(occurrences, previewDate).length > 0 ? occurrenceList(occurrences, previewDate) : <p className="calendar-preview-empty">这一天还没有安排</p>}
    </DayPreview>}
  </div>;
}

function DayPreview({ date, children, onClose, onFullDay }: { date: string; children: ReactNode; onClose: () => void; onFullDay: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  const downOutside = useRef(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  const label = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T12:00:00`));
  return <dialog ref={dialog} className="dialog calendar-day-preview" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onMouseDown={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); downOutside.current = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom; }}
    onClick={(event) => { if (event.target === event.currentTarget && downOutside.current) onClose(); }}>
    <header className="dialog-header"><h2 id={titleId}>当天安排 · {label}</h2><button type="button" className="icon-button" aria-label="关闭当天预览" onClick={onClose}>×</button></header>
    <div className="calendar-day-preview-list">{children}</div>
    <footer className="calendar-day-preview-footer"><button type="button" className="button primary" onClick={onFullDay}>查看完整日视图 →</button></footer>
  </dialog>;
}
