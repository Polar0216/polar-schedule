import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BlockDialog } from './BlockDialog';
import { initialData, INBOX_ID, type ScheduleData } from '../../domain/schema';
import { ScheduleDatabase, ScheduleRepository } from '../../storage/database';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../app/Store', () => ({ useStore: () => state.value }));
let db: ScheduleDatabase;
let repo: ScheduleRepository;
let data: ScheduleData;
const close = vi.fn();

beforeEach(async () => {
  close.mockClear();
  db = new ScheduleDatabase(`form-${crypto.randomUUID()}`); repo = new ScheduleRepository(db); await repo.initialize();
  data = initialData();
  state.value = { data, repo, run: (op: () => Promise<unknown>) => op(), saving: false, error: null, clearError: vi.fn() };
});
afterEach(async () => { await db.delete(); });

describe('安排表单交互', () => {
  it('反向时间提示且不写入；修正成跨日后保存', async () => {
    render(<BlockDialog editor={{ selection: { allDay: false, start: '2026-12-31T23:00', end: '2027-01-01T01:00' } }} onClose={close} />);
    fireEvent.change(screen.getByLabelText('日程标题'), { target: { value: '跨年专注' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-12-31T22:00' } });
    fireEvent.click(screen.getByText('保存安排'));
    expect(screen.getByRole('alert')).toHaveTextContent('结束时间必须晚于');
    expect((await repo.snapshot()).scheduleBlocks).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2027-01-01T01:00' } });
    fireEvent.click(screen.getByText('保存安排'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ type: 'event', title: '跨年专注', allDay: false, display: 'normal' });
  });
  it('全天输入的结束日包含当天，存储为排他区间', async () => {
    render(<BlockDialog editor={{ selection: { allDay: true, start: '2026-12-31', end: '2027-01-02' } }} onClose={close} />);
    expect(screen.getByLabelText('结束日期')).toHaveValue('2027-01-01');
    fireEvent.change(screen.getByLabelText('日程标题'), { target: { value: '假期' } });
    fireEvent.click(screen.getByText('保存安排'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ allDay: true, startDate: '2026-12-31', endDate: '2027-01-02' });
  });
  it('任务表单仅添加关联时间块，不复制任务或修改截止日期', async () => {
    const id = await repo.saveTask({ title: '实验报告', listId: INBOX_ID, description: '', status: 'todo', priority: 'high', dueDate: '2026-10-23' });
    state.value.data = await repo.snapshot();
    render(<BlockDialog editor={{ taskId: id, selection: { allDay: false, start: '2026-10-21T19:00', end: '2026-10-21T21:00' } }} onClose={close} />);
    expect(screen.queryByLabelText('日程标题')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('保存安排'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const saved = await repo.snapshot();
    expect(saved.tasks).toHaveLength(1); expect(saved.tasks[0]).toMatchObject({ status: 'todo', dueDate: '2026-10-23' });
    expect(saved.scheduleBlocks[0]).toMatchObject({ type: 'task', taskId: id });
  });
  it('现有任务安排改时保留导入的自定义颜色与本次完成时间', async () => {
    const taskId = await repo.saveTask({ title: '带颜色安排', listId: INBOX_ID, description: '', status: 'todo', priority: 'none' });
    const id = await repo.saveBlock({ type: 'task', taskId, color: '#123456', executionStatus: 'completed',
      allDay: false, startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T01:00:00.000Z', timeZone: 'Asia/Shanghai' });
    const snapshot = await repo.snapshot(); const block = snapshot.scheduleBlocks.find((item) => item.id === id)!;
    if (block.type !== 'task') throw new Error('应为任务安排');
    state.value.data = snapshot;
    render(<BlockDialog editor={{ block }} onClose={close} />);
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-10-19T10:30' } });
    fireEvent.click(screen.getByText('保存安排'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ id, color: '#123456', executionStatus: 'completed', completedAt: block.completedAt });
  });
  it('移除背景选择入口后，编辑旧背景仍保留原display字段与ID', async () => {
    const id = await repo.saveBlock({ type: 'event', title: '旧背景课程', description: '保留既有属性', display: 'background', color: '#123456',
      allDay: false, startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T02:00:00.000Z', timeZone: 'Asia/Shanghai' });
    state.value.data = await repo.snapshot();
    render(<BlockDialog editor={{ block: (await repo.snapshot()).scheduleBlocks[0] }} onClose={close} />);
    expect(screen.queryByLabelText('日历呈现方式')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('日程标题'), { target: { value: '改名的旧课程' } });
    fireEvent.click(screen.getByText('保存安排')); await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect((await repo.snapshot()).scheduleBlocks[0]).toMatchObject({ id, type: 'event', title: '改名的旧课程', display: 'background', color: '#123456' });
  });
});
