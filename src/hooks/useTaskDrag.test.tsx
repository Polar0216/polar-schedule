import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draggable } from '@fullcalendar/interaction';
import { useTaskDrag } from './useTaskDrag';

type Options = NonNullable<ConstructorParameters<typeof Draggable>[1]>;
const state = vi.hoisted(() => ({ instances: [] as { node: HTMLElement; options: Options; destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock('@fullcalendar/interaction', () => ({ Draggable: class {
  constructor(node: HTMLElement, options: Options) { state.instances.push({ node, options, destroy: this.destroy }); }
  destroy = vi.fn();
} }));

function Panel({ duration = 60, visible = true, nodeKey = 'panel', taskTitle = '任务' }) {
  const ref = useTaskDrag(duration);
  return visible ? <div key={nodeKey} ref={ref}><span className="drag-handle" data-task-id="task-id" data-task-title={taskTitle} /></div> : null;
}

beforeEach(() => { state.instances.length = 0; });

describe('任务外部拖拽的节点生命周期', () => {
  it('筛选重渲染委托同一容器，读取最新时长和标题，并且只由drop持久化', () => {
    const view = render(<Panel />);
    const original = state.instances[0];
    view.rerender(<Panel duration={90} taskTitle="筛选后的新任务" />);
    expect(state.instances).toHaveLength(1);
    const eventData = original.options.eventData;
    if (typeof eventData !== 'function') throw new Error('应从当前节点动态读取任务信息');
    const element = original.node.querySelector<HTMLElement>('.drag-handle');
    if (!element) throw new Error('任务手柄缺失');
    expect(eventData(element)).toMatchObject({ title: '筛选后的新任务', duration: { minutes: 90 }, create: false, extendedProps: { taskId: 'task-id' } });
    expect(original.options.itemSelector).toBe('.drag-handle[data-task-id]');
    view.unmount(); expect(original.destroy).toHaveBeenCalledOnce();
  });
  it('切换详情、返回待办以及实际容器被替换时销毁旧监听并重新绑定', () => {
    const view = render(<Panel />); const first = state.instances[0];
    view.rerender(<Panel visible={false} />); expect(first.destroy).toHaveBeenCalledOnce();
    view.rerender(<Panel />); const second = state.instances[1];
    expect(second.node).not.toBe(first.node);
    view.rerender(<Panel nodeKey="new-node" />);
    expect(second.destroy).toHaveBeenCalledOnce(); expect(state.instances).toHaveLength(3);
    view.unmount(); expect(state.instances[2].destroy).toHaveBeenCalledOnce();
  });
  it('React StrictMode 重新挂载后恰有一个活动实例，卸载后无残留', () => {
    const view = render(<StrictMode><Panel /></StrictMode>);
    expect(state.instances.filter((item) => item.destroy.mock.calls.length === 0)).toHaveLength(1);
    view.unmount();
    expect(state.instances.every((item) => item.destroy.mock.calls.length === 1)).toBe(true);
  });
});
