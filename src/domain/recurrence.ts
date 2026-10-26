import { addDays, isDateOnly } from './dates';
import type { RecurrenceException, RecurrenceRule, ScheduleBlock } from './schema';
import { addWallMinutes, wallTimeToInstant, zonedLocalInput } from './zonedTime';

export interface CalendarOccurrence {
  id: string;
  block: ScheduleBlock;
  seriesId?: string;
  occurrenceDate?: string;
}

const DAY = 86_400_000;
const MAX_VIEW_DAYS = 400;
const MAX_OCCURRENCES = 100_000;
const monthCountCache = new Map<string, number[]>();
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / DAY;
const MIN_DAY = dayNumber('1000-01-01');
const MAX_DAY = dayNumber('9999-12-31');
const boundedAddDays = (date: string, days: number) => new Date(Math.max(MIN_DAY, Math.min(MAX_DAY, dayNumber(date) + days)) * DAY).toISOString().slice(0, 10);
const monthNumber = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const pad = (value: number) => String(value).padStart(2, '0');
const mondayOffset = (date: string) => (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7;
const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

function monthDate(month: number, day: number): string {
  return `${String(Math.floor(month / 12)).padStart(4, '0')}-${pad(month % 12 + 1)}-${pad(day)}`;
}

// The Gregorian calendar repeats every 4,800 months. Counting monthly instances
// therefore takes at most one cycle, including series that started centuries ago.
function monthlyOrdinal(rule: RecurrenceRule, index: number): number {
  const day = Number(rule.startDate.slice(8));
  if (day <= 28) return index + 1;
  const startMonth = monthNumber(rule.startDate);
  const key = `${startMonth % 4800}:${day}:${rule.interval}`;
  let prefix = monthCountCache.get(key);
  if (!prefix) {
    const cycle = 4800 / gcd(4800, rule.interval);
    prefix = [0];
    // Use 2000..2399 as a representative cycle so all dates remain in range.
    const representative = 24_000 + startMonth % 4800;
    for (let i = 0; i < cycle; i++) {
      const month = 24_000 + (representative - 24_000 + i * rule.interval) % 4800;
      prefix.push(prefix[i] + Number(isDateOnly(monthDate(month, day))));
    }
    if (monthCountCache.size >= 256) monthCountCache.clear();
    monthCountCache.set(key, prefix);
  }
  const size = prefix.length - 1;
  const steps = index + 1;
  return Math.floor(steps / size) * prefix[size] + prefix[steps % size];
}

/** The 1-based occurrence number; nonexistent monthly dates do not consume count. */
function ordinal(rule: RecurrenceRule, date: string): number | undefined {
  if (date < rule.startDate || (rule.until && date > rule.until)) return undefined;
  const days = dayNumber(date) - dayNumber(rule.startDate);
  let result: number;
  if (rule.frequency === 'daily') {
    if (days % rule.interval !== 0) return undefined;
    result = days / rule.interval + 1;
  } else if (rule.frequency === 'weekly') {
    const startOffset = mondayOffset(rule.startDate);
    const week = Math.floor((days + startOffset) / 7);
    if (week % rule.interval !== 0) return undefined;
    const weekday = mondayOffset(date);
    const selected = [...rule.weekdays].map((value) => (value + 6) % 7).sort((a, b) => a - b);
    if (!selected.includes(weekday)) return undefined;
    const omitted = selected.filter((value) => value < startOffset).length;
    result = week / rule.interval * selected.length + selected.filter((value) => value <= weekday).length - omitted;
  } else {
    if (date.slice(8) !== rule.startDate.slice(8)) return undefined;
    const months = monthNumber(date) - monthNumber(rule.startDate);
    if (months % rule.interval !== 0) return undefined;
    result = rule.count ? monthlyOrdinal(rule, months / rule.interval) : 1;
  }
  return rule.count && result > rule.count ? undefined : result;
}

/** Generate only dates around the requested window; never materialize a series. */
function candidateDates(rule: RecurrenceRule, from: string, until: string): string[] {
  const start = from < rule.startDate ? rule.startDate : from;
  const end = rule.until && rule.until < until ? rule.until : until;
  if (start > end) return [];
  const dates: string[] = [];
  if (rule.frequency === 'monthly') {
    const first = monthNumber(rule.startDate);
    const index = Math.max(0, Math.ceil((monthNumber(start) - first) / rule.interval));
    const day = Number(rule.startDate.slice(8));
    for (let month = first + index * rule.interval; month <= monthNumber(end); month += rule.interval) {
      const date = monthDate(month, day);
      if (isDateOnly(date) && date >= start && date <= end && ordinal(rule, date) !== undefined) dates.push(date);
    }
  } else if (rule.frequency === 'daily') {
    const skip = Math.max(0, Math.ceil((dayNumber(start) - dayNumber(rule.startDate)) / rule.interval));
    let date = addDays(rule.startDate, skip * rule.interval);
    while (date <= end) {
      if (ordinal(rule, date) !== undefined) dates.push(date);
      const next = dayNumber(date) + rule.interval;
      if (next > dayNumber(end)) break;
      date = addDays(date, rule.interval);
    }
  } else {
    // A view is bounded to 400 days; scanning its dates keeps weekly rules simple
    // while their count is calculated arithmetically, never from series start.
    let date = start;
    while (date <= end) {
      if (ordinal(rule, date) !== undefined) dates.push(date);
      if (date === end) break;
      date = addDays(date, 1);
    }
  }
  return dates;
}

function browserBoundary(date: string): number {
  // Date-only strings passed to Date parse as UTC, so explicitly request the
  // browser's local midnight, matching FullCalendar's local calendar dates.
  const value = new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(value)) throw new Error('可见日期范围无效');
  return value;
}

function intersects(block: ScheduleBlock, start: string, end: string, startAt: number, endAt: number): boolean {
  return block.allDay ? block.startDate < end && block.endDate > start
    : Date.parse(block.startAt) < endAt && Date.parse(block.endAt) > startAt;
}

function instanceBlock(series: ScheduleBlock & { type: 'event' }, date: string): ScheduleBlock {
  const rule = series.recurrence!;
  if (series.allDay) return { ...series, startDate: date, endDate: addDays(date, rule.durationMinutes / 1440) };
  const startAt = wallTimeToInstant(`${date}T${rule.localTime}`, series.timeZone);
  // A skipped start is first advanced by its gap; duration then starts at that
  // actual wall clock. This avoids zero/negative spans such as 02:30 -> 03:30
  // on a spring-forward date. Otherwise end follows wall-clock minute duration.
  const endAt = wallTimeToInstant(addWallMinutes(zonedLocalInput(startAt, series.timeZone), rule.durationMinutes), series.timeZone);
  if (endAt <= startAt) throw new Error('重复日程在时区转换后结束时间无效');
  return { ...series, startAt, endAt };
}

function replacedBlock(series: ScheduleBlock & { type: 'event' }, exception: RecurrenceException): ScheduleBlock {
  const replacement = exception.replacement!;
  // Remove the old discriminated range so switching a single occurrence between
  // timed/all-day does not leave stale fields that would fail strict validation.
  const common = { id: series.id, revision: series.revision, createdAt: series.createdAt, updatedAt: series.updatedAt,
    type: 'event' as const, recurrence: series.recurrence, title: replacement.title, description: replacement.description,
    color: replacement.color, display: replacement.display };
  return { ...common, ...replacement.range };
}

/**
 * Expand a browser-local [startDate, endDate) view. Series remain one persisted
 * block, their derived IDs are stable, and moved-in replacements are included
 * even when the original occurrence lies outside the view. Limits fail loudly.
 */
export function expandBlocks(blocks: ScheduleBlock[], exceptions: RecurrenceException[], rangeStartDate: string, rangeEndDate: string): CalendarOccurrence[] {
  if (!isDateOnly(rangeStartDate) || !isDateOnly(rangeEndDate) || rangeEndDate <= rangeStartDate) throw new Error('可见日期范围无效');
  if (dayNumber(rangeEndDate) - dayNumber(rangeStartDate) > MAX_VIEW_DAYS) throw new Error(`一次最多查看 ${MAX_VIEW_DAYS} 天，请缩小日历范围`);
  const startAt = browserBoundary(rangeStartDate), endAt = browserBoundary(rangeEndDate);
  const result: CalendarOccurrence[] = [];
  const bySeries = new Map<string, Map<string, RecurrenceException>>();
  for (const exception of exceptions) {
    let dates = bySeries.get(exception.seriesId);
    if (!dates) { dates = new Map(); bySeries.set(exception.seriesId, dates); }
    dates.set(exception.occurrenceDate, exception);
  }
  const push = (item: CalendarOccurrence) => {
    if (intersects(item.block, rangeStartDate, rangeEndDate, startAt, endAt)) {
      if (result.length >= MAX_OCCURRENCES) throw new Error('当前范围超过 100000 个日程实例，请缩小日历范围或筛选清单');
      result.push(item);
    }
  };
  for (const block of blocks) {
    if (block.type !== 'event' || !block.recurrence) { push({ id: block.id, block }); continue; }
    const rule = block.recurrence;
    const buffer = Math.ceil(rule.durationMinutes / 1440) + 2;
    const localStart = block.allDay ? rangeStartDate : zonedLocalInput(new Date(startAt), block.timeZone).slice(0, 10);
    const localEnd = block.allDay ? rangeEndDate : zonedLocalInput(new Date(endAt), block.timeZone).slice(0, 10);
    const from = boundedAddDays(localStart, -buffer), until = boundedAddDays(localEnd, 2);
    const seriesExceptions = bySeries.get(block.id);
    for (const date of candidateDates(rule, from, until)) {
      if (seriesExceptions?.has(date)) continue;
      push({ id: `${block.id}@${date}`, seriesId: block.id, occurrenceDate: date, block: instanceBlock(block, date) });
    }
    // Handle exceptions separately: their original date need not be near this
    // view, and an altered time range may enter, leave, or cross the view.
    for (const exception of seriesExceptions?.values() ?? []) {
      if (exception.cancelled || !exception.replacement || ordinal(rule, exception.occurrenceDate) === undefined) continue;
      push({ id: `${block.id}@${exception.occurrenceDate}`, seriesId: block.id,
        occurrenceDate: exception.occurrenceDate, block: replacedBlock(block, exception) });
    }
  }
  return result;
}
