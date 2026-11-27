import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { inspectConnectedAdapters } from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";
import { startFakeNpmRegistry, writePackage } from "./fakeNpmRegistry.js";

const exec = promisify(execFile);
const PROGRAM = fileURLToPath(new URL("../../packages/vibe64-project/bin/vibe64-connected", import.meta.url));
const repository = "https://github.com/example/lib";

/**
 * A session's folders as a machine that runs its checks holds them: its source (a Genesis project whose Stack
 * declares npm as the Default package type, listing one connected repository and installing the published
 * @proof/lib 1.0.0) and, beside it at ../connected/lib, its copy of that repository: @proof/lib 1.1.0, whose
 * lib/message.js holds a change not yet committed.
 */
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-connected-entry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = await startFakeNpmRegistry(root);
  t.after(() => registry.close());
  const published = path.join(root, "published", "lib");
  await writePackage(published, { name: "@proof/lib", version: "1.0.0", main: "index.js" }, { "index.js": "exports.message = 'published';\n" });
  await registry.publish(published);

  const source = path.join(root, "session", "source");
  await writePackage(source, { name: "app", version: "1.0.0", private: true, dependencies: { "@proof/lib": "1.0.0" } },
    { ".gitignore": "node_modules/\n", "vibe64.connections.json": `${JSON.stringify({ repositories: [{ name: "Lib", repository, relationship: "dependency" }] })}\n` });
  await exec("git", ["init", "-q", "--initial-branch=main"], { cwd: source });
  await initializeGenesisProject({ projectRoot: source });
  await appendFile(path.join(source, "genesis/stack.md"), "\n## Connected development\n\n- Default package type: `npm`\n");
  await exec("npm", ["install"], { cwd: source, env: registry.env });
  await exec("git", ["add", "--all"], { cwd: source });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "app"], { cwd: source });

  const copy = path.join(root, "session", "connected", "lib");
  await writePackage(copy, { name: "@proof/lib", version: "1.1.0", main: "index.js", files: ["index.js", "lib/"] }, {
    "index.js": "exports.message = require('./lib/message');\n",
    "lib/message.js": "module.exports = 'committed';\n",
    "notes.md": "Not published.\n"
  });
  await exec("git", ["init", "-q", "--initial-branch=main"], { cwd: copy });
  await exec("git", ["add", "--all"], { cwd: copy });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "lib"], { cwd: copy });
  await writeFile(path.join(copy, "lib/message.js"), "module.exports = 'not committed yet';\n");

  /** The step's argv as the recipe gives it, run in the session's source. */
  const run = (...args) => new Promise(resolve => {
    execFile(process.execPath, [PROGRAM, ...args], { cwd: source, env: registry.env, timeout: 120_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
  return { root, source, copy, registry, run };
}

async function filesBelow(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesBelow(dir, relative));
    else files.push(relative);
  }
  return files.sort();
}

test("vibe64-connected runs a typed connected step from the session's folders: npm installs what the copy would publish, uncommitted work included", { timeout: 180_000 }, async t => {
  const f = await fixture(t);
  const applied = await f.run("npm", "apply", repository);
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /@proof\/lib 1\.1\.0 in effect/u);

  // What `npm pack` of the copy would publish, file for file, the change not yet committed included.
  const [packed] = JSON.parse((await exec("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: f.copy, env: f.registry.env })).stdout);
  const publishes = packed.files.map(file => file.path).sort();
  const installed = path.join(f.source, "node_modules", "@proof", "lib");
  assert.deepEqual(await filesBelow(installed), publishes);
  for (const file of publishes) {
    assert.equal(await readFile(path.join(installed, file), "utf8"), await readFile(path.join(f.copy, file), "utf8"), file);
  }
  assert.equal((await exec(process.execPath, ["-e", "console.log(require('@proof/lib').message)"], { cwd: f.source })).stdout.trim(),
    "not committed yet");

  // In effect as Vibe64 itself judges it, and the program's own proof says so.
  const [status] = await inspectConnectedAdapters({
    repositories: [{ name: "Lib", repository, relationship: "dependency", type: "npm", sourceRoot: f.copy }],
    sessionSourceRoot: f.source
  });
  assert.equal(status.inEffect, true, status.reason);
  const proved = await f.run("npm", "proof", repository);
  assert.equal(proved.code, 0, proved.stderr);
  assert.match(proved.stdout, /Lib is in effect/u);
});

test("vibe64-connected fails with the adapter's own message, and refuses a step its session does not hold", { timeout: 180_000 }, async t => {
  const f = await fixture(t);
  const unproved = await f.run("npm", "proof", repository);
  assert.equal(unproved.code, 1);
  assert.match(unproved.stderr, /Connected Lib is not in effect/u);

  const stranger = await f.run("npm", "apply", "https://github.com/example/other");
  assert.equal(stranger.code, 1);
  assert.match(stranger.stderr, /example\/other is no longer a typed connected dependency of this session/u);

  const wrongType = await f.run("pip", "apply", repository);
  assert.equal(wrongType.code, 1);
  assert.match(wrongType.stderr, /Lib is a connected npm dependency, not pip/u);

  const usage = await f.run("npm", "install", repository);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /usage: vibe64-connected <type> keep\|apply\|proof <repository>/u);
  // Nothing was put in effect.
  assert.equal(JSON.parse(await readFile(path.join(f.source, "node_modules/@proof/lib/package.json"), "utf8")).version, "1.0.0");
});
