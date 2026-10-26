import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function sourceDigest(root = process.cwd()) {
  const files = [];
  async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name); if (entry.isDirectory()) await walk(file); else files.push(file);
  } }
  for (const folder of ['src', 'e2e', 'scripts', 'public', '.github']) await walk(path.join(root, folder));
  files.push(...['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'playwright.config.ts', 'playwright.pages.config.ts'].map((file) => path.join(root, file)));
  const hash = createHash('sha256'); for (const file of files.sort()) hash.update(await readFile(file)); return hash.digest('hex');
}
