import { describe, expect, it } from 'vitest';
import { initialData, INBOX_ID, type List, type Task } from './schema';
import { selectTasks } from './selectors';

const meta = (id = crypto.randomUUID()) => ({ id, revision: 1, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' });
function fixture() {
  const data = initialData();
  const hidden: List = { ...meta(), title: '隐藏项目', color: '#123456', icon: 'code', order: 1, archived: false };
  const archived: List = { ...hidden, ...meta(), title: '归档项目', order: 2, archived: true };
  const tag = { ...meta(), title: '考试', color: '#654321' };
  data.lists.push(hidden, archived); data.tags.push(tag); data.settings.hiddenListIds.push(hidden.id);
  const task = (title: string, listId: string, values: Partial<Task> = {}): Task => ({
    ...meta(), title, listId, description: '整理 Physics 数据', status: 'todo', priority: 'none', order: 0,
    subtasks: [], tagIds: [], ...values,
  });
  data.tasks = [
    task('实验报告', INBOX_ID, { dueDate: '2026-10-23', tagIds: [tag.id], status: 'in_progress' }),
    task('隐藏实验', hidden.id, { dueDate: '2026-10-24', tagIds: [tag.id], order: 1 }),
    task('归档实验', archived.id, { dueDate: '2026-10-25', order: 2 }),
    task('没有截止日期', INBOX_ID, { description: '', order: 3 }),
  ];
  return { data, hidden, archived, tag };
}

describe('跨清单搜索和组合筛选', () => {
  it('保持原有总览显隐和直接选中隐藏清单的行为', () => {
    const { data, hidden } = fixture();
    expect(selectTasks(data, null, 'all').map((t) => t.title)).toEqual(['实验报告', '没有截止日期']);
    expect(selectTasks(data, hidden.id, 'all').map((t) => t.title)).toEqual(['隐藏实验']);
  });
  it('标题和描述均可搜索，忽略前后空白和英文大小写', () => {
    const { data } = fixture();
    expect(selectTasks(data, null, 'all', { query: ' 实验报告 ' })).toHaveLength(1);
    expect(selectTasks(data, null, 'all', { query: 'PHYSICS', includeHidden: true }).map((t) => t.title)).toEqual(['实验报告', '隐藏实验']);
    expect(selectTasks(data, null, 'all', { query: '<script>' })).toHaveLength(0);
  });
  it('隐藏和归档分别包含，指定清单搜索也尊重范围开关', () => {
    const { data, hidden } = fixture();
    expect(selectTasks(data, null, 'all', { query: '实验', includeHidden: true })).toHaveLength(2);
    expect(selectTasks(data, null, 'all', { query: '实验', includeHidden: true, includeArchived: true })).toHaveLength(3);
    expect(selectTasks(data, hidden.id, 'all', { query: '实验' })).toHaveLength(0);
  });
  it('按清单、标签、具体状态及包含两端的截止日期组合筛选', () => {
    const { data, tag } = fixture();
    expect(selectTasks(data, INBOX_ID, 'all', { tagId: tag.id, status: 'in_progress', dueAfter: '2026-10-23', dueBefore: '2026-10-23' }).map((t) => t.title)).toEqual(['实验报告']);
    expect(selectTasks(data, null, 'all', { dueAfter: '2026-10-24', dueBefore: '2026-10-23', includeHidden: true })).toHaveLength(0);
    expect(selectTasks(data, null, 'all', { dueBefore: '2026-10-23' }).map((t) => t.title)).toEqual(['实验报告']);
  });
  it('搜索结果保持手动顺序，再以创建时间和 ID 稳定排序', () => {
    const { data } = fixture();
    data.tasks[1].order = -1;
    const before = data.tasks.map((t) => t.id);
    expect(selectTasks(data, null, 'all', { query: '实验', includeHidden: true }).map((t) => t.title)).toEqual(['隐藏实验', '实验报告']);
    expect(data.tasks.map((t) => t.id)).toEqual(before);
  });
});
