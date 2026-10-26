import { describe, expect, it } from 'vitest';
import type { CalendarOccurrence } from '../../domain/recurrence';
import type { ScheduleBlock } from '../../domain/schema';
import { dayPreviewItems } from './calendarPresentation';

const base = { id: '00000000-0000-4000-8000-000000000011', revision: 1, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', timeZone: 'UTC', type: 'event' as const, title: '安排', description: '', display: 'normal' as const };
const item = (id: string, range: Pick<Extract<ScheduleBlock, { allDay: false }>, 'startAt' | 'endAt'>): CalendarOccurrence => ({ id, block: { ...base, ...range, allDay: false } });

describe('只用于展示的日历派生信息', () => {
  it('跨日条目以当天真实交集排序，不改变原始范围', () => {
    // Use browser-local constructors so this test is valid in UTC and Asia/Shanghai.
    const from = new Date(2026, 9, 19, 22).toISOString(); const until = new Date(2026, 9, 21, 2).toISOString();
    const cross = item('cross', { startAt: from, endAt: until });
    const timed = item('timed', { startAt: new Date(2026, 9, 20, 9).toISOString(), endAt: new Date(2026, 9, 20, 10).toISOString() });
    const result = dayPreviewItems([timed, cross], '2026-10-20');
    expect(result.map((entry) => [entry.occurrence.id, entry.time, entry.crossDay])).toEqual([['cross', '00:00—24:00', true], ['timed', '09:00—10:00', false]]);
    expect(cross.block).toMatchObject({ startAt: from, endAt: until });
  });
  it('全天排第一，排他结束日不进入下一天，背景和实例保持唯一ID', () => {
    const allDay: CalendarOccurrence = { id: 'all', block: { ...base, allDay: true, startDate: '2026-10-20', endDate: '2026-10-22' } };
    const background = item('series@2026-10-20', { startAt: new Date(2026, 9, 20, 8).toISOString(), endAt: new Date(2026, 9, 20, 9).toISOString() });
    background.seriesId = base.id; background.occurrenceDate = '2026-10-20';
    if (background.block.type === 'event') background.block.display = 'background';
    expect(dayPreviewItems([background, allDay], '2026-10-20').map((entry) => entry.occurrence.id)).toEqual(['all', 'series@2026-10-20']);
    expect(dayPreviewItems([allDay], '2026-10-22')).toEqual([]);
  });
  it('同时重叠的旧显示记录全部保留在日期预览中，不再按层级收纳', () => {
    const entries = Array.from({ length: 5 }, (_, index) => item(String(index), { startAt: new Date(2026, 9, 20, 8).toISOString(), endAt: new Date(2026, 9, 20, 10).toISOString() }));
    for (const entry of entries.slice(0, 3)) if (entry.block.type === 'event') entry.block.display = 'background';
    const before = structuredClone(entries);
    expect(dayPreviewItems(entries, '2026-10-20').map((entry) => entry.occurrence.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(entries).toEqual(before);
  });
});
