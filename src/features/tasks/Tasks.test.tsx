import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskEditor, TasksPanel } from './Tasks';
import { TagsDialog } from './TagsDialog';
import { INBOX_ID } from '../../domain/schema';
import { ScheduleDatabase, ScheduleRepository } from '../../storage/database';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../app/Store', () => ({ useStore: () => state.value }));
vi.mock('../../hooks/useTaskDrag', () => ({ useTaskDrag: () => () => undefined }));
let db: ScheduleDatabase;
let repo: ScheduleRepository;
const saved = vi.fn();
const editorProps = { defaultListId: null, onClose: vi.fn(), onSaved: saved, onSchedule: vi.fn(), onBlock: vi.fn() };

beforeEach(async () => {
  saved.mockClear(); db = new ScheduleDatabase(`task-ui-${crypto.randomUUID()}`); repo = new ScheduleRepository(db); await repo.initialize();
  state.value = { data: await repo.snapshot(), repo, saving: false, error: null, clearError: vi.fn(),
    run: async (operation: () => Promise<unknown>) => { const result = await operation(); state.value.data = await repo.snapshot(); return result; } };
});
afterEach(async () => { await db.delete(); });

describe('任务子任务和标签交互', () => {
  it('新增、勾选、重排、重命名子任务和多选标签随父任务保存，父任务仍待办且不生成日程', async () => {
    const tag = await repo.saveTag({ title: '考试', color: '#123456' }); state.value.data = await repo.snapshot();
    render(<TaskEditor taskId="new" {...editorProps} />);
    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '实验报告' } });
    for (const title of ['整理数据', '写结论']) {
      fireEvent.change(screen.getByLabelText('新子任务'), { target: { value: title } }); fireEvent.click(screen.getByLabelText('添加子任务'));
    }
    fireEvent.click(screen.getByLabelText('完成子任务 整理数据'));
    fireEvent.click(screen.getByLabelText('子任务上移 写结论'));
    fireEvent.change(screen.getByLabelText('子任务标题 2'), { target: { value: '检查数据' } });
    fireEvent.click(screen.getByLabelText('任务标签 考试'));
    fireEvent.click(screen.getByText('保存任务'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const data = await repo.snapshot();
    expect(data.tasks[0]).toMatchObject({ status: 'todo', tagIds: [tag] });
    expect(data.tasks[0].subtasks.map((s) => [s.title, s.done, s.order])).toEqual([['写结论', false, 0], ['检查数据', true, 1]]);
    expect(data.scheduleBlocks).toHaveLength(0);
  });
  it('删除单个子任务及手动完成父任务不会删除其他子任务', async () => {
    const keep = crypto.randomUUID();
    const id = await repo.saveTask({ title: '任务', listId: INBOX_ID, status: 'todo', priority: 'none', description: '',
      subtasks: [{ id: keep, title: '保留步骤', done: false, order: 0 }, { id: crypto.randomUUID(), title: '多余步骤', done: false, order: 1 }] });
    state.value.data = await repo.snapshot();
    render(<TaskEditor taskId={id} {...editorProps} />);
    fireEvent.click(screen.getByLabelText('删除子任务 多余步骤'));
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } }); fireEvent.click(screen.getByText('保存任务'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect((await repo.snapshot()).tasks[0]).toMatchObject({ status: 'done', subtasks: [{ id: keep, title: '保留步骤', done: false, order: 0 }] });
  });
  it('标签创建、改名、改色和确认删除均通过表单保存', async () => {
    render(<TagsDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '复习' } }); fireEvent.click(screen.getByText('创建标签'));
    await screen.findByLabelText('编辑标签 复习');
    fireEvent.click(screen.getByLabelText('编辑标签 复习'));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '期末复习' } });
    fireEvent.click(screen.getByRole('button', { name: '选择标签颜色' }));
    fireEvent.change(screen.getByLabelText('标签颜色 HEX'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: '确认颜色' })); fireEvent.click(screen.getByText('保存标签'));
    await screen.findByLabelText('删除标签 期末复习'); expect((await repo.snapshot()).tags[0]).toMatchObject({ title: '期末复习', color: '#123456', revision: 2 });
    fireEvent.click(screen.getByLabelText('删除标签 期末复习')); fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => expect(screen.queryByLabelText('删除标签 期末复习')).not.toBeInTheDocument());
    expect((await repo.snapshot()).tags).toHaveLength(0);
  });
  it('面板搜索跨清单标题及描述，并清楚标明归档范围', async () => {
    const listId = await repo.saveList({ title: '项目', icon: 'code', color: '#123456' });
    await repo.saveTask({ title: '实验报告', listId: INBOX_ID, description: '', status: 'todo', priority: 'none' });
    await repo.saveTask({ title: '另一任务', listId, description: '实验报告的参考资料', status: 'todo', priority: 'none' });
    state.value.data = await repo.snapshot();
    render(<TasksPanel listId={INBOX_ID} filter="all" onFilter={vi.fn()} onEdit={vi.fn()} onSchedule={vi.fn()} />);
    expect(screen.getAllByTestId('task-card')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('搜索任务'), { target: { value: '实验报告' } });
    expect(screen.getAllByTestId('task-card')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('跨清单 · 含隐藏清单 · 不含归档清单');
    fireEvent.click(screen.getByText('清除搜索筛选')); expect(screen.getAllByTestId('task-card')).toHaveLength(1);
  });
  it('截止筛选非法日期保留草稿并提示，不静默筛空；修正合法日期后恢复过滤', async () => {
    await repo.saveTask({ title: '二十三日截止', listId: INBOX_ID, description: '', status: 'todo', priority: 'none', dueDate: '2026-10-23' });
    await repo.saveTask({ title: '二十五日截止', listId: INBOX_ID, description: '', status: 'todo', priority: 'none', dueDate: '2026-10-25' });
    state.value.data = await repo.snapshot();
    render(<TasksPanel listId={null} filter="all" onFilter={vi.fn()} onEdit={vi.fn()} onSchedule={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('搜索筛选'));
    fireEvent.change(screen.getByLabelText('截止日期从'), { target: { value: '2026-2-1' } });
    expect(screen.getByLabelText('截止日期从')).toHaveValue('2026-2-1');
    expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getAllByTestId('task-card')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('截止日期从'), { target: { value: '2026-10-24' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getAllByTestId('task-card')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '二十五日截止' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('截止日期至'), { target: { value: '2026-02-30' } });
    expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getAllByTestId('task-card')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('截止日期至'), { target: { value: '2026-10-25' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getAllByTestId('task-card')).toHaveLength(1);
    expect((await repo.snapshot()).tasks.map((task) => task.dueDate).sort()).toEqual(['2026-10-23', '2026-10-25']);
  });
});
