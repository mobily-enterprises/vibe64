import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const map = JSON.parse(readFileSync('.development/connected.json', 'utf8'));
for (const selected of map.projects) {
  const pkg = JSON.parse(readFileSync(path.join(selected.sourceRoot, 'package.json'), 'utf8'));
  assert.equal(realpathSync(fileURLToPath(import.meta.resolve(pkg.name))), realpathSync(path.join(selected.sourceRoot, 'index.js')));
  const { message } = await import(pkg.name);
  console.log(pkg.name + ': ' + message());
}
