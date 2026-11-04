import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['src', 'public/assets', 'scripts', 'test'];
const sourceFiles = sourceRoots.flatMap((root) => collectJavaScript(path.join(projectRoot, root)));
let failed = false;

for (const file of sourceFiles.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) process.exitCode = 1;
else console.log(`Syntax check passed for ${sourceFiles.length} JavaScript files.`);

function collectJavaScript(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScript(fullPath);
    return entry.isFile() && fullPath.endsWith('.js') ? [fullPath] : [];
  });
}
