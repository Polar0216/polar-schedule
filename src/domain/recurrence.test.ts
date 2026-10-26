import { describe, expect, it } from 'vitest';
import { fromLocalInput } from './dates';
import { expandBlocks } from './recurrence';
import type { RecurrenceException, RecurrenceRule, ScheduleBlock } from './schema';
import { zonedLocalInput } from './zonedTime';

const ID = '00000000-0000-4000-8000-000000000002';
const meta = { id: ID, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { frequency: 'daily', interval: 1, weekdays: [], startDate: '2026-12-29', localTime: '09:00', durationMinutes: 60, ...overrides };
}
function series(recurrence: RecurrenceRule, allDay = true, timeZone = 'UTC'): ScheduleBlock {
  const common = { ...meta, type: 'event' as const, title: '课程', description: '详情', display: 'normal' as const, timeZone, recurrence };
  return allDay ? { ...common, allDay: true, startDate: recurrence.startDate, endDate: '2027-12-31' }
    : { ...common, allDay: false, startAt: '2026-01-01T09:00:00.000Z', endAt: '2026-01-01T10:00:00.000Z' };
}
function dates(block: ScheduleBlock, start: string, end: string, exceptions: RecurrenceException[] = []) {
  return expandBlocks([block], exceptions, start, end).map((item) => item.occurrenceDate);
}
function exception(occurrenceDate: string, overrides: Partial<RecurrenceException> = {}): RecurrenceException {
  return { ...meta, id: '00000000-0000-4000-8000-000000000003', seriesId: ID, occurrenceDate, cancelled: true, ...overrides };
}

describe('重复规则按可见区间展开', () => {
  it('每天/每N天跨月跨年，结束日期含当日', () => {
    const block = series(rule({ interval: 3, until: '2027-01-04', durationMinutes: 1440 }));
    expect(dates(block, '2026-12-28', '2027-01-10')).toEqual(['2026-12-29', '2027-01-01', '2027-01-04']);
  });
  it('有限次数与无限系列都只返回当前区间', () => {
    const block = series(rule({ count: 2, durationMinutes: 1440 }));
    expect(dates(block, '2026-12-28', '2027-01-05')).toEqual(['2026-12-29', '2026-12-30']);
    expect(dates(block, '2027-01-01', '2027-01-05')).toEqual([]);
    const infinite = series(rule({ durationMinutes: 1440 }));
    expect(dates(infinite, '2036-01-01', '2036-01-04')).toEqual(['2036-01-01', '2036-01-02', '2036-01-03']);
  });
  it('每N周按周一锚定，指定JS星期，跨年保持间隔', () => {
    const block = series(rule({ frequency: 'weekly', interval: 2, weekdays: [2, 4], durationMinutes: 1440 }));
    expect(dates(block, '2026-12-28', '2027-01-18')).toEqual(['2026-12-29', '2026-12-31', '2027-01-12', '2027-01-14']);
  });
  it('首周从开始日期算起且次数不消耗开始前的所选星期', () => {
    const block = series(rule({ frequency: 'weekly', startDate: '2026-12-30', weekdays: [1, 3, 5], count: 4, durationMinutes: 1440 }));
    expect(dates(block, '2026-12-28', '2027-01-12')).toEqual(['2026-12-30', '2027-01-01', '2027-01-04', '2027-01-06']);
  });
  it('每月31号跳过无该日的月份且不消耗次数', () => {
    const block = series(rule({ frequency: 'monthly', startDate: '2027-01-31', count: 4, durationMinutes: 1440 }));
    expect(dates(block, '2027-01-01', '2027-09-01')).toEqual(['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
    expect(dates(block, '2027-05-01', '2027-09-01')).toEqual(['2027-05-31', '2027-07-31']);
  });
  it('每N月支持跨年，闰日次数计算跨400年周期仍正确', () => {
    const quarterly = series(rule({ frequency: 'monthly', interval: 3, startDate: '2026-11-30', durationMinutes: 1440 }));
    expect(dates(quarterly, '2026-11-01', '2027-09-01')).toEqual(['2026-11-30', '2027-05-30', '2027-08-30']);
    const leap = series(rule({ frequency: 'monthly', interval: 12, startDate: '2028-02-29', count: 2, durationMinutes: 1440 }));
    expect(dates(leap, '2032-01-01', '2033-01-01')).toEqual(['2032-02-29']);
    expect(dates(leap, '2036-01-01', '2037-01-01')).toEqual([]);
    const ancient = series(rule({ frequency: 'monthly', interval: 12, startDate: '1600-02-29', count: 98, durationMinutes: 1440 }));
    expect(dates(ancient, '2000-01-01', '2001-01-01')).toEqual(['2000-02-29']);
    expect(dates(ancient, '2004-01-01', '2005-01-01')).toEqual([]);
  });
  it('全天多日实例包含窗口开始前的重叠范围且不含结束日界', () => {
    const block = series(rule({ interval: 7, startDate: '2026-12-28', durationMinutes: 3 * 1440 }));
    const result = expandBlocks([block], [], '2026-12-30', '2027-01-01');
    expect(result).toHaveLength(1);
    expect(result[0].block).toMatchObject({ startDate: '2026-12-28', endDate: '2026-12-31' });
    expect(dates(block, '2026-12-31', '2027-01-01')).toEqual([]);
  });
  it('非重复全天与定时块使用显示浏览器的start含end不含边界', () => {
    const plain: ScheduleBlock = { ...meta, type: 'event', title: '一次', description: '', display: 'normal', allDay: true,
      timeZone: 'UTC', startDate: '2026-12-30', endDate: '2026-12-31' };
    expect(expandBlocks([plain], [], '2026-12-31', '2027-01-01')).toEqual([]);
    const timed: ScheduleBlock = { ...meta, type: 'task', taskId: '00000000-0000-4000-8000-000000000004', executionStatus: 'pending', allDay: false,
      timeZone: 'UTC', startAt: fromLocalInput('2026-12-31T00:00'), endAt: fromLocalInput('2027-01-01T00:00') };
    expect(expandBlocks([timed], [], '2026-12-31', '2027-01-01')).toEqual([{ id: timed.id, block: timed }]);
    expect(expandBlocks([timed], [], '2027-01-01', '2027-01-02')).toEqual([]);
  });
  it('派生实例ID稳定，持久系列不复制也不修改', () => {
    const block = series(rule({ durationMinutes: 1440 }));
    const original = structuredClone(block);
    const first = expandBlocks([block], [], '2026-12-29', '2026-12-31');
    const second = expandBlocks([block], [], '2026-12-29', '2026-12-31');
    expect(first).toEqual(second);
    expect(first.map((item) => item.id)).toEqual([`${ID}@2026-12-29`, `${ID}@2026-12-30`]);
    expect(first.every((item) => item.block.id === ID && item.seriesId === ID && item.block.type === 'event' && item.block.recurrence)).toBe(true);
    expect(block).toEqual(original);
  });
  it('范围限制明确报错而不静默截断', () => {
    expect(() => expandBlocks([], [], '2026-01-01', '2028-01-01')).toThrow('400');
    expect(() => expandBlocks([], [], '2026-02-30', '2026-03-01')).toThrow('日期');
    expect(() => expandBlocks([], [], '2026-03-01', '2026-03-01')).toThrow('日期');
    const plain: ScheduleBlock = { ...meta, type: 'event', title: '一次', description: '', display: 'normal', allDay: true,
      timeZone: 'UTC', startDate: '2026-03-01', endDate: '2026-03-02' };
    expect(() => expandBlocks(Array.from({ length: 100_001 }, () => plain), [], '2026-03-01', '2026-03-02')).toThrow('100000');
  });
  it('靠近支持年份下界的视图无需创建界外缓冲日期', () => {
    const block = series(rule({ startDate: '1000-01-01', durationMinutes: 1440, count: 2 }));
    expect(dates(block, '1000-01-01', '1000-01-04')).toEqual(['1000-01-01', '1000-01-02']);
  });
});

describe('重复系列的时区与DST', () => {
  function times(block: ScheduleBlock, start: string, end: string) {
    return expandBlocks([block], [], start, end).map((item) => {
      if (item.block.allDay) throw new Error('应为定时');
      return { date: item.occurrenceDate, start: zonedLocalInput(item.block.startAt, item.block.timeZone),
        end: zonedLocalInput(item.block.endAt, item.block.timeZone), elapsed: (Date.parse(item.block.endAt) - Date.parse(item.block.startAt)) / 60_000 };
    });
  }
  it('纽约春秋变更前后课程始终保持09:00墙上开始和10:35结束', () => {
    const spring = series(rule({ startDate: '2026-03-07', count: 3, durationMinutes: 95 }), false, 'America/New_York');
    expect(times(spring, '2026-03-06', '2026-03-11').map((item) => item.start)).toEqual(['2026-03-07T09:00', '2026-03-08T09:00', '2026-03-09T09:00']);
    const fall = series(rule({ startDate: '2026-10-31', count: 3, durationMinutes: 95 }), false, 'America/New_York');
    expect(times(fall, '2026-10-30', '2026-11-04').map((item) => item.end)).toEqual(['2026-10-31T10:35', '2026-11-01T10:35', '2026-11-02T10:35']);
  });
  it('时长按墙上分钟：跨春季跳时两小时钟面范围实际经过一小时', () => {
    const block = series(rule({ startDate: '2026-03-08', localTime: '01:30', durationMinutes: 120, count: 1 }), false, 'America/New_York');
    expect(times(block, '2026-03-07', '2026-03-10')).toEqual([{ date: '2026-03-08', start: '2026-03-08T01:30', end: '2026-03-08T03:30', elapsed: 60 }]);
  });
  it('不存在的开始钟点前移，时长从实际墙上开始算起保持正数', () => {
    const block = series(rule({ startDate: '2026-03-08', localTime: '02:30', durationMinutes: 60, count: 1 }), false, 'America/New_York');
    expect(times(block, '2026-03-07', '2026-03-10')).toEqual([{ date: '2026-03-08', start: '2026-03-08T03:30', end: '2026-03-08T04:30', elapsed: 60 }]);
  });
  it('跨秋季回拨选较早开始；一小时钟面时长实际经过两小时', () => {
    const block = series(rule({ startDate: '2026-11-01', localTime: '01:30', durationMinutes: 60, count: 1 }), false, 'America/New_York');
    const result = expandBlocks([block], [], '2026-10-31', '2026-11-03');
    expect(result[0].block).toMatchObject({ startAt: '2026-11-01T05:30:00.000Z', endAt: '2026-11-01T07:30:00.000Z' });
    expect(times(block, '2026-10-31', '2026-11-03')[0].elapsed).toBe(120);
  });
});

describe('单次取消与替换', () => {
  it('取消本次不消耗或延长次数，后续周不变', () => {
    const block = series(rule({ frequency: 'weekly', weekdays: [2], count: 3, durationMinutes: 1440 }));
    expect(dates(block, '2026-12-28', '2027-01-20', [exception('2027-01-05')])).toEqual(['2026-12-29', '2027-01-12']);
  });
  it('仅本次可改时改标题改层级，不影响整个系列', () => {
    const block = series(rule({ durationMinutes: 1440, count: 3 }));
    const edit = exception('2026-12-30', { cancelled: false, replacement: { title: '补课', description: '改时', display: 'background', color: '#123456',
      range: { allDay: false, timeZone: 'Asia/Shanghai', startAt: '2026-12-30T10:00:00.000Z', endAt: '2026-12-30T11:00:00.000Z' } } });
    const result = expandBlocks([block], [edit], '2026-12-29', '2027-01-02');
    expect(result).toHaveLength(3);
    const changed = result.find((item) => item.occurrenceDate === '2026-12-30')!;
    expect(changed.block).toMatchObject({ title: '补课', display: 'background', allDay: false, timeZone: 'Asia/Shanghai' });
    expect('startDate' in changed.block).toBe(false);
    expect(result.filter((item) => item.occurrenceDate !== '2026-12-30').every((item) => item.block.type === 'event' && item.block.title === '课程')).toBe(true);
  });
  it('原发生日在窗口外但被改入窗口时仍显示一次；移出窗口则不显示', () => {
    const block = series(rule({ durationMinutes: 1440 }));
    const moved = exception('2026-12-29', { cancelled: false, replacement: { title: '移入', description: '', display: 'normal',
      range: { allDay: true, timeZone: 'UTC', startDate: '2027-03-01', endDate: '2027-03-02' } } });
    expect(expandBlocks([block], [moved], '2027-03-01', '2027-03-02').filter((item) => item.occurrenceDate === '2026-12-29')).toHaveLength(1);
    expect(dates(block, '2026-12-29', '2026-12-30', [moved])).toEqual([]);
  });
  it('整个系列新规则生效，旧的非匹配例外不产生幽灵实例', () => {
    const block = series(rule({ frequency: 'weekly', weekdays: [4], durationMinutes: 1440 }));
    const obsolete = exception('2026-12-29', { cancelled: false, replacement: { title: '旧例外', description: '', display: 'normal',
      range: { allDay: true, timeZone: 'UTC', startDate: '2026-12-30', endDate: '2026-12-31' } } });
    expect(dates(block, '2026-12-29', '2027-01-08', [obsolete])).toEqual(['2026-12-31', '2027-01-07']);
  });
  it('背景系列自动继承显示层级与颜色', () => {
    const block = series(rule({ durationMinutes: 1440, count: 2 }));
    if (block.type !== 'event') throw new Error('应为独立日程');
    block.display = 'background'; block.color = '#abcdef';
    expect(expandBlocks([block], [], '2026-12-29', '2026-12-31').every((item) => item.block.type === 'event' && item.block.display === 'background' && item.block.color === '#abcdef')).toBe(true);
  });
});
