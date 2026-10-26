import { dataSchema, type ScheduleData, type Tombstone } from '../domain/schema';
import { project, sharedSettingKeys, stable } from './snapshotCodec';
import type { Choices, Conflict } from './types';

const tables = { lists: 'list', tasks: 'task', scheduleBlocks: 'scheduleBlock', tags: 'tag', exceptions: 'exception' } as const;
type Item = { id: string; title?: string };
interface Version { value?: Item; tombstone?: Tombstone }
export function merge(base: ScheduleData, local: ScheduleData, remote: ScheduleData, choices: Choices = {}) {
  const result = structuredClone(project(local));
  const conflicts: Conflict[] = [];
  result.tombstones = [];
  const choose = (key: string, kind: string, title: string, b: unknown, l: unknown, r: unknown): unknown => {
    if (stable(l) === stable(r) || stable(b) === stable(r)) return l;
    if (stable(b) === stable(l)) return r;
    if (choices[key]) return choices[key] === 'local' ? l : r;
    conflicts.push({ key, kind, title, local: l, remote: r }); return l;
  };
  for (const [table, entityType] of Object.entries(tables) as Array<[keyof typeof tables, Tombstone['entityType']]>) {
    const versions = (data: ScheduleData) => {
      const map = new Map<string, Version>(data[table].map((item) => [item.id, { value: item }]));
      data.tombstones.filter((t) => t.entityType === entityType).forEach((tombstone) => map.set(tombstone.id, { tombstone }));
      return map;
    };
    const [b, l, r] = [base, local, remote].map(versions);
    const items: Item[] = [];
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const selected = choose(`${table}:${id}`, table, l.get(id)?.value?.title ?? r.get(id)?.value?.title ?? id, b.get(id), l.get(id), r.get(id)) as Version | undefined;
      if (selected?.value) items.push(selected.value);
      if (selected?.tombstone) result.tombstones.push(selected.tombstone);
    }
    result[table] = items as never;
  }
  // Treat the shared settings as one record, so coupled start/end hours stay valid.
  const settings = (data: ScheduleData) => Object.fromEntries(sharedSettingKeys.map((key) => [key, data.settings[key]]));
  Object.assign(result.settings, choose('settings', 'settings', '日历共享设置', settings(base), settings(local), settings(remote)));
  result.updatedAt = [local.updatedAt, remote.updatedAt].sort().at(-1)!;
  const valid = dataSchema.safeParse(result);
  if (!valid.success) conflicts.push({ key: 'references', kind: 'references', title: '关联完整性：请导出两端后选择完整版本', local, remote });
  if (choices.references && !conflicts.some((c) => c.key !== 'references')) return { data: project(choices.references === 'local' ? local : remote), conflicts: [] };
  return { data: valid.success ? project(valid.data) : undefined, conflicts };
}
