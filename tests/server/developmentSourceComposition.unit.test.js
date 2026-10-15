import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { composePublicDevelopment } from "../../tooling/development/compose.mjs";
import { selectLocalDevelopmentPackages } from "../../tooling/development/source-packages.mjs";
import { sourceDevelopmentSelected } from "../../tooling/development/run.mjs";

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
  await manifest(publicRoot, { name: "vibe64", dependencies: { "@jskit-ai/kernel": "1.0.0", "@local/example": "file:packages/example" },
    devDependencies: { "@jskit-ai/jskit-catalog": "1.0.0" } });
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
    await manifest(sourceRoot, { name: "jskit-monorepo", workspaces: ["packages/*", "tooling/*"] });
    await exec("git", ["init", "--quiet", sourceRoot]);
    const kernel = path.join(sourceRoot, "packages/kernel");
    await manifest(kernel, { name: "@jskit-ai/kernel", version: "2.0.0", exports: "./index.js",
      dependencies: { "@jskit-ai/helper": "2.0.0", "shared-state": "^1.0.0" } });
    await file(kernel, "index.js", `import { state } from 'shared-state'; import { state as other } from '@jskit-ai/helper'; export const same = state === other; export const value = ${JSON.stringify(value)};\n`);
    const helper = path.join(sourceRoot, "packages/helper");
    await manifest(helper, { name: "@jskit-ai/helper", version: "2.0.0", exports: "./index.js", dependencies: { "shared-state": "^1.0.0" } });
    await file(helper, "index.js", "export { state } from 'shared-state';\n");
    const catalog = path.join(sourceRoot, "tooling/jskit-catalog");
    await file(sourceRoot, "tooling/test-utils/package.json", JSON.stringify({ type: "module" }));
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
    // Hosted source composition must work without invoking Git in another session.
    const composer = new URL("../../tooling/development/compose.mjs", import.meta.url).href;
    await exec(process.execPath, ["--input-type=module", "-e", `
import { composePublicDevelopment } from ${JSON.stringify(composer)};
await composePublicDevelopment(${JSON.stringify({ publicRoot: f.publicRoot, appRoot, env })});
`], { env: { ...process.env, PATH: "" } });
    const result = await exec(process.execPath, ["server.js"], { cwd: appRoot });
    assert.equal(JSON.parse(result.stdout).value, value);
    await rm(pin);
    if (number === 1) await symlink(path.dirname(second), pin);
  }
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot: path.join(f.root, "missing"), env }), /Pin a valid jskit-monorepo session/u);
  await symlink(path.dirname(first), pin);
  await manifest(first, { name: "wrong-project" });
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot: path.join(f.root, "wrong"), env }), /Expected repository jskit-monorepo/u);
  await manifest(first, { name: "jskit-monorepo" });
  await rm(path.join(first, ".git"), { recursive: true });
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot: path.join(f.root, "no-git"), env }), /Pin a valid jskit-monorepo session/u);
});

test("connected map composition discovers new libraries from declared workspaces and file packages without changing release inputs", async t => {
  const f = await fixture(t);
  const jskitRoot = await f.source("connected", "connected kernel");
  const libraryRoot = path.join(f.root, "new-library-repository");
  const cRoot = path.join(f.root, "connected-c-program");
  const cSource = "int main(void) { return 0; }\n";
  const cManifest = JSON.stringify({ name: "new-library", workspaces: ["../must-not-be-discovered"] });
  await file(cRoot, "main.c", cSource);
  await file(cRoot, "package.json", cManifest);
  await manifest(libraryRoot, { name: "custom-monorepo", private: true,
    workspaces: { packages: ["modules/*"] }, devDependencies: { "new-library": "file:library" } });
  await manifest(path.join(libraryRoot, "library"), { name: "new-library", exports: "./index.js",
    dependencies: { "@custom/helper": "1.0.0", "shared-state": "^1.0.0" } });
  await file(libraryRoot, "library/index.js", "import { state } from 'shared-state'; import { state as other } from '@custom/helper'; export const same = state === other; export const value = 'first library';\n");
  await manifest(path.join(libraryRoot, "modules/helper"), { name: "@custom/helper", exports: "./index.js",
    dependencies: { "shared-state": "^1.0.0" } });
  await file(libraryRoot, "modules/helper/index.js", "export { state } from 'shared-state';\n");
  const appManifest = JSON.parse(await readFile(path.join(f.publicRoot, "package.json")));
  appManifest.dependencies["new-library"] = "1.0.0";
  appManifest.dependencies["@local/vibe64-genesis"] = "file:packages/connected-consumer";
  await manifest(path.join(f.publicRoot, "packages/connected-consumer"), {
    name: "@local/vibe64-genesis", exports: { "./server": "./index.js" },
    dependencies: { "new-library": "1.0.0", "@jskit-ai/kernel": "1.0.0" }
  });
  // The CLI must execute the copied application consumer in a fresh process.
  // Genesis parsing itself remains covered by its existing contract tests.
  await file(f.publicRoot, "packages/connected-consumer/index.js", `import assert from 'node:assert/strict';
import { value } from 'new-library';
import { value as kernel } from '@jskit-ai/kernel';
export async function inspectVibe64ConnectedDevelopment() {
  assert.equal(value, 'changed library'); assert.equal(kernel, 'connected kernel');
  return { contract: 'vibe64.connected-development.v1', status: 'ready' };
}\n`);
  await symlink(path.join(f.publicRoot, "packages/connected-consumer"), path.join(f.publicRoot, "node_modules/@local/vibe64-genesis"));
  await manifest(f.publicRoot, appManifest);
  await file(f.publicRoot, "server.js", "import { value as kernel } from '@jskit-ai/kernel'; import { value, same } from 'new-library'; console.log(JSON.stringify({kernel,value,same}));\n");
  const releaseManifest = await readFile(path.join(f.publicRoot, "package.json"), "utf8");
  const sourcesFile = ".development/connected.json";
  await file(f.publicRoot, sourcesFile, JSON.stringify({ contract: "vibe64.connected-sources.v1", sessionId: "task",
    projects: [jskitRoot, libraryRoot, cRoot].map(sourceRoot => ({ relationship: "dependency", sourceRoot,
      type: sourceRoot === cRoot ? "custom" : "npm" })) }));
  const env = { VIBE64_CONNECTED_SOURCES_FILE: sourcesFile,
    VIBE64_JSKIT_SOURCE_ROOT: "/stale/other-task", VIBE64_GENESIS_SOURCE_ROOT: "/stale/other-task" };
  assert.equal(sourceDevelopmentSelected(env), true);
  assert.equal(sourceDevelopmentSelected({ ...env, VIBE64_DEVELOPMENT_COMPOSED: "1" }), false);
  const appRoot = path.join(f.root, "connected-app");
  const composed = await composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env });
  assert.deepEqual(composed.sourceRoots, [f.publicRoot, jskitRoot, libraryRoot, cRoot]);
  assert.equal(composed.connectedSourcesFile, path.join(f.publicRoot, sourcesFile));
  assert.ok(composed.localPackages.some(entry => entry.packageId === "new-library"));
  const consume = async () => JSON.parse((await exec(process.execPath, ["server.js"], { cwd: appRoot })).stdout);
  assert.deepEqual(await consume(), { kernel: "connected kernel", value: "first library", same: true });
  await file(libraryRoot, "library/index.js", (await readFile(path.join(libraryRoot, "library/index.js"), "utf8")).replace("first library", "changed library"));
  await composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env });
  assert.deepEqual(await consume(), { kernel: "connected kernel", value: "changed library", same: true });
  const verified = await exec(process.execPath, [fileURLToPath(new URL("../../tooling/development/compose.mjs", import.meta.url)), "verify", sourcesFile], {
    cwd: f.publicRoot, env: { ...process.env, ...env }
  });
  assert.match(verified.stdout, /Public Vibe64 imported and inspected Connected development/u);
  assert.deepEqual(await readdir(path.join(f.publicRoot, ".vibe64-local/connected-development")), []);
  assert.equal(await readFile(path.join(f.publicRoot, "package.json"), "utf8"), releaseManifest);
  assert.equal(await readFile(path.join(f.publicRoot, "package-lock.json"), "utf8"), "untouched release lock\n");
  assert.equal(await readFile(path.join(f.publicRoot, "node_modules/@jskit-ai/kernel/index.js"), "utf8"), "published installation\n");
  assert.equal(await readFile(path.join(cRoot, "main.c"), "utf8"), cSource);
  assert.equal(await readFile(path.join(cRoot, "package.json"), "utf8"), cManifest);
  assert.deepEqual(await readdir(cRoot), ["main.c", "package.json"], "Node treatment leaves custom source for its declared Stack commands, even with npm-looking metadata.");
  const invalidMap = JSON.parse(await readFile(path.join(f.publicRoot, sourcesFile), "utf8"));
  delete invalidMap.projects[0].type;
  await file(f.publicRoot, sourcesFile, JSON.stringify(invalidMap));
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env }), /effective npm\/custom type/u);
  invalidMap.projects[0].type = "npm";
  invalidMap.projects[0].relationship = "composition";
  await file(f.publicRoot, sourcesFile, JSON.stringify(invalidMap));
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env }), /not npm composition projects/u);
  await rm(path.join(f.publicRoot, sourcesFile));
  await assert.rejects(composePublicDevelopment({ publicRoot: f.publicRoot, appRoot, env }), { code: "ENOENT" });
});

test("generic package discovery accepts standalone roots and rejects duplicate or escaping declarations", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-package-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = path.join(root, "library");
  const otherLanguage = path.join(root, "c-program");
  await file(otherLanguage, "main.c", "int main(void) { return 0; }\n");
  await manifest(library, { name: "new-library", exports: "./index.js" });
  const select = options => selectLocalDevelopmentPackages({ sourceRoots: [library],
    consumerDependencies: { "new-library": "1.0.0" }, ...options });
  assert.deepEqual((await select()).map(entry => entry.packageId), ["new-library"]);
  await assert.rejects(select({ consumerDependencies: {} }), /contributes no declared application dependency/u);
  const unrelated = path.join(root, "unrelated");
  await manifest(unrelated, { name: "unrelated-library" });
  await assert.rejects(select({ sourceRoots: [library, unrelated] }), /contributes no declared application dependency/u,
    "Every selected npm repository must contribute to the consumer graph.");
  await assert.rejects(select({ sourceRoots: [otherLanguage, library] }), { code: "ENOENT" }, "An npm source must have package.json; custom sources are filtered by the consumer.");
  await assert.rejects(select({ sourceRoots: [library, library] }), /Duplicate development source root/u);
  const duplicate = path.join(root, "duplicate");
  await manifest(duplicate, { name: "new-library" });
  await assert.rejects(select({ sourceRoots: [library, duplicate] }), /Duplicate or unnamed local package/u);
  await manifest(library, { name: "new-library", workspaces: ["../duplicate"] });
  await assert.rejects(select(), /escaping workspace pattern/u);
  await manifest(library, { name: "new-library", devDependencies: { duplicate: "file:../duplicate" } });
  await assert.rejects(select(), /Declared source package escapes/u);
  await symlink(duplicate, path.join(library, "linked"));
  await manifest(library, { name: "new-library", workspaces: ["linked"] });
  await assert.rejects(select(), /Declared source package escapes/u);
});

test("custom-only connections retain the normal npm graph and remain watched", async t => {
  const f = await fixture(t);
  const installedTools = await f.source("installed-tools", "unused source");
  await symlink(path.join(installedTools, "tooling/jskit-catalog"), path.join(f.publicRoot, "node_modules/@jskit-ai/jskit-catalog"));
  const customRoot = path.join(f.root, "custom");
  await file(customRoot, "main.c", "int main(void) { return 0; }\n");
  await file(f.publicRoot, ".development/connected.json", JSON.stringify({
    contract: "vibe64.connected-sources.v1", sessionId: "custom-only",
    projects: [{ relationship: "dependency", type: "custom", sourceRoot: customRoot }]
  }));
  const composed = await composePublicDevelopment({ publicRoot: f.publicRoot,
    appRoot: path.join(f.root, "custom-app"), connectedSourcesFile: ".development/connected.json" });
  assert.deepEqual(composed.localPackages, []);
  assert.deepEqual(composed.sourceRoots, [f.publicRoot, customRoot]);
  assert.deepEqual(await readdir(customRoot), ["main.c"]);
  assert.equal(await readFile(path.join(f.publicRoot, "package-lock.json"), "utf8"), "untouched release lock\n");
});

for (const selection of ["legacy source", "connected library"]) test(`${selection} watching ignores dependency writes and drains the old app before restarting`, { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const source = await f.source("one", "first");
  let changedSource = path.join(source, "packages/kernel/index.js");
  let importedPackage = "@jskit-ai/kernel";
  const selectionEnv = { VIBE64_JSKIT_SOURCE_ROOT: source, VIBE64_GENESIS_SOURCE_ROOT: "", VIBE64_CONNECTED_SOURCES_FILE: "" };
  if (selection === "connected library") {
    const library = path.join(f.root, "watched-new-library");
    await manifest(library, { name: "new-library", exports: "./index.js" });
    await file(library, "index.js", 'export const value = "first";\n');
    const consumer = JSON.parse(await readFile(path.join(f.publicRoot, "package.json")));
    consumer.dependencies["new-library"] = "1.0.0";
    await manifest(f.publicRoot, consumer);
    selectionEnv.VIBE64_CONNECTED_SOURCES_FILE = ".development/connected.json";
    await file(f.publicRoot, selectionEnv.VIBE64_CONNECTED_SOURCES_FILE, JSON.stringify({
      contract: "vibe64.connected-sources.v1", sessionId: "watching",
      projects: [source, library].map(sourceRoot => ({ relationship: "dependency", type: "npm", sourceRoot }))
    }));
    changedSource = path.join(library, "index.js");
    importedPackage = "new-library";
  }
  await mkdir(path.join(source, ".claude/skills"), { recursive: true });
  await symlink("../../packages/kernel", path.join(source, ".claude/skills/existing"));
  const events = path.join(f.root, "events");
  await writeFile(events, "");
  await file(f.publicRoot, "server.js", `
import { appendFileSync } from 'node:fs';
import { value } from ${JSON.stringify(importedPackage)};
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
  env: { ...process.env, ...${JSON.stringify(selectionEnv)} }
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
  await writeFile(changedSource, (await readFile(changedSource, "utf8")).replace('"first"', '"second"'));
  await running;
  assert.equal(await readFile(events, "utf8"), "start:first\nstopped:first\nstart:second\n");
});
