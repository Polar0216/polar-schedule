import { MAX_SNAPSHOT_BYTES, decodeSnapshot, encodeSnapshot } from './snapshotCodec';
import { targetFor, type RemoteFile, type SyncTarget } from './types';

export class GitHubError extends Error {
  constructor(readonly status: number, readonly retryAt?: number) {
    super(({ 0: '网络中断或请求超时；本地已保存，请恢复网络后重试。', 401: '授权失效，请重新输入当前仓库的 PAT。',
      403: '权限不足或 GitHub 限流；请检查单仓库 Contents 权限并稍后重试。', 404: '仓库或分支不可访问，请检查目标和授权。',
      409: '远端已改变，将重新读取并合并。', 422: '提交校验或 SHA 冲突，请重新读取后重试。',
      429: 'GitHub 请求受限，请等待重试时间。' } as Record<number, string>)[status] ?? 'GitHub 暂时无法完成请求，请稍后重试。本地数据保留。');
    this.name = 'GitHubError';
  }
}
export function validateTarget(target: SyncTarget): void {
  const allowed = targetFor(target.environment);
  const validPath = target.path === 'data/polar-schedule.json' || (target.environment === 'test' && /^data\/phase3-e2e\/[a-zA-Z0-9-]+\.json$/.test(target.path));
  if (target.owner !== allowed.owner || target.repo !== allowed.repo || target.branch !== 'main' || !validPath) {
    throw new Error('仅允许指定测试/正式私有仓库、main 分支及受控数据路径。');
  }
}
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function fromBase64(value: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/\s/g, '')), (c) => c.charCodeAt(0))); }
  catch { throw new Error('远端编码无效，未修改本地数据。'); }
}
export class GitHubClient {
  #token: string;
  #validated = false;
  #empty = false;
  #requests = new Set<AbortController>();
  constructor(readonly target: SyncTarget, token: string, private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    validateTarget(target);
    if (!token.trim() || /[\r\n]/.test(token)) throw new Error('请输入当前所选仓库的有效 PAT。');
    this.#token = token.trim();
  }
  clear() { this.#token = ''; this.#validated = false; this.#requests.forEach((controller) => controller.abort()); this.#requests.clear(); }
  private async request(suffix: string, init: RequestInit = {}): Promise<Response> {
    if (!this.#token) throw new GitHubError(401);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    this.#requests.add(controller);
    try {
      const response = await this.transport(`https://api.github.com/repos/${this.target.owner}/${this.target.repo}${suffix}`, {
        ...init, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
          'Content-Type': 'application/json', Authorization: `Bearer ${this.#token}` },
      });
      if (!response.ok) {
        const retry = response.headers.get('retry-after'); const reset = response.headers.get('x-ratelimit-reset');
        const delay = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry))
          : response.headers.get('x-ratelimit-remaining') === '0' && reset ? Number(reset) * 1000 : undefined;
        throw new GitHubError(response.status, delay && Number.isFinite(delay) ? Math.max(Date.now() + 1000, delay) : undefined);
      }
      return response;
    } catch (error) { if (error instanceof GitHubError) throw error; throw new GitHubError(0); }
    finally { clearTimeout(timer); this.#requests.delete(controller); }
  }
  async validateRepository(): Promise<{ defaultBranch: string; empty: boolean }> {
    const value: unknown = await (await this.request('')).json();
    if (!value || typeof value !== 'object' || !('private' in value) || value.private !== true ||
      !('full_name' in value) || value.full_name !== `${this.target.owner}/${this.target.repo}` ||
      !('default_branch' in value) || value.default_branch !== this.target.branch) throw new Error('目标不是预期的私有仓库或 main 分支，已停止同步。');
    this.#validated = true;
    this.#empty = 'size' in value && value.size === 0;
    return { defaultBranch: value.default_branch as string, empty: this.#empty };
  }
  private get suffix() { return `/contents/${this.target.path.split('/').map(encodeURIComponent).join('/')}`; }
  async read(): Promise<RemoteFile | null> {
    if (!this.#validated) throw new Error('请先验证私有仓库。');
    let response: Response;
    try { response = await this.request(`${this.suffix}?ref=${encodeURIComponent(this.target.branch)}`); }
    catch (error) {
      if (error instanceof GitHubError && error.status === 404) {
        const repo = await this.validateRepository();
        if (!repo.empty) await this.request(`/branches/${encodeURIComponent(this.target.branch)}`);
        return null;
      }
      throw error;
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'file' || !('sha' in value) || typeof value.sha !== 'string' ||
      !/^[a-f0-9]{40,64}$/.test(value.sha) || !('size' in value) || typeof value.size !== 'number' || value.size > MAX_SNAPSHOT_BYTES ||
      !('encoding' in value) || value.encoding !== 'base64' || !('content' in value) || typeof value.content !== 'string' || value.content.length > MAX_SNAPSHOT_BYTES * 1.5) throw new Error('远端不是有效的小于 1 MB 的快照文件。');
    return { sha: value.sha, data: decodeSnapshot(fromBase64(value.content)) };
  }
  async write(data: RemoteFile['data'], sha?: string): Promise<string> {
    if (!this.#validated) throw new Error('请先验证私有仓库。');
    const response = await this.request(this.suffix, { method: 'PUT', body: JSON.stringify({ message: `Polar Schedule: synchronize ${this.target.environment} snapshot`,
      content: toBase64(encodeSnapshot(data)), branch: this.target.branch, ...(sha ? { sha } : {}) }) });
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('content' in value) || !value.content || typeof value.content !== 'object' ||
      !('sha' in value.content) || typeof value.content.sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.content.sha)) throw new GitHubError(0);
    return value.content.sha;
  }
}
