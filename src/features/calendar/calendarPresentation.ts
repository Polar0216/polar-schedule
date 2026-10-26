import { addDays, localDate } from '../../domain/dates';
import type { CalendarOccurrence } from '../../domain/recurrence';
import type { TimeRange } from '../../domain/schema';

export function rangeBounds(range: TimeRange): { start: number; end: number } {
  return range.allDay ? { start: new Date(`${range.startDate}T00:00:00`).getTime(), end: new Date(`${range.endDate}T00:00:00`).getTime() }
    : { start: Date.parse(range.startAt), end: Date.parse(range.endAt) };
}

export interface DayPreviewItem { occurrence: CalendarOccurrence; time: string; crossDay: boolean; start: number; end: number }

/** Browser-local day intersections, without changing the persisted UTC/date ranges. */
export function dayPreviewItems(items: CalendarOccurrence[], date: string): DayPreviewItem[] {
  const start = new Date(`${date}T00:00:00`).getTime(); const end = new Date(`${addDays(date, 1)}T00:00:00`).getTime();
  const clock = (instant: number) => instant === end ? '24:00' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));
  return items.flatMap((occurrence) => {
    const bounds = rangeBounds(occurrence.block);
    if (bounds.start >= end || bounds.end <= start) return [];
    const from = Math.max(start, bounds.start); const until = Math.min(end, bounds.end);
    const crossDay = occurrence.block.allDay ? addDays(occurrence.block.startDate, 1) !== occurrence.block.endDate
      : localDate(new Date(bounds.start)) !== localDate(new Date(bounds.end - 1));
    return [{ occurrence, start: from, end: until, crossDay, time: occurrence.block.allDay ? '全天' : `${clock(from)}—${clock(until)}` }];
  }).sort((a, b) => Number(b.occurrence.block.allDay) - Number(a.occurrence.block.allDay) || a.start - b.start || a.end - b.end || a.occurrence.id.localeCompare(b.occurrence.id));
}
