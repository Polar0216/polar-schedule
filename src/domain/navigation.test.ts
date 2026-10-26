import { describe, expect, it } from 'vitest';
import { resolveDateEntry } from './navigation';

describe('直接日期跳转', () => {
  it('保留无时区日期、跨年和闰日，不转换UTC午夜', () => {
    expect(resolveDateEntry('2028-02-29')).toBe('2028-02-29');
    expect(resolveDateEntry(' 2026-12-31 ')).toBe('2026-12-31');
    expect(resolveDateEntry('2000-02-29')).toBe('2000-02-29');
  });
  it('月份仅在月视图模式接受并落在该月第一天', () => {
    expect(resolveDateEntry('2027-12', true)).toBe('2027-12-01');
    expect(() => resolveDateEntry('2027-12')).toThrow('YYYY-MM-DD');
  });
  it('拒绝不存在日期、无效月份和含糊输入', () => {
    for (const input of ['2027-02-29', '1900-02-29', '2026-04-31', '2026-13', '2026-00-10', '2026-1-1', 'invalid']) {
      expect(() => resolveDateEntry(input, true)).toThrow('有效日期');
    }
  });
});
