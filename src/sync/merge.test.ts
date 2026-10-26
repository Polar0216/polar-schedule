import { describe, expect, it } from 'vitest';
import { fixture } from './testSupport';
import { merge } from './merge';
import { decodeSnapshot, encodeSnapshot, fingerprint, localSettings, project } from './snapshotCodec';
import { INBOX_ID, type ScheduleData } from '../domain/schema';

describe('稳定快照和安全三方合并', () => {
  it('UTF8往返完整、设备设置不上传，普通v3不混入同步字段', () => {
    const data = fixture(); data.tasks[0].title = '<script>中文🧊</script>'; data.settings.theme = 'dark'; data.settings.sidebarCollapsed = true;
    const encoded = encodeSnapshot(data), restored = decodeSnapshot(encoded);
    expect(restored.tasks).toEqual(data.tasks); expect(encoded).not.toContain('theme'); expect(encoded).not.toContain('sidebarCollapsed');
    expect(localSettings(restored, data).settings).toEqual(data.settings);
    expect(fingerprint({ ...data, updatedAt: new Date().toISOString(), settings: { ...data.settings, theme: 'light' } })).toBe(fingerprint(data));
    expect(encodeSnapshot({ ...data, tasks: [...data.tasks].reverse() })).toBe(encoded);
  });
  it.each(['{}', '{', '{"format":"unknown"}', '{"format":"polar-schedule-snapshot","formatVersion":2}'])('拒绝损坏/未知格式 %s', (raw) => expect(() => decodeSnapshot(raw)).toThrow());
  it('拒绝大文件和不存在的关联，不截断', () => {
    expect(() => decodeSnapshot(' '.repeat(1024 * 1024 + 1))).toThrow('1 MB');
    const data = fixture(); data.tasks[0].listId = crypto.randomUUID(); expect(() => encodeSnapshot(data)).toThrow();
    const large = fixture(60); large.tasks.forEach((task) => { task.description = '中'.repeat(20000); }); expect(() => encodeSnapshot(large)).toThrow('1 MB');
  });
  it('不同任务与同时新增不同ID自动并集', () => {
    const base = fixture(), l = structuredClone(base), r = structuredClone(base);
    l.tasks[0].title = 'A'; r.tasks[1].title = 'B';
    l.tasks.push({ ...l.tasks[0], id: crypto.randomUUID(), title: 'newA' }); r.tasks.push({ ...r.tasks[0], id: crypto.randomUUID(), title: 'newB' });
    const result = merge(base, l, r); expect(result.conflicts).toEqual([]); expect(result.data?.tasks.map((t) => t.title).sort()).toEqual(['A', 'B', 'newA', 'newB']);
  });
  it('同ID不同修改不按时间选胜者，显式选择且保留原输入', () => {
    const base = fixture(), l = structuredClone(base), r = structuredClone(base); l.tasks[0].title = 'local'; r.tasks[0].title = 'remote'; r.tasks[0].updatedAt = '2099-01-01T00:00:00.000Z';
    const conflict = merge(base, l, r); expect(conflict.conflicts).toHaveLength(1);
    expect(merge(base, l, r, { [conflict.conflicts[0].key]: 'local' }).data?.tasks[0].title).toBe('local'); expect(r.tasks[0].title).toBe('remote');
  });
  it('相同编辑无冲突、无重复', () => {
    const base = fixture(), l = structuredClone(base); l.tasks[0].title = 'same';
    expect(merge(base, l, structuredClone(l)).conflicts).toEqual([]); expect(merge(base, l, l).data?.tasks).toHaveLength(2);
  });
  it('删除/编辑冲突与墓碑/重建冲突；单边删除不复活', () => {
    const base = fixture(), l = structuredClone(base), r = structuredClone(base); const id = base.tasks[0].id;
    l.tasks.shift(); l.tombstones.push({ entityType: 'task', id, deletedAt: base.updatedAt }); r.tasks[0].title = 'edited';
    expect(merge(base, l, r).conflicts).toHaveLength(1); expect(merge(base, l, base).data?.tasks.some((t) => t.id === id)).toBe(false);
    const recreated = structuredClone(l); recreated.tombstones = []; recreated.tasks.push({ ...base.tasks[0], title: 'reborn' });
    const other = structuredClone(l); other.tombstones[0].deletedAt = '2026-10-24T01:00:00.000Z';
    expect(merge(l, recreated, other).conflicts).toHaveLength(1);
  });
  it('新建同ID冲突，清单删除与新任务引用不自动伪造，整端选择可恢复', () => {
    const base = fixture(0), l = fixture(1), r = fixture(1); r.tasks[0].title = 'collision'; expect(merge(base, l, r).conflicts).toHaveLength(1);
    const list = { ...base.lists[0], id: crypto.randomUUID(), title: '可删除' }; base.lists.push(list);
    const a = structuredClone(base), b = structuredClone(base); a.lists.pop(); a.tombstones.push({ entityType: 'list', id: list.id, deletedAt: base.updatedAt });
    b.tasks = [{ ...fixture(1).tasks[0], listId: list.id }];
    expect(merge(base, a, b).conflicts.some((c) => c.key === 'references')).toBe(true);
    expect(merge(base, a, b, { references: 'remote' }).data?.lists).toHaveLength(2);
  });
  it('父任务/多个独立完成段、背景系列/例外、标签子任务完整保存', () => {
    const data = fixture(1), meta = { revision: 1, createdAt: data.updatedAt, updatedAt: data.updatedAt };
    const tag = { ...meta, id: crypto.randomUUID(), title: '标', color: '#123456' }; data.tags = [tag]; data.tasks[0].tagIds = [tag.id];
    data.tasks[0].subtasks = [{ id: crypto.randomUUID(), title: '子', done: true, order: 0 }];
    const range = { allDay: false as const, startAt: data.updatedAt, endAt: '2026-10-23T02:00:00.000Z', timeZone: 'Asia/Shanghai' };
    data.scheduleBlocks = ['pending', 'completed'].map((status) => ({ ...range, ...meta, id: crypto.randomUUID(), type: 'task', taskId: data.tasks[0].id,
      executionStatus: status as 'pending' | 'completed', ...(status === 'completed' ? { completedAt: data.updatedAt } : {}) }));
    const series: ScheduleData['scheduleBlocks'][number] = { ...range, ...meta, id: crypto.randomUUID(), type: 'event', title: '系列', description: '', display: 'background',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [5], startDate: '2026-10-23', localTime: '09:00', durationMinutes: 60 } };
    data.scheduleBlocks.push(series); data.exceptions = [{ ...meta, id: crypto.randomUUID(), seriesId: series.id, occurrenceDate: '2026-10-30', cancelled: true }];
    const restored = decodeSnapshot(encodeSnapshot(data)); expect(restored).toEqual(project(data));
    const l = structuredClone(data), r = structuredClone(data); l.tasks[0].status = 'done'; l.tasks[0].completedAt = data.updatedAt; r.exceptions[0].revision++;
    const merged = merge(data, l, r); expect(merged.conflicts).toEqual([]); expect(merged.data?.scheduleBlocks).toEqual(project(data).scheduleBlocks);
    expect(merged.data?.tasks[0].listId).toBe(INBOX_ID);
  });
});
