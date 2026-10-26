import { isDateOnly } from './dates';

/** Calendar navigation consumes date strings, never UTC-parsed midnight instants. */
export function resolveDateEntry(value: string, allowMonth = false): string {
  const text = value.trim();
  const date = allowMonth && /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text;
  if (!isDateOnly(date)) throw new Error(allowMonth ? '请输入有效日期 YYYY-MM-DD 或月份 YYYY-MM' : '请输入有效日期 YYYY-MM-DD');
  return date;
}
