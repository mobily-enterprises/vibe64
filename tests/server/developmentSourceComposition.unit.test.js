import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { composePublicDevelopment } from "../../tooling/development/compose.mjs";

const exec = promisify(execFile);
async function file(root, name, content) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
const manifest = (root, value) => file(root, "package.json", JSON.stringify({ type: "module", version: "1.0.0", ...value }));

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-composition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  await manifest(publicRoot, { name: "vibe64", dependencies: { "@jskit-ai/kernel": "1.0.0", "@local/example": "file:packages/example" } });
  await file(publicRoot, "package-lock.json", "untouched release lock\n");
  await file(publicRoot, ".env", "PRIVATE_FIXTURE_VALUE=must-not-be-copied\n");
  await file(publicRoot, "docs/colleague-usage/development.md", "Development guide\n");
  await file(publicRoot, "server.js", "import { same, value } from '@jskit-ai/kernel'; import { value as local } from './packages/example/index.js'; console.log(JSON.stringify({same,value,local}));\n");
  await mkdir(path.join(publicRoot, "node_modules/.bin"), { recursive: true });
  await mkdir(path.join(publicRoot, "node_modules/@local"), { recursive: true });
  await manifest(path.join(publicRoot, "packages/example"), { name: "@local/example", exports: "./index.js",
    dependencies: { "@jskit-ai/kernel": "1.0.0" } });
  await file(publicRoot, "packages/example/index.js", "export { value } from '@jskit-ai/kernel';\n");
  await symlink(path.join(publicRoot, "packages/example"), path.join(publicRoot, "node_modules/@local/example"));
  await manifest(path.join(publicRoot, "node_modules/shared-state"), { name: "shared-state", exports: "./index.js" });
  await file(publicRoot, "node_modules/shared-state/index.js", "export const state = {};\n");
  await manifest(path.join(publicRoot, "node_modules/@jskit-ai/kernel"), { name: "@jskit-ai/kernel" });
  await file(publicRoot, "node_modules/@jskit-ai/kernel/index.js", "published installation\n");
  async function source(name, value) {
    const sourceRoot = path.join(root, "jskit/sessions/active", name, "source");
    await manifest(sourceRoot, { name: "jskit-monorepo" });
    await exec("git", ["init", "--quiet", sourceRoot]);
    const kernel = path.join(sourceRoot, "packages/kernel");
    await manifest(kernel, { name: "@jskit-ai/kernel", version: "2.0.0", exports: "./index.js",
      dependencies: { "@jskit-ai/helper": "2.0.0", "shared-state": "^1.0.0" } });
    await file(kernel, "index.js", `import { state } from 'shared-state'; import { state as other } from '@jskit-ai/helper'; export const same = state === other; export const value = ${JSON.stringify(value)};\n`);
    const helper = path.join(sourceRoot, "packages/helper");
    await manifest(helper, { name: "@jskit-ai/helper", version: "2.0.0", exports: "./index.js", dependencies: { "shared-state": "^1.0.0" } });
    await file(helper, "index.js", "export { state } from 'shared-state';\n");
    const catalog = path.join(sourceRoot, "tooling/jskit-catalog");
    await manifest(catalog, { name: "@jskit-ai/jskit-catalog" });
    await file(catalog, "catalog/packages.json", "{}");
    // Graph-policy behavior remains covered by its owner's tests; this fixture
    // exercises real package resolution, version validation and source isolation.
    await file(catalog, "scripts/project-packages.mjs", "export const checkProject = async () => ({issues:[]}); export const checkInstalledGraph = checkProject;\n");
    return sourceRoot;
  }
  return { root, publicRoot, source };
}

test("laptop source development uses current source and one external runtime without changing the install or lock", async (t) => {
  const f = await fixture(t);
  const source = await f.source("one", "first");
  const appRoot = path.join(f.root, "app");
  const composed = await composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env: { VIBE64_JSKIT_SOURCE_ROOT: source } });
  assert.equal(composed.localPackages.length, 3);
  const result = await exec(process.execPath, ["server.js"], { cwd: appRoot });
  assert.deepEqual(JSON.parse(result.stdout), { same: true, value: "first", local: "first" });
  assert.equal(await readFile(path.join(f.publicRoot, "package-lock.json"), "utf8"), "untouched release lock\n");
  assert.equal(await readFile(path.join(f.publicRoot, "node_modules/@jskit-ai/kernel/index.js"), "utf8"), "published installation\n");
  await assert.rejects(readFile(path.join(appRoot, ".env")), { code: "ENOENT" });
  await manifest(path.join(f.publicRoot, "node_modules/shared-state"), { name: "shared-state", version: "3.0.0", exports: "./index.js" });
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot: path.join(f.root, "bad-app"), env: { VIBE64_JSKIT_SOURCE_ROOT: source } }), /requires shared-state/u);
});

test("hosted source development follows the pin on each composition and fails closed when it disappears", async (t) => {
  const f = await fixture(t);
  const first = await f.source("one", "first");
  const second = await f.source("two", "second");
  const pin = path.join(f.root, "jskit/sessions/pinned");
  await symlink(path.dirname(first), pin);
  const env = { VIBE64_JSKIT_SOURCE_ROOT: path.join(pin, "source") };
  for (const [number, value] of [[1, "first"], [2, "second"]]) {
    const appRoot = path.join(f.root, `app-${number}`);
    await composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env });
    const result = await exec(process.execPath, ["server.js"], { cwd: appRoot });
    assert.equal(JSON.parse(result.stdout).value, value);
    await rm(pin);
    if (number === 1) await symlink(path.dirname(second), pin);
  }
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot: path.join(f.root, "missing"), env }), /Pin a valid jskit-monorepo session/u);
});

test("source watching ignores dependency writes and drains the old app before restarting with changed source", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const source = await f.source("one", "first");
  const events = path.join(f.root, "events");
  await writeFile(events, "");
  await file(f.publicRoot, "server.js", `
import { appendFileSync } from 'node:fs';
import { value } from '@jskit-ai/kernel';
const record = (event) => appendFileSync(${JSON.stringify(events)}, event + '\\n');
record('start:' + value);
process.on('SIGTERM', () => setTimeout(() => { record('stopped:' + value); process.exit(0); }, 200));
if (value === 'second') setTimeout(() => process.exit(0), 100);
else setInterval(() => {}, 1000);
`);
  const runner = new URL("../../tooling/development/run.mjs", import.meta.url).href;
  const running = exec(process.execPath, ["--input-type=module", "-e", `
import { runSourceDevelopment } from ${JSON.stringify(runner)};
process.exitCode = await runSourceDevelopment({
  publicRoot: ${JSON.stringify(f.publicRoot)}, command: process.execPath,
  args: ['server.js'], watch: true,
  env: { ...process.env, VIBE64_JSKIT_SOURCE_ROOT: ${JSON.stringify(source)}, VIBE64_GENESIS_SOURCE_ROOT: '' }
});
`], { timeout: 20_000 });
  running.catch(() => {});
  t.after(async () => { running.child.kill("SIGTERM"); await running.catch(() => {}); });
  const deadline = Date.now() + 10_000;
  while (!(await readFile(events, "utf8")).includes("start:first")) {
    assert.ok(Date.now() < deadline, "development app did not start");
    await delay(50);
  }
  await file(f.publicRoot, "node_modules/shared-state/index.js", "export const state = {}; // dependency write\n");
  await delay(800);
  assert.equal(await readFile(events, "utf8"), "start:first\n");
  const kernel = path.join(source, "packages/kernel/index.js");
  await writeFile(kernel, (await readFile(kernel, "utf8")).replace('"first"', '"second"'));
  await running;
  assert.equal(await readFile(events, "utf8"), "start:first\nstopped:first\nstart:second\n");
});
