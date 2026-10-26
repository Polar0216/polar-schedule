import { initialData, INBOX_ID, type ScheduleData } from '../domain/schema';
import { encodeSnapshot } from './snapshotCodec';
import { toBase64 } from './githubClient';
import { TEST_TARGET, type SyncTarget } from './types';

// Invented fixtures only. Shared by Mock tests; never reads a real credential.
export function fixture(taskCount = 2): ScheduleData {
  const data = initialData(); const time = '2026-10-23T01:00:00.000Z';
  data.lists[0] = { ...data.lists[0], createdAt: time, updatedAt: time }; data.updatedAt = time;
  data.tasks = Array.from({ length: taskCount }, (_, i) => ({ id: `90000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, revision: 1, createdAt: time, updatedAt: time,
    title: `虚构同步任务 ${i + 1}`, description: '', status: 'todo', priority: 'none', listId: INBOX_ID, order: i, subtasks: [], tagIds: [] }));
  return data;
}
export class FakeGitHub {
  data: ScheduleData | null = null;
  serial = 0;
  puts = 0;
  calls: Array<{ url: string; method: string }> = [];
  failNext = 0;
  losePutResponse = false;
  beforePut?: () => Promise<void>;
  privateRepo = true;
  get sha() { return this.serial.toString(16).padStart(40, '0'); }
  constructor(data: ScheduleData | null = null, readonly target: SyncTarget = TEST_TARGET) { this.data = data ? structuredClone(data) : null; if (data) this.serial++; }
  fetch: typeof fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; this.calls.push({ url, method });
    const parsed = new URL(url), prefix = `/repos/${this.target.owner}/${this.target.repo}`;
    if (parsed.origin !== 'https://api.github.com' || !(parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`))) throw new Error('Unexpected target');
    if (this.failNext) { const status = this.failNext; this.failNext = 0; return new Response('{}', { status, headers: status === 429 ? { 'retry-after': '1' } : {} }); }
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.endsWith(this.target.repo)) return respond({ full_name: `${this.target.owner}/${this.target.repo}`, private: this.privateRepo, default_branch: 'main', size: this.data ? 1 : 0 });
    if (url.includes('/branches/')) return respond({ name: 'main' });
    if (method === 'GET') return this.data ? respond({ type: 'file', sha: this.sha, size: encodeSnapshot(this.data).length, encoding: 'base64', content: toBase64(encodeSnapshot(this.data)) }) : respond({}, 404);
    if (method === 'PUT') {
      await this.beforePut?.();
      const body = JSON.parse(String(init?.body)) as { sha?: string; content: string };
      if (body.sha !== (this.data ? this.sha : undefined)) return respond({}, 409);
      const { decodeSnapshot } = await import('./snapshotCodec');
      this.data = decodeSnapshot(new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))));
      this.serial++; this.puts++;
      if (this.losePutResponse) { this.losePutResponse = false; throw new Error('invented lost response'); }
      return respond({ content: { sha: this.sha } }, 201);
    }
    return respond({}, 422);
  };
}
