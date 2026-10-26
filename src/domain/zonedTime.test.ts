import { describe, expect, it } from 'vitest';
import { addWallMinutes, wallTimeToInstant, zonedLocalInput } from './zonedTime';

describe('IANA 墙上时间转换', () => {
  it('使用指定时区，与浏览器时区无关，并跨年还原', () => {
    expect(wallTimeToInstant('2027-01-01T00:30', 'Asia/Shanghai')).toBe('2026-12-31T16:30:00.000Z');
    expect(zonedLocalInput('2026-12-31T16:30:00.000Z', 'Asia/Shanghai')).toBe('2027-01-01T00:30');
    expect(wallTimeToInstant('2026-10-19T12:15', 'Asia/Kathmandu')).toBe('2026-10-19T06:30:00.000Z');
  });
  it('纽约春季不存在的02:30按跳时差前移到03:30', () => {
    expect(wallTimeToInstant('2026-03-08T01:30', 'America/New_York')).toBe('2026-03-08T06:30:00.000Z');
    const skipped = wallTimeToInstant('2026-03-08T02:30', 'America/New_York');
    expect(skipped).toBe('2026-03-08T07:30:00.000Z');
    expect(zonedLocalInput(skipped, 'America/New_York')).toBe('2026-03-08T03:30');
  });
  it('纽约秋季重复01:30选择较早的一次', () => {
    expect(wallTimeToInstant('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    expect(zonedLocalInput('2026-11-01T06:30:00.000Z', 'America/New_York')).toBe('2026-11-01T01:30');
  });
  it('支持30分钟的跳时和整日跳时', () => {
    const lordHowe = wallTimeToInstant('2026-10-04T02:15', 'Australia/Lord_Howe');
    expect(zonedLocalInput(lordHowe, 'Australia/Lord_Howe')).toBe('2026-10-04T02:45');
    const apia = wallTimeToInstant('2011-12-30T09:00', 'Pacific/Apia');
    expect(zonedLocalInput(apia, 'Pacific/Apia')).toBe('2011-12-31T09:00');
  });
  it('墙上分钟加法跨月、跨年和闰日', () => {
    expect(addWallMinutes('2026-12-31T23:30', 90)).toBe('2027-01-01T01:00');
    expect(addWallMinutes('2028-02-28T23:30', 60)).toBe('2028-02-29T00:30');
    expect(addWallMinutes('2028-03-01T00:30', -60)).toBe('2028-02-29T23:30');
  });
  it('拒绝无效日期、钟点、时区、瞬时值和非整数时长', () => {
    for (const bad of ['2026-02-29T09:00', '2026-10-19T24:00', '2026-10-19T09:99', 'bad']) {
      expect(() => wallTimeToInstant(bad, 'UTC')).toThrow();
    }
    expect(() => wallTimeToInstant('2026-10-19T09:00', 'Moon/Sea')).toThrow();
    expect(() => zonedLocalInput('bad', 'UTC')).toThrow();
    expect(() => addWallMinutes('2026-10-19T09:00', 0.5)).toThrow();
  });
});
