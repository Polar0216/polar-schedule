import type { ScheduleData, ScheduleBlock, Task } from './schema';
import { addDays, localDate } from './dates';

export type TaskFilter = 'incomplete' | 'unscheduled' | 'completed' | 'due' | 'all';
export const filterLabels: Record<TaskFilter, string> = {
  incomplete: '未完成', unscheduled: '未安排', completed: '已完成', due: '即将截止', all: '全部任务',
};
export const priorityLabels: Record<Task['priority'], string> = { none: '无优先级', low: '低', medium: '中', high: '高' };
export const statusLabels: Record<Task['status'], string> = { todo: '待办', in_progress: '进行中', done: '已完成' };

export interface TaskSearchOptions {
  query?: string;
  tagId?: string;
  status?: Task['status'] | 'all';
  dueAfter?: string;
  dueBefore?: string;
  includeArchived?: boolean;
  includeHidden?: boolean;
}

export function selectTasks(data: ScheduleData, listId: string | null, filter: TaskFilter, options?: TaskSearchOptions): Task[] {
  const search = options ?? {};
  const arranged = new Set(data.scheduleBlocks.flatMap((b) => b.type === 'task' ? [b.taskId] : []));
  const visible = new Set(data.lists.filter((l) => (search.includeArchived || !l.archived) &&
    (search.includeHidden || !data.settings.hiddenListIds.includes(l.id))).map((l) => l.id));
  const query = search.query?.trim().toLocaleLowerCase() ?? '';
  const today = localDate();
  const dueEnd = addDays(today, 7);
  return data.tasks.filter((t) => (listId ? t.listId === listId && (!options || visible.has(t.listId)) : visible.has(t.listId)) &&
    (!query || `${t.title}\n${t.description}`.toLocaleLowerCase().includes(query)) &&
    (!search.tagId || t.tagIds.includes(search.tagId)) &&
    (!search.status || search.status === 'all' || t.status === search.status) &&
    (!search.dueAfter || Boolean(t.dueDate && t.dueDate >= search.dueAfter)) &&
    (!search.dueBefore || Boolean(t.dueDate && t.dueDate <= search.dueBefore)) && (
    filter === 'all' ||
    (filter === 'incomplete' && t.status !== 'done') ||
    (filter === 'completed' && t.status === 'done') ||
    (filter === 'unscheduled' && t.status !== 'done' && !arranged.has(t.id)) ||
    (filter === 'due' && t.status !== 'done' && t.dueDate && t.dueDate <= dueEnd)
  )).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function blockTitle(block: ScheduleBlock, data: ScheduleData): string {
  return block.type === 'event' ? block.title : data.tasks.find((t) => t.id === block.taskId)?.title ?? '任务不存在';
}

export function visibleBlocks(data: ScheduleData, listId: string | null): ScheduleBlock[] {
  const visibleLists = new Set(data.lists.filter((l) => !l.archived && !data.settings.hiddenListIds.includes(l.id)).map((l) => l.id));
  const visibleTasks = new Set(data.tasks.filter((t) => visibleLists.has(t.listId) && (!listId || listId === t.listId)).map((t) => t.id));
  return data.scheduleBlocks.filter((b) => b.type === 'event' || visibleTasks.has(b.taskId));
}
