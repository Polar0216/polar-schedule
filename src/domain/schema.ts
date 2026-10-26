import { z } from 'zod';
import { browserTimeZone, isDateOnly, isTimeZone } from './dates';
import { dataSchema as dataV1Schema } from './legacyV1';
import { dataSchema as dataV2Schema, type ScheduleData as ScheduleDataV2 } from './legacyV2';

export const INBOX_ID = '00000000-0000-4000-8000-000000000001';
export const dateSchema = z.string().refine(isDateOnly, '日期必须是有效的 YYYY-MM-DD');
export const instantSchema = z.string().datetime({ precision: 3 }).refine(
  (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
  '时间必须是有效的 UTC ISO 8601',
);
const title = z.string().trim().min(1, '标题不能为空').max(200, '标题最多 200 字');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色格式无效');
const timeZone = z.string().refine(isTimeZone, 'IANA 时区无效');
const clockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '请输入有效的 HH:mm');
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
export const subtaskSchema = z.object({ id: z.string().uuid(), title, done: z.boolean(), order: z.number().finite() }).strict();
export const tagSchema = z.object({ ...meta, title, color }).strict();
export const taskSchema = z.object({
  ...meta, title, listId: z.string().uuid(),
  description: z.string().max(20000),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['none', 'low', 'medium', 'high']),
  dueDate: dateSchema.optional(),
  completedAt: instantSchema.optional(),
  order: z.number().finite(),
  subtasks: z.array(subtaskSchema).max(1000),
  tagIds: z.array(z.string().uuid()).max(1000),
}).strict().superRefine((v, ctx) => {
  if ((v.status === 'done') !== Boolean(v.completedAt)) ctx.addIssue({
    code: 'custom', path: ['completedAt'], message: '完成状态与完成时间不一致',
  });
  if (new Set(v.subtasks.map((s) => s.id)).size !== v.subtasks.length || new Set(v.tagIds).size !== v.tagIds.length) {
    ctx.addIssue({ code: 'custom', message: '子任务或标签 ID 重复' });
  }
});

export const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']), interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  startDate: dateSchema, localTime: clockSchema, durationMinutes: z.number().int().min(1).max(44640),
  until: dateSchema.optional(), count: z.number().int().min(1).max(100000).optional(),
}).strict().superRefine((rule, ctx) => {
  if (rule.frequency === 'weekly' && rule.weekdays.length === 0) ctx.addIssue({ code: 'custom', message: '每周重复至少选择一个星期' });
  if (new Set(rule.weekdays).size !== rule.weekdays.length) ctx.addIssue({ code: 'custom', message: '重复星期不能重复' });
  if (rule.until && rule.until < rule.startDate) ctx.addIssue({ code: 'custom', message: '重复结束日期不能早于开始日期' });
  if (rule.until && rule.count) ctx.addIssue({ code: 'custom', message: '重复结束日期与次数只能选择一种' });
});
const displaySchema = z.enum(['normal', 'background']);
const eventDetails = { type: z.literal('event'), title, description: z.string().max(20000), display: displaySchema.default('normal'), recurrence: recurrenceSchema.optional() };
const taskDetails = { type: z.literal('task'), taskId: z.string().uuid(),
  executionStatus: z.enum(['pending', 'completed']).default('pending'), completedAt: instantSchema.optional() };
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
  if (v.type === 'event' && v.recurrence && v.allDay && v.recurrence.durationMinutes % 1440 !== 0) {
    ctx.addIssue({ code: 'custom', message: '全天重复日程的时长必须是完整天数' });
  }
  if (v.type === 'task' && (v.executionStatus === 'completed') !== Boolean(v.completedAt)) {
    ctx.addIssue({ code: 'custom', path: ['completedAt'], message: '本次执行状态与完成时间不一致' });
  }
});
export const timeRangeSchema = z.union([
  z.object({ ...timed, timeZone }).strict(), z.object({ ...allDay, timeZone }).strict(),
]).superRefine((range, ctx) => {
  if ((range.allDay && range.endDate <= range.startDate) || (!range.allDay && range.endAt <= range.startAt)) {
    ctx.addIssue({ code: 'custom', message: '结束时间必须晚于开始时间' });
  }
});
export const exceptionSchema = z.object({
  ...meta, seriesId: z.string().uuid(), occurrenceDate: dateSchema, cancelled: z.boolean(),
  replacement: z.object({ title, description: z.string().max(20000), color: color.optional(), display: displaySchema, range: timeRangeSchema }).strict().optional(),
}).strict().superRefine((item, ctx) => {
  if (item.cancelled === Boolean(item.replacement)) ctx.addIssue({ code: 'custom', message: '例外必须为取消或替换之一' });
});
export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  defaultView: z.enum(['day', 'week', 'month']),
  timeZone,
  hiddenListIds: z.array(z.string().uuid()),
  sidebarCollapsed: z.boolean(),
  tasksCollapsed: z.boolean(),
  slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]), density: z.enum(['compact', 'comfortable']),
  showBackground: z.boolean(), defaultDurationMinutes: z.number().int().min(15).max(480),
}).strict().superRefine((settings, ctx) => {
  if (settings.endHour <= settings.startHour) ctx.addIssue({ code: 'custom', message: '显示结束时间必须晚于开始时间' });
});
export const tombstoneSchema = z.object({
  entityType: z.enum(['list', 'task', 'scheduleBlock', 'tag', 'exception']),
  id: z.string().uuid(), deletedAt: instantSchema,
}).strict();
export const dataSchema = z.object({
  schemaVersion: z.literal(3),
  lists: z.array(listSchema).max(10000),
  tasks: z.array(taskSchema).max(100000),
  scheduleBlocks: z.array(blockSchema).max(200000),
  tags: z.array(tagSchema).max(10000),
  exceptions: z.array(exceptionSchema).max(200000),
  settings: settingsSchema,
  tombstones: z.array(tombstoneSchema).max(500000),
  updatedAt: instantSchema,
}).strict().superRefine((data, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const listIds = new Set(data.lists.map((l) => l.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));
  const blockIds = new Set(data.scheduleBlocks.map((b) => b.id));
  const tagIds = new Set(data.tags.map((t) => t.id));
  const exceptionIds = new Set(data.exceptions.map((e) => e.id));
  const ids = [...data.lists, ...data.tasks, ...data.scheduleBlocks, ...data.tags, ...data.exceptions, ...data.tasks.flatMap((t) => t.subtasks)].map((v) => v.id);
  if (new Set(ids).size !== ids.length) issue('存在重复实体 ID');
  const inbox = data.lists.find((l) => l.id === INBOX_ID);
  if (!inbox || inbox.archived || inbox.title !== '收集箱') issue('缺少有效的收集箱');
  if (data.tasks.some((t) => !listIds.has(t.listId))) issue('任务引用不存在的清单');
  if (data.scheduleBlocks.some((b) => b.type === 'task' && !taskIds.has(b.taskId))) issue('时间块引用不存在的任务');
  if (data.tasks.some((t) => t.tagIds.some((id) => !tagIds.has(id)))) issue('任务引用不存在的标签');
  if (data.exceptions.some((e) => !data.scheduleBlocks.some((b) => b.id === e.seriesId && b.type === 'event' && b.recurrence))) issue('例外引用不存在的重复系列');
  const occurrenceKeys = data.exceptions.map((e) => `${e.seriesId}:${e.occurrenceDate}`);
  if (new Set(occurrenceKeys).size !== occurrenceKeys.length) issue('重复系列的本次例外重复');
  if (new Set(data.settings.hiddenListIds).size !== data.settings.hiddenListIds.length ||
      data.settings.hiddenListIds.some((id) => !listIds.has(id))) issue('隐藏清单引用无效');
  const keys = data.tombstones.map((t) => `${t.entityType}:${t.id}`);
  if (new Set(keys).size !== keys.length) issue('存在重复删除记录');
  if (data.tombstones.some((t) => ({ list: listIds, task: taskIds, scheduleBlock: blockIds, tag: tagIds, exception: exceptionIds })[t.entityType].has(t.id))) {
    issue('删除记录与现存实体冲突');
  }
});

export type List = z.infer<typeof listSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ScheduleBlock = z.infer<typeof blockSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ScheduleData = z.infer<typeof dataSchema>;
export type Tombstone = z.infer<typeof tombstoneSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Subtask = z.infer<typeof subtaskSchema>;
export type RecurrenceRule = z.infer<typeof recurrenceSchema>;
export type RecurrenceException = z.infer<typeof exceptionSchema>;
export type TimeRange =
  | { allDay: false; startAt: string; endAt: string; timeZone: string }
  | { allDay: true; startDate: string; endDate: string; timeZone: string };
export type BlockInput = TimeRange & (
  | { type: 'event'; title: string; description: string; color?: string; display?: 'normal' | 'background'; recurrence?: RecurrenceRule }
  | { type: 'task'; taskId: string; color?: string; executionStatus?: 'pending' | 'completed'; completedAt?: string }
);
export type TaskInput = Pick<Task, 'title' | 'description' | 'listId' | 'priority' | 'status' | 'dueDate'> & Partial<Pick<Task, 'subtasks' | 'tagIds'>>;
export type ListInput = Pick<List, 'title' | 'color' | 'icon'>;

export function initialData(): ScheduleData {
  const now = new Date().toISOString();
  return {
    schemaVersion: 3,
    lists: [{ id: INBOX_ID, title: '收集箱', color: '#7774d5', icon: 'inbox', order: 0,
      archived: false, revision: 1, createdAt: now, updatedAt: now }],
    tasks: [], scheduleBlocks: [], tombstones: [], tags: [], exceptions: [], updatedAt: now,
    settings: { theme: 'system', defaultView: 'week', timeZone: browserTimeZone(), hiddenListIds: [],
      sidebarCollapsed: false, tasksCollapsed: false, ...phase2Settings },
  };
}

export const phase2Settings = { slotMinutes: 30 as const, startHour: 0, endHour: 24, weekStartsOn: 1 as const,
  density: 'comfortable' as const, showBackground: true, defaultDurationMinutes: 60 };

// Dexie's v1 -> v2 step must remain a genuine v2 state so a later v3 upgrade
// can validate/freeze that intermediate data before adding execution status.
export function migrateV1ToV2(raw: unknown): ScheduleDataV2 {
  const legacy = dataV1Schema.parse(raw);
  return dataV2Schema.parse({ ...legacy, schemaVersion: 2,
    tasks: legacy.tasks.map((t) => ({ ...t, subtasks: [], tagIds: [] })),
    scheduleBlocks: legacy.scheduleBlocks.map((b) => b.type === 'event' ? { ...b, display: 'normal' } : b),
    tags: [], exceptions: [], settings: { ...legacy.settings, ...phase2Settings },
  });
}

export function migrateData(raw: unknown): ScheduleData {
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    if (raw.schemaVersion === 1) return migrateData(migrateV1ToV2(raw));
    if (raw.schemaVersion === 2) {
      const legacy = dataV2Schema.parse(raw);
      return dataSchema.parse({ ...legacy, schemaVersion: 3,
        scheduleBlocks: legacy.scheduleBlocks.map((block) => block.type === 'task' ? { ...block, executionStatus: 'pending' } : block),
      });
    }
  }
  return dataSchema.parse(raw);
}

export function parseImport(text: string): ScheduleData {
  if (text.length > 30 * 1024 * 1024) throw new Error('文件超过 30 MB，请缩减数据后重试');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON'); }
  try { return migrateData(raw); }
  catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '数据'}：${i.message}`);
      throw new Error(`无法导入。${messages.join('；')}`);
    }
    throw error;
  }
}
