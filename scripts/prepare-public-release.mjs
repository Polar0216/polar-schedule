// Build an audited initial public snapshot without rewriting private local Git
// history or publishing original user-feedback images and local exports.
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sourceDigest } from './source-digest.mjs';
const root = process.cwd();
const gate = JSON.parse(await readFile('.qa/phase4-mock-gate.json', 'utf8'));
assert(gate.passed && gate.sourceDigest === await sourceDigest(), 'Current Phase 4 quality gate must pass first');
const destination = path.resolve(process.argv[2] ?? `.qa/public-release-${Date.now()}`);
assert(destination.startsWith(path.join(root, '.qa') + path.sep), 'Release copy must stay in this workspace .qa directory');
await mkdir(destination); // Never overwrite or remove a pre-existing checkout.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const excluded = [], included = [];
for (const file of tracked) {
  if (/^docs\/phase2(?:\.1)?实测\//.test(file)) { excluded.push(file); continue; }
  assert(!/(?:^|\/)(?:\.env(?:\..*)?|credentials?|secrets?|test-pat\.txt|node_modules|\.qa|test-results|playwright-report|dist(?:-pages)?)(?:\/|$)/i.test(file), `Private/generated path in tracked source: ${file}`);
  const source = path.resolve(root, file), output = path.resolve(destination, file);
  assert(source.startsWith(root + path.sep) && output.startsWith(destination + path.sep));
  assert((await lstat(source)).isFile(), 'Only regular audited source files can be published');
  const bytes = await readFile(source);
  assert(!/(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})/.test(bytes.toString('utf8')), 'Credential detected; public copy stopped');
  await mkdir(path.dirname(output), { recursive: true }); await copyFile(source, output); included.push(file);
}
const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDigest: gate.sourceDigest,
  destination, includedFiles: included.length, excludedOriginalFeedbackFiles: excluded.length, excludedDirectories: ['docs/phase2实测', 'docs/phase2.1实测'], localHistoryPreserved: true };
await writeFile('.qa/phase4-publication-plan.json', JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2));
