import { isDateOnly, isTimeZone } from './dates';

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number[]>();
const HOUR = 3_600_000;

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    if (!isTimeZone(timeZone)) throw new Error('IANA 时区无效');
    value = new Intl.DateTimeFormat('en-CA', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(timeZone, value);
  }
  return value;
}

function wallMilliseconds(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
}

/** A zoned wall clock value suitable for datetime-local inputs (no implicit browser zone). */
export function zonedLocalInput(instant: string | Date, timeZone: string): string {
  const epoch = new Date(instant).getTime();
  if (!Number.isFinite(epoch)) throw new Error('时间无效');
  const value = new Date(wallMilliseconds(epoch, timeZone)).toISOString().slice(0, 16);
  if (!LOCAL_INPUT.test(value) || !isDateOnly(value.slice(0, 10))) throw new Error('日期超出支持范围');
  return value;
}

function validateWall(value: string): number {
  if (!LOCAL_INPUT.test(value) || !isDateOnly(value.slice(0, 10))) throw new Error('请输入有效日期与时间');
  return Date.parse(`${value}:00.000Z`);
}

/** Add calendar/wall-clock minutes, without applying a zone or a DST offset. */
export function addWallMinutes(value: string, minutes: number): string {
  if (!Number.isSafeInteger(minutes)) throw new Error('时长必须为整数分钟');
  const epoch = validateWall(value) + minutes * 60_000;
  const shifted = new Date(epoch).toISOString().slice(0, 16);
  validateWall(shifted);
  return shifted;
}

/**
 * Temporal-compatible disambiguation, implemented with Intl's IANA zone data:
 * a repeated fall-back clock chooses its earlier instant; a nonexistent spring
 * clock moves forward by the offset gap (02:30 -> 03:30 for a one-hour jump).
 * Offsets are sampled on both sides, including whole-day historical transitions.
 */
export function wallTimeToInstant(value: string, timeZone: string): string {
  const wall = validateWall(value);
  formatter(timeZone);
  const cacheKey = `${timeZone}:${value.slice(0, 10)}`;
  let offsets = offsetCache.get(cacheKey);
  if (!offsets) {
    const midnight = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
    const unique = new Set<number>();
    for (let hours = -48; hours <= 48; hours += 6) {
      const epoch = midnight + hours * HOUR;
      unique.add(wallMilliseconds(epoch, timeZone) - epoch);
    }
    offsets = [...unique];
    if (offsetCache.size >= 2048) offsetCache.clear();
    offsetCache.set(cacheKey, offsets);
  }
  const candidates = offsets.map((offset) => {
    const instant = wall - offset;
    return { instant, distance: wallMilliseconds(instant, timeZone) - wall };
  });
  const exact = candidates.filter((candidate) => candidate.distance === 0).sort((a, b) => a.instant - b.instant);
  if (exact.length) return new Date(exact[0].instant).toISOString();
  const later = candidates.filter((candidate) => candidate.distance > 0).sort((a, b) => a.distance - b.distance || a.instant - b.instant);
  if (later.length) return new Date(later[0].instant).toISOString();
  throw new Error('该时区无法解析本地时间');
}
