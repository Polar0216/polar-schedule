import { z } from 'zod';
// Frozen Phase 1 validator: validate legacy data before adding any v2 defaults.
import { isDateOnly, isTimeZone } from './dates';

export const INBOX_ID = '00000000-0000-4000-8000-000000000001';
export const dateSchema = z.string().refine(isDateOnly, '日期必须是有效的 YYYY-MM-DD');
export const instantSchema = z.string().datetime({ precision: 3 }).refine(
  (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
  '时间必须是有效的 UTC ISO 8601',
);
const title = z.string().trim().min(1, '标题不能为空').max(200, '标题最多 200 字');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色格式无效');
const timeZone = z.string().refine(isTimeZone, 'IANA 时区无效');
const meta = {
  id: z.string().uuid(),
  revision: z.number().int().min(1),
  createdAt: instantSchema,
  updatedAt: instantSchema,
};
export const listSchema = z.object({
  ...meta, title, color,
  icon: z.enum(['inbox', 'book', 'code', 'heart', 'coffee', 'star', 'briefcase']),
  order: z.number().finite(),
  archived: z.boolean(),
}).strict();
export const taskSchema = z.object({
  ...meta, title, listId: z.string().uuid(),
  description: z.string().max(20000),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['none', 'low', 'medium', 'high']),
  dueDate: dateSchema.optional(),
  completedAt: instantSchema.optional(),
  order: z.number().finite(),
}).strict().superRefine((v, ctx) => {
  if ((v.status === 'done') !== Boolean(v.completedAt)) ctx.addIssue({
    code: 'custom', path: ['completedAt'], message: '完成状态与完成时间不一致',
  });
});

const eventDetails = { type: z.literal('event'), title, description: z.string().max(20000) };
const taskDetails = { type: z.literal('task'), taskId: z.string().uuid() };
const commonBlock = { ...meta, timeZone, color: color.optional() };
const timed = { allDay: z.literal(false), startAt: instantSchema, endAt: instantSchema };
const allDay = { allDay: z.literal(true), startDate: dateSchema, endDate: dateSchema };
export const blockSchema = z.union([
  z.object({ ...commonBlock, ...eventDetails, ...timed }).strict(),
  z.object({ ...commonBlock, ...eventDetails, ...allDay }).strict(),
  z.object({ ...commonBlock, ...taskDetails, ...timed }).strict(),
  z.object({ ...commonBlock, ...taskDetails, ...allDay }).strict(),
]).superRefine((v, ctx) => {
  if ((v.allDay && v.endDate <= v.startDate) || (!v.allDay && v.endAt <= v.startAt)) {
    ctx.addIssue({ code: 'custom', message: '结束时间必须晚于开始时间（全天结束日期不包含当天）' });
  }
});
export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  defaultView: z.enum(['day', 'week', 'month']),
  timeZone,
  hiddenListIds: z.array(z.string().uuid()),
  sidebarCollapsed: z.boolean(),
  tasksCollapsed: z.boolean(),
}).strict();
export const tombstoneSchema = z.object({
  entityType: z.enum(['list', 'task', 'scheduleBlock']),
  id: z.string().uuid(), deletedAt: instantSchema,
}).strict();
export const dataSchema = z.object({
  schemaVersion: z.literal(1),
  lists: z.array(listSchema).max(10000),
  tasks: z.array(taskSchema).max(100000),
  scheduleBlocks: z.array(blockSchema).max(200000),
  settings: settingsSchema,
  tombstones: z.array(tombstoneSchema).max(500000),
  updatedAt: instantSchema,
}).strict().superRefine((data, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const listIds = new Set(data.lists.map((l) => l.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));
  const blockIds = new Set(data.scheduleBlocks.map((b) => b.id));
  const ids = [...data.lists, ...data.tasks, ...data.scheduleBlocks].map((v) => v.id);
  if (new Set(ids).size !== ids.length) issue('存在重复实体 ID');
  const inbox = data.lists.find((l) => l.id === INBOX_ID);
  if (!inbox || inbox.archived || inbox.title !== '收集箱') issue('缺少有效的收集箱');
  if (data.tasks.some((t) => !listIds.has(t.listId))) issue('任务引用不存在的清单');
  if (data.scheduleBlocks.some((b) => b.type === 'task' && !taskIds.has(b.taskId))) issue('时间块引用不存在的任务');
  if (new Set(data.settings.hiddenListIds).size !== data.settings.hiddenListIds.length ||
      data.settings.hiddenListIds.some((id) => !listIds.has(id))) issue('隐藏清单引用无效');
  const keys = data.tombstones.map((t) => `${t.entityType}:${t.id}`);
  if (new Set(keys).size !== keys.length) issue('存在重复删除记录');
  if (data.tombstones.some((t) => (t.entityType === 'list' ? listIds : t.entityType === 'task' ? taskIds : blockIds).has(t.id))) {
    issue('删除记录与现存实体冲突');
  }
});

export type List = z.infer<typeof listSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ScheduleBlock = z.infer<typeof blockSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ScheduleData = z.infer<typeof dataSchema>;
export type Tombstone = z.infer<typeof tombstoneSchema>;
export type TimeRange =
  | { allDay: false; startAt: string; endAt: string; timeZone: string }
  | { allDay: true; startDate: string; endDate: string; timeZone: string };
export type BlockInput = TimeRange & (
  | { type: 'event'; title: string; description: string; color?: string }
  | { type: 'task'; taskId: string; color?: string }
);
export type TaskInput = Pick<Task, 'title' | 'description' | 'listId' | 'priority' | 'status' | 'dueDate'>;
export type ListInput = Pick<List, 'title' | 'color' | 'icon'>;
