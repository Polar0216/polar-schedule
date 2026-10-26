import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { addDays, fromLocalInput, isDateOnly, isTimeZone, toLocalInput } from './dates';

describe('日期与时间边界', () => {
  it('验证真实日期，支持闰年', () => {
    expect(isDateOnly('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', 'garbage']) expect(isDateOnly(bad)).toBe(false);
  });
  it('本地时间转 UTC 后可还原，跨年不偏移', () => {
    for (const value of ['2026-12-31T23:30', '2027-01-01T00:30', '2028-02-29T09:00']) {
      expect(toLocalInput(fromLocalInput(value))).toBe(value);
      expect(fromLocalInput(value)).toMatch(/Z$/);
    }
  });
  it('拒绝不合法的日期与时间', () => {
    for (const bad of ['2026-02-30T09:00', '2026-10-19T25:00', '2026-10-19', '']) expect(() => fromLocalInput(bad)).toThrow();
  });
  it('纯日期加减跨月、跨年、闰日', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
  it('只接受有效时区', () => {
    expect(isTimeZone('Asia/Shanghai')).toBe(true);
    expect(isTimeZone('America/New_York')).toBe(true);
    expect(isTimeZone('Moon/Sea')).toBe(false);
  });
  it('在隔离的纽约时区进程验证 DST 跳时与回拨，以及全天不漂移', () => {
    const script = `import { fromLocalInput, toLocalInput, addDays } from './src/domain/dates.ts';
      let rejected = false; try { fromLocalInput('2026-03-08T02:30'); } catch { rejected = true; }
      console.log(JSON.stringify({ rejected,
        before: fromLocalInput('2026-03-08T01:30'), after: fromLocalInput('2026-03-08T03:30'),
        fall: toLocalInput(fromLocalInput('2026-11-01T01:30')),
        date: addDays('2026-03-08', 1) }));`;
    const result: unknown = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
    }));
    expect(result).toEqual({ rejected: true, before: '2026-03-08T06:30:00.000Z', after: '2026-03-08T07:30:00.000Z', fall: '2026-11-01T01:30', date: '2026-03-09' });
  });
});
