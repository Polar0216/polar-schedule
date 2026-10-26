import { describe, expect, it } from 'vitest';
import { FakeGitHub, fixture } from './testSupport';
import { GitHubClient, GitHubError, fromBase64, toBase64 } from './githubClient';
import { TEST_TARGET } from './types';
import { fingerprint } from './snapshotCodec';

describe('仅官方源与指定私有测试仓库 Contents API', () => {
  it('验证/创建/带SHA更新/读取/UTF8内容完整；URL不含占位令牌', async () => {
    const fake = new FakeGitHub(), client = new GitHubClient(TEST_TARGET, 'mock-phase3-token', fake.fetch);
    await expect(client.read()).rejects.toThrow('验证'); await client.validateRepository(); expect(await client.read()).toBeNull();
    const data = fixture(); data.tasks[0].title = '中文🧊'; const sha = await client.write(data);
    expect(sha).toBe(fake.sha); expect(fingerprint((await client.read())!.data)).toBe(fingerprint(data));
    data.tasks[0].title = '已修改'; await client.write(data, sha); expect(fake.puts).toBe(2);
    await expect(client.write(data, sha)).rejects.toMatchObject({ status: 409 });
    expect(fake.calls.every((call) => !call.url.includes('mock-phase3-token'))).toBe(true);
    expect(fromBase64(toBase64('汉字🧊'))).toBe('汉字🧊');
  });
  it.each([{ owner: 'another' }, { repo: 'polar-schedule-data' }, { path: '../secret' }, { path: 'https://evil.invalid' }, { branch: 'other' }, { environment: 'production' }])('拒绝越界目标 %j', (patch) => {
    expect(() => new GitHubClient({ ...TEST_TARGET, ...patch } as typeof TEST_TARGET, 'mock')).toThrow('仅允许');
  });
  it('公开仓库拒绝，无后续写入', async () => {
    const fake = new FakeGitHub(); fake.privateRepo = false; const client = new GitHubClient(TEST_TARGET, 'mock', fake.fetch);
    await expect(client.validateRepository()).rejects.toThrow('私有'); await expect(client.write(fixture())).rejects.toThrow('验证'); expect(fake.puts).toBe(0);
  });
  it.each([401, 403, 404, 409, 422, 429, 500])('HTTP %s 固定安全错误，不反射响应正文', async (status) => {
    const client = new GitHubClient(TEST_TARGET, 'mock-do-not-display', async (_url, init) => {
      expect(init?.redirect).toBe('error'); expect(init?.cache).toBe('no-store'); expect(init?.credentials).toBe('omit');
      return new Response('mock-do-not-display', { status, headers: { 'retry-after': '2' } });
    });
    await expect(client.validateRepository()).rejects.toMatchObject({ status });
    try { await client.validateRepository(); } catch (error) { expect(String(error)).not.toContain('mock-do-not-display'); }
  });
  it('限流读取RetryAfter/Reset，不自动无限重试', async () => {
    const client = new GitHubClient(TEST_TARGET, 'mock', async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 30) } }));
    try { await client.validateRepository(); throw new Error('expected rejection'); } catch (error) { expect(error).toBeInstanceOf(GitHubError); expect((error as GitHubError).retryAt).toBeGreaterThan(Date.now()); }
  });
  it('文件404后重验仓库与分支，不把失权/分支消失误判为空文件', async () => {
    let count = 0; const client = new GitHubClient(TEST_TARGET, 'mock', async () => {
      count++; return count === 1 ? new Response(JSON.stringify({ full_name: 'Polar0216/polar-schedule-data-test', private: true, default_branch: 'main', size: 1 })) : new Response('{}', { status: 404 });
    });
    await client.validateRepository(); await expect(client.read()).rejects.toMatchObject({ status: 404 }); expect(count).toBe(3);
  });
  it('无效SHA、未知编码/大文件拒绝，网络异常清理为固定错误', async () => {
    const fake = new FakeGitHub(fixture()); const client = new GitHubClient(TEST_TARGET, 'mock', async (url, init) => String(url).includes('/contents/') ? new Response(JSON.stringify({ type: 'file', sha: 'bad', size: 2e6 })) : fake.fetch(url, init));
    await client.validateRepository(); await expect(client.read()).rejects.toThrow('有效');
    const network = new GitHubClient(TEST_TARGET, 'mock', async () => { throw new Error('mock-secret-body'); });
    await expect(network.validateRepository()).rejects.toMatchObject({ status: 0 }); network.clear(); await expect(network.validateRepository()).rejects.toMatchObject({ status: 401 });
  });
});
