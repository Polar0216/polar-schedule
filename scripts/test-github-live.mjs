// Deliberately separate from browser tests. Never import this module into src/.
// The user authorized this one repository and this one external temporary file.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { sourceDigest } from './source-digest.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd(), targetName = 'Polar0216/polar-schedule-data-test';
const gatePath = path.join(root, '.qa/phase3-mock-gate.json');
const output = path.join(root, 'docs/evidence/phase3/github-live-result.json');
const initializer = '.polar-schedule-test-init.json';
const runId = `run-${new Date().toISOString().replace(/[^0-9]/g, '')}`;
const testPath = `data/phase3-e2e/${runId}.json`;
const results = { repository: targetName, runId, path: testPath, startedAt: new Date().toISOString(), status: 'not-run', steps: [], retainedTestFile: true };
let token = '';
function check(condition, message) { if (!condition) throw new Error(message); }
async function request(suffix, init = {}, expected = [200]) {
  check(['', '/contents', '/contents/data', '/contents/data/phase3-e2e', `/contents/${initializer}`, `/contents/${testPath}`, `/contents/${testPath}?ref=main`].includes(suffix), 'Blocked out-of-scope request');
  const response = await fetch(`https://api.github.com/repos/${targetName}${suffix}`, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(25000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  const step = { method: init.method ?? 'GET', path: `/repos/${targetName}${suffix}`, status: response.status };
  results.steps.push(step); // Headers, response/error bodies and the token are never recorded.
  check(expected.includes(response.status), `HTTP ${response.status}; stopped safely`);
  return response;
}
async function putFile(filePath, content, sha) {
  check(filePath === initializer || filePath === testPath, 'Blocked write path');
  return request(`/contents/${filePath}`, { method: 'PUT', body: JSON.stringify({ message: 'Phase 3 isolated integration fixture', branch: 'main', content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) }) }, sha ? [200] : [201]);
}
try {
  const gate = JSON.parse(await readFile(gatePath, 'utf8'));
  check(gate.passed === true && gate.sourceDigest === await sourceDigest(), 'Run the complete current Mock suite before live integration');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(path.join(root, '.qa'), { recursive: true });
  const bundle = path.join(root, '.qa/phase3-live-client.mjs');
  await build({ stdin: { contents: "export { GitHubClient } from './src/sync/githubClient.ts'; export { encodeSnapshot, decodeSnapshot, fingerprint } from './src/sync/snapshotCodec.ts'; export { fixture } from './src/sync/testSupport.ts'; export { TEST_TARGET } from './src/sync/types.ts';", resolveDir: root }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { GitHubClient, encodeSnapshot, decodeSnapshot, fingerprint, fixture, TEST_TARGET } = await import(pathToFileURL(bundle).href);
  // Read only here, after the Mock gate. No shell/env/argv/browser receives it.
  token = (await readFile('C:/Users/34201/.polar-schedule-secrets/test-pat.txt', 'utf8')).replace(/^\uFEFF/, '').trim();
  check(token.length > 10 && !/[\r\n]/.test(token), 'Temporary PAT file missing or invalid');
  const repo = await (await request('')).json();
  check(repo.full_name === targetName && repo.private === true && repo.default_branch === 'main', 'Repository identity/private/main check failed');
  const contents = await request('/contents', {}, [200, 404]);
  if (contents.status === 404) {
    check(repo.size === 0, 'Not a verified empty repository; stopped');
    await putFile(initializer, JSON.stringify({ format: 'polar-schedule-test-initialization', version: 1, note: 'Invented integration fixtures only. No personal data.' }, null, 2));
    results.initializedEmptyRepository = true;
  } else {
    const entries = await contents.json();
    check(Array.isArray(entries) && entries.every((entry) => entry.name === initializer || entry.name === 'data'), 'Unrecognized existing repository contents; stopped');
    // A repeat run may only recognize the initializer we created, then test directory.
    const init = await (await request(`/contents/${initializer}`)).json();
    check(JSON.parse(Buffer.from(init.content, 'base64').toString('utf8')).format === 'polar-schedule-test-initialization', 'Unrecognized initializer; stopped');
    if (entries.some((entry) => entry.name === 'data')) {
      const dataEntries = await (await request('/contents/data')).json();
      check(Array.isArray(dataEntries) && dataEntries.every((entry) => entry.name === 'phase3-e2e' && entry.type === 'dir'), 'Unrecognized data directory; stopped');
      const runs = await (await request('/contents/data/phase3-e2e')).json();
      check(Array.isArray(runs) && runs.every((entry) => /^run-\d+\.json$/.test(entry.name) && entry.type === 'file'), 'Unrecognized fixture directory; stopped');
    }
    results.initializedEmptyRepository = false;
  }
  const target = { ...TEST_TARGET, path: testPath };
  const transport = async (url, init) => {
    const parsed = new URL(String(url));
    check(parsed.origin === 'https://api.github.com' && [`/repos/${targetName}`, `/repos/${targetName}/branches/main`, `/repos/${targetName}/contents/${testPath}`].includes(parsed.pathname), 'Blocked origin or repository');
    const response = await fetch(url, init);
    results.steps.push({ method: init?.method ?? 'GET', path: new URL(String(url)).pathname + new URL(String(url)).search, status: response.status });
    return response;
  };
  const client = new GitHubClient(target, token, transport); await client.validateRepository();
  check(await client.read() === null, 'Unique fixture path unexpectedly already exists');
  const original = fixture(2); original.tasks[0].title = '虚构真实API测试 🧊'; original.tasks[0].subtasks = [{ id: '90000000-0000-4000-8000-000000000091', title: '虚构子任务', done: true, order: 0 }];
  const meta = { revision: 3, createdAt: original.updatedAt, updatedAt: original.updatedAt };
  const range = { allDay: false, timeZone: 'Asia/Shanghai', startAt: original.updatedAt, endAt: '2026-10-23T03:00:00.000Z' };
  original.tags = [{ ...meta, id: '90000000-0000-4000-8000-000000000092', title: '虚构标签', color: '#123456' }];
  original.tasks[0].tagIds = [original.tags[0].id];
  original.scheduleBlocks = [
    { ...meta, ...range, id: '90000000-0000-4000-8000-000000000093', type: 'task', taskId: original.tasks[0].id, executionStatus: 'completed', completedAt: original.updatedAt },
    { ...meta, ...range, id: '90000000-0000-4000-8000-000000000094', type: 'task', taskId: original.tasks[0].id, executionStatus: 'pending' },
    { ...meta, ...range, id: '90000000-0000-4000-8000-000000000095', type: 'event', title: '虚构重复课程', description: '', display: 'background',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [5], startDate: '2026-10-23', localTime: '09:00', durationMinutes: 120 } },
  ];
  original.exceptions = [{ ...meta, id: '90000000-0000-4000-8000-000000000096', seriesId: '90000000-0000-4000-8000-000000000095', occurrenceDate: '2026-10-30', cancelled: true }];
  original.tombstones = [{ entityType: 'task', id: '90000000-0000-4000-8000-000000000097', deletedAt: original.updatedAt }];
  const firstSha = await client.write(original); const firstRead = await client.read();
  check(firstRead?.sha === firstSha && fingerprint(firstRead.data) === fingerprint(original), 'Create/read integrity check failed');
  const edited = structuredClone(original); edited.tasks[0].title = '虚构更新后'; edited.tasks[0].revision++; edited.tasks[0].updatedAt = new Date().toISOString();
  const secondSha = await client.write(edited, firstSha); check(secondSha !== firstSha, 'Update SHA did not change');
  try { await client.write(original, firstSha); throw new Error('Stale SHA unexpectedly accepted'); }
  catch (error) { check(error?.status === 409 || error?.status === 422, 'Expected stale SHA rejection'); results.staleShaStatus = error.status; }
  const final = await client.read(); check(final?.sha === secondSha && fingerprint(final.data) === fingerprint(edited), 'Conflict changed stored data');
  const malformed = await request(`/contents/${testPath}`, { method: 'PUT', body: JSON.stringify({ message: 'Phase 3 intentionally invalid update', branch: 'main', sha: secondSha }) }, [422]);
  check(malformed.status === 422, 'Malformed request not rejected');
  const wrong = new GitHubClient(target, 'invalid-phase3-placeholder', transport);
  try { await wrong.validateRepository(); throw new Error('Invalid credential unexpectedly accepted'); }
  catch (error) { check(error?.status === 401, 'Expected real invalid-credential 401'); results.invalidCredentialStatus = error.status; } finally { wrong.clear(); }
  const last = await client.read(); check(last?.sha === secondSha && fingerprint(last.data) === fingerprint(edited), 'Final data changed by negative tests');
  check(fingerprint(decodeSnapshot(encodeSnapshot(last.data))) === fingerprint(edited), 'Codec integrity failed');
  // Check the exact secret without ever printing it. Failures report only a flag.
  const scanPaths = [];
  async function scan(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) await scan(file); else scanPaths.push(file); } }
  await scan(path.join(root, 'src')); await scan(path.join(root, 'dist')); await scan(path.join(root, 'docs'));
  for (const file of scanPaths) check(!(await readFile(file)).includes(Buffer.from(token)), 'Credential scan failed; secret detected');
  client.clear(); token = '';
  results.status = 'passed'; results.dataIntegrity = 'UTF8, IDs, revisions, subtasks, tags, independent execution status, recurring series, exception, tombstone and exact canonical content preserved'; results.credentialScan = 'passed';
} catch (error) {
  // Never serialize arbitrary Error, response body, headers, stack or request object.
  results.status = 'failed';
  results.failure = error?.code === 'ENOENT' ? 'Required Mock gate or external credential file was not found.'
    : 'A guarded API, integrity or security check failed. Inspect sanitized step statuses; no automatic broad retry was attempted.';
  process.exitCode = 1;
} finally {
  token = ''; results.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(results, null, 2));
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}
