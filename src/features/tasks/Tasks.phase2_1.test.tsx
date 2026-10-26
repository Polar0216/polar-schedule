import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskEditor } from './Tasks';
import { INBOX_ID } from '../../domain/schema';
import { ScheduleDatabase, ScheduleRepository } from '../../storage/database';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../app/Store', () => ({ useStore: () => state.value }));
vi.mock('../../hooks/useTaskDrag', () => ({ useTaskDrag: () => () => undefined }));
let db: ScheduleDatabase;
let repo: ScheduleRepository;
const saved = vi.fn();
const editBlock = vi.fn();
const props = { defaultListId: null, onClose: vi.fn(), onSaved: saved, onSchedule: vi.fn(), onBlock: editBlock };

beforeEach(async () => {
  saved.mockClear(); editBlock.mockClear(); props.onSchedule.mockClear();
  db = new ScheduleDatabase(`compact-task-ui-${crypto.randomUUID()}`); repo = new ScheduleRepository(db); await repo.initialize();
  state.value = { data: await repo.snapshot(), repo, saving: false, error: null, clearError: vi.fn(),
    run: async (operation: () => Promise<unknown>) => { const result = await operation(); state.value.data = await repo.snapshot(); return result; } };
});
afterEach(async () => { await db.delete(); });

async function taskWithTwoBlocks() {
  const taskId = await repo.saveTask({ title: '分两次复习', description: '先整理，再复盘', listId: INBOX_ID, status: 'todo', priority: 'high', dueDate: '2026-10-23' });
  const one = await repo.saveBlock({ type: 'task', taskId, allDay: false, startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:00:00.000Z', timeZone: 'Asia/Shanghai' });
  const two = await repo.saveBlock({ type: 'task', taskId, allDay: false, startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T02:00:00.000Z', timeZone: 'Asia/Shanghai' });
  state.value.data = await repo.snapshot(); return { taskId, one, two };
}

describe('紧凑任务详情与每次安排', () => {
  it('主区先显示标题、整个任务状态、截止日期和执行安排，高级字段默认收起且可展开', async () => {
    const { taskId } = await taskWithTwoBlocks();
    render(<TaskEditor taskId={taskId} {...props} />);
    expect(screen.getByLabelText('任务标题')).toBeVisible(); expect(screen.getByLabelText('任务状态')).toBeVisible();
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-10-23');
    expect(screen.getByRole('region', { name: '任务执行安排' })).toBeVisible();
    expect(screen.getByLabelText('已完成安排 0/2')).toBeVisible();
    expect(screen.getByLabelText('任务描述')).not.toBeVisible();
    expect(screen.getByText('描述与任务属性').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('标签', { exact: true }).closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('子任务', { exact: true }).closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('描述与任务属性'));
    expect(screen.getByLabelText('任务描述')).toBeVisible();
    fireEvent.change(screen.getByLabelText('任务描述'), { target: { value: '保留高级编辑能力' } });
    fireEvent.click(screen.getByText('描述与任务属性')); fireEvent.click(screen.getByText('保存任务'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect((await repo.snapshot()).tasks[0]).toMatchObject({ description: '保留高级编辑能力', priority: 'high', dueDate: '2026-10-23' });
  });
  it('两段安排分别完成和撤销，刷新数据库后完成记录保留，整个任务不变', async () => {
    const { taskId, one, two } = await taskWithTwoBlocks();
    const view = render(<TaskEditor taskId={taskId} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^完成本次安排 第1段/ }));
    await waitFor(async () => expect((await repo.snapshot()).scheduleBlocks.find((block) => block.id === one)).toMatchObject({ executionStatus: 'completed' }));
    view.rerender(<TaskEditor taskId={taskId} {...props} />);
    expect(screen.getByLabelText('已完成安排 1/2')).toBeVisible();
    expect(screen.getByRole('button', { name: /^完成本次安排 第2段/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^完成本次安排 第2段/ }));
    await waitFor(async () => expect((await repo.snapshot()).scheduleBlocks.find((block) => block.id === two)).toMatchObject({ executionStatus: 'completed' }));
    view.rerender(<TaskEditor taskId={taskId} {...props} />);
    expect(screen.getByLabelText('已完成安排 2/2')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^撤销完成本次安排 第1段/ }));
    await waitFor(async () => expect((await repo.snapshot()).scheduleBlocks.find((block) => block.id === one)).toMatchObject({ executionStatus: 'pending' }));
    db.close(); await db.open(); const data = await repo.snapshot();
    expect(data.tasks[0]).toMatchObject({ id: taskId, status: 'todo' });
    expect(data.scheduleBlocks.find((block) => block.id === two)).toMatchObject({ executionStatus: 'completed', completedAt: expect.any(String) });
    expect(data.scheduleBlocks.find((block) => block.id === one)).toMatchObject({ completedAt: undefined });
  });
  it('整个任务手动完成不改两段执行记录，并保留直接编辑每段的入口', async () => {
    const { taskId, one, two } = await taskWithTwoBlocks();
    await repo.setBlockCompleted(one, true); state.value.data = await repo.snapshot();
    render(<TaskEditor taskId={taskId} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^编辑第2段安排/ })); expect(editBlock).toHaveBeenCalledWith(expect.objectContaining({ id: two }));
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'done' } });
    expect(screen.getByText(/仍有 1 段安排待执行/)).toBeVisible();
    fireEvent.click(screen.getByText('保存任务')); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const data = await repo.snapshot(); expect(data.tasks[0].status).toBe('done');
    expect(data.scheduleBlocks.find((block) => block.id === one)).toMatchObject({ executionStatus: 'completed' });
    expect(data.scheduleBlocks.find((block) => block.id === two)).toMatchObject({ executionStatus: 'pending' });
  });
  it('截止日期复用日期弹层，只选择日期，取消不会改任务或生成安排', () => {
    render(<TaskEditor taskId="new" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '选择截止日期' }));
    expect(screen.getByRole('dialog', { name: '选择截止日期' })).toBeVisible();
    expect(screen.queryByLabelText('截止日期小时')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '选择截止日期' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('截止日期')).toHaveValue(''); expect(saved).not.toHaveBeenCalled();
  });
  it('保存并安排时间同样校验折叠字段，自动展开无效子任务且不写入或打开安排', async () => {
    const taskId = await repo.saveTask({ title: '校验任务', listId: INBOX_ID, status: 'todo', priority: 'none', description: '',
      subtasks: [{ id: crypto.randomUUID(), title: '保留步骤', done: false, order: 0 }] });
    state.value.data = await repo.snapshot(); render(<TaskEditor taskId={taskId} {...props} />);
    fireEvent.click(screen.getByText('子任务', { exact: true }));
    fireEvent.change(screen.getByLabelText('子任务标题 1'), { target: { value: '' } });
    fireEvent.click(screen.getByText('子任务', { exact: true }));
    expect(screen.getByText('子任务', { exact: true }).closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('保存并安排时间'));
    expect(screen.getByText('子任务', { exact: true }).closest('details')).toHaveAttribute('open');
    expect(screen.getByLabelText('子任务标题 1')).toBeInvalid();
    expect(saved).not.toHaveBeenCalled(); expect(props.onSchedule).not.toHaveBeenCalled();
    expect((await repo.snapshot()).tasks[0].subtasks[0].title).toBe('保留步骤');
  });
});
