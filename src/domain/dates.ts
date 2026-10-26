const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

export function isDateOnly(value: string): boolean {
  if (!DATE.test(value) || Number(value.slice(0, 4)) < 1000) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function localDate(value = new Date()): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function toLocalInput(instant: string | Date): string {
  const value = new Date(instant);
  if (!Number.isFinite(value.getTime())) throw new Error('时间无效');
  return `${localDate(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  if (!LOCAL_TIME.test(value) || !isDateOnly(value.slice(0, 10))) throw new Error('请输入有效日期与时间');
  const parsed = new Date(value);
  // Round-trip rejects nonexistent wall-clock times during spring DST transitions.
  if (!Number.isFinite(parsed.getTime()) || toLocalInput(parsed) !== value) {
    throw new Error('该本地时间无效，可能处于夏令时跳时区间');
  }
  return parsed.toISOString();
}

export function addDays(date: string, days: number): string {
  if (!isDateOnly(date)) throw new Error('日期无效');
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  const result = parsed.toISOString().slice(0, 10);
  if (!isDateOnly(result)) throw new Error('日期超出支持范围');
  return result;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format();
    return true;
  } catch { return false; }
}

export function defaultRange(date = new Date()) {
  const start = new Date(date);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

export function formatInstant(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
