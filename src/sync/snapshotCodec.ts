import { z } from 'zod';
import { dataSchema, initialData, settingsSchema, type ScheduleData, type Settings } from '../domain/schema';

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
export const sharedSettingKeys = ['slotMinutes', 'startHour', 'endHour', 'weekStartsOn', 'defaultDurationMinutes'] as const;
const sharedSchema = z.object({ slotMinutes: settingsSchema.shape.slotMinutes, startHour: settingsSchema.shape.startHour,
  endHour: settingsSchema.shape.endHour, weekStartsOn: settingsSchema.shape.weekStartsOn, defaultDurationMinutes: settingsSchema.shape.defaultDurationMinutes }).strict();
const wrapper = z.object({ format: z.literal('polar-schedule-snapshot'), formatVersion: z.literal(1),
  data: z.object({ ...dataSchema.shape, settings: sharedSchema }).strict(),
}).strict();
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export function sharedSettings(settings: Settings) {
  return Object.fromEntries(sharedSettingKeys.map((key) => [key, settings[key]])) as Pick<Settings, typeof sharedSettingKeys[number]>;
}
export function project(data: ScheduleData): ScheduleData {
  const parsed = dataSchema.parse(data);
  const result = { ...parsed, settings: { ...initialData().settings, ...sharedSettings(parsed.settings) } };
  // Root time also changes for device-only UI edits. Derive it from domain records
  // so those edits never cause commits. Shared settings are compared by value.
  result.updatedAt = [...parsed.lists, ...parsed.tasks, ...parsed.scheduleBlocks, ...parsed.tags, ...parsed.exceptions]
    .map((item) => item.updatedAt).concat(parsed.tombstones.map((item) => item.deletedAt)).sort().at(-1) ?? '1970-01-01T00:00:00.000Z';
  for (const key of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions'] as const) result[key] = [...result[key]].sort((a, b) => a.id.localeCompare(b.id)) as never;
  result.tombstones = [...result.tombstones].sort((a, b) => `${a.entityType}:${a.id}`.localeCompare(`${b.entityType}:${b.id}`));
  return result;
}
function payload(data: ScheduleData) { const value = project(data); return { ...value, settings: sharedSettings(value.settings) }; }
export function fingerprint(data: ScheduleData): string { return stable(payload(data)); }
export function encodeSnapshot(data: ScheduleData): string {
  const text = stable({ format: 'polar-schedule-snapshot', formatVersion: 1, data: payload(data) });
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('同步文件超过 1 MB，已停止上传。请导出完整 JSON，后续迁移或分片，不会截断数据。');
  return text;
}
export function decodeSnapshot(text: string): ScheduleData {
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('远端文件超过 1 MB，已停止读取。');
  try {
    const parsed = wrapper.parse(JSON.parse(text));
    return project(dataSchema.parse({ ...parsed.data, settings: { ...initialData().settings, ...parsed.data.settings } }));
  } catch { throw new Error('远端快照格式、版本或关联校验失败，未修改本地数据。'); }
}
export function localSettings(candidate: ScheduleData, current: ScheduleData): ScheduleData {
  return dataSchema.parse({ ...candidate, settings: { ...current.settings, ...sharedSettings(candidate.settings),
    hiddenListIds: current.settings.hiddenListIds.filter((id) => candidate.lists.some((list) => list.id === id)) } });
}
export function countChanges(a: ScheduleData | null, b: ScheduleData): number {
  if (!a) return b.lists.length + b.tasks.length + b.scheduleBlocks.length + b.tags.length + b.exceptions.length + b.tombstones.length;
  let count = 0;
  for (const key of ['lists', 'tasks', 'scheduleBlocks', 'tags', 'exceptions', 'tombstones'] as const) {
    const id = (item: { id: string; entityType?: string }) => `${item.entityType ?? ''}:${item.id}`;
    const before = new Map(a[key].map((item) => [id(item), stable(item)]));
    const after = new Map(b[key].map((item) => [id(item), stable(item)]));
    count += [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).length;
  }
  return count + (stable(sharedSettings(a.settings)) !== stable(sharedSettings(b.settings)) ? 1 : 0);
}
