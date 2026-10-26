import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { sourceDigest } from './source-digest.mjs';

await mkdir('.qa', { recursive: true });
const phase = process.argv[2] === 'phase4' ? 'phase4' : 'phase3';
await unlink(`.qa/${phase}-mock-gate.json`).catch((error) => { if (error.code !== 'ENOENT') throw error; });
const digest = await sourceDigest();
const commands = [['run', 'typecheck'], ['run', 'test'], ['run', 'build'], ['run', 'test:e2e'], ['audit', '--omit=dev'], ['audit']];
if (phase === 'phase4') commands.splice(3, 0, ['run', 'build:pages'], ['run', 'check:public']);
if (phase === 'phase4') commands.push(['run', 'test:e2e:pages']);
const result = { startedAt: new Date().toISOString(), passed: false, sourceDigest: digest, commands: [] };
for (const args of commands) {
  const exitCode = await new Promise((resolve, reject) => {
    const processTask = spawn(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit', windowsHide: true });
    processTask.on('error', reject); processTask.on('close', resolve);
  });
  result.commands.push({ command: `npm ${args.join(' ')}`, exitCode });
  if (exitCode !== 0) { process.exitCode = 1; break; }
}
result.passed = result.commands.length === commands.length && result.commands.every((item) => item.exitCode === 0) && digest === await sourceDigest();
result.finishedAt = new Date().toISOString();
await mkdir(`docs/evidence/${phase}`, { recursive: true });
await writeFile(`docs/evidence/${phase}/mock-results.json`, JSON.stringify(result, null, 2));
if (result.passed) await writeFile(`.qa/${phase}-mock-gate.json`, JSON.stringify(result, null, 2));
else process.exitCode = 1;
