import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertExpectedId, canonicalPath, helperChildEnv, resolveAllowedCwd,
  resolveAllowedDeploymentServicePath, resolveAllowedUserHomePath, runUserCommand
} from "../../packages/vibe64-execution/src/host/execHelper.js";
import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";

test("expected execution identities fail closed for missing, malformed and mismatched ids", () => {
  for (const name of ["uid", "gid"]) {
    assert.doesNotThrow(() => assertExpectedId(name, 1001, 1001));
    for (const expected of [undefined, null, "1001", "invalid", NaN, Infinity, -1, 1.2, {}, [], true, 1002]) {
      assert.throws(() => assertExpectedId(name, expected, 1001), new RegExp(`${name} mismatch`, "u"));
    }
  }
});

test("runuser receives a trusted PATH while the user command retains the gateway PATH and credentials", (t) => {
  const user = { username: "member", home: "/home/member" };
  const env = helperChildEnv({
    PATH: "/workspace/bin:/usr/bin", PROVIDER_API_KEY: "private-token", HOME: "/wrong",
    GCONV_PATH: "/workspace/lib", GLIBC_TUNABLES: "unsafe", LOCPATH: "/workspace/lib",
    LD_PRELOAD: "/workspace/inject.so", NODE_OPTIONS: "--require=/workspace/inject.js",
    BASH_ENV: "/workspace/inject.sh", DYLD_INSERT_LIBRARIES: "/workspace/inject.dylib"
  }, user, "v64d_workspace");
  const call = t.mock.method(childProcess, "spawnSync", (command, args, options) => ({ command, args, options }));
  syncBuiltinESMExports();
  t.after(() => { call.mock.restore(); syncBuiltinESMExports(); });
  const result = runUserCommand(user, "git", ["status"], { env, cwd: "/workspace", input: "input" });
  assert.equal(result.command, "/usr/sbin/runuser");
  assert.deepEqual(result.args, ["-u", "member", "--", "/usr/bin/env", "--",
    "PATH=/workspace/bin:/usr/bin", "git", "status"]);
  assert.ok(!result.options.env.PATH.includes("/workspace/bin"));
  assert.ok(result.options.env.PATH.includes("/opt/vibe64/runtime-packs/git/bin"));
  assert.equal(result.options.env.PROVIDER_API_KEY, "private-token");
  assert.ok(!result.args.join(" ").includes("private-token"));
  assert.equal(result.options.env.HOME, "/home/member");
  assert.equal(result.options.env.TMPDIR, "/var/lib/vibe64/workspace/tmp");
  assert.equal(result.options.input, "input");
  for (const name of ["GCONV_PATH", "GLIBC_TUNABLES", "LOCPATH", "LD_PRELOAD", "NODE_OPTIONS", "BASH_ENV", "DYLD_INSERT_LIBRARIES"]) {
    assert.equal(result.options.env[name], undefined, name);
  }
  assert.equal(env.PATH, "/workspace/bin:/usr/bin", "managed commands keep the gateway's runtime selection");
});

test("OpenCode retains its private provider home and XDG directories", () => {
  const root = "/run/vibe64-workspace/vibe64/agent-providers/opencode";
  const input = { PATH: "/managed/toolchain/bin" };
  for (const name of ["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    input[name] = `${root}/${name.toLowerCase()}`;
  }
  const user = { username: "v64d_workspace", home: "/home/v64d_workspace" };
  const env = helperChildEnv(input, user, user.username, "opencode-app-server");
  for (const [name, value] of Object.entries(input)) assert.equal(env[name], value);
  assert.throws(() => helperChildEnv({ ...input, HOME: "/outside" }, user, user.username, "opencode-app-server"), /outside its provider runtime/u);
});

test("gateway cwd permits in-root symlinks and a selected symlink root but rejects escaping links", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-cwd-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const outside = path.join(root, "outside");
  await mkdir(path.join(project, "nested"), { recursive: true });
  await mkdir(outside);
  await symlink(outside, path.join(project, "escape"));
  await symlink(path.join(project, "nested"), path.join(project, "inside"));
  await symlink(project, path.join(root, "selected-root"));
  for (const [cwd, allowed] of [[project, project], [path.join(project, "inside"), project],
    [path.join(root, "selected-root", "nested"), path.join(root, "selected-root")]]) {
    const result = await runVibe64Command({ command: process.execPath,
      args: ["-e", "process.stdout.write(process.cwd())"], cwd, allowedRoots: [allowed] });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.stdout, canonicalPath(cwd));
  }
  const refused = await runVibe64Command({ command: process.execPath,
    args: ["-e", "throw new Error('must not execute')"], cwd: path.join(project, "escape"), allowedRoots: [project] });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "vibe64_command_cwd_outside_allowed_roots");
});

test("host path checks reject home, state and release symlinks outside their allowed roots", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-host-path-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const outside = path.join(root, "outside");
  const state = path.join(home, ".local/state/vibe64/projects");
  const release = path.join(state, "project/deployments/releases/version/service");
  await mkdir(release, { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(release, "start"), "safe");
  await writeFile(path.join(outside, "start"), "unsafe");
  await symlink(outside, path.join(home, "escape"));
  await symlink(outside, path.join(state, "escape"));
  await symlink(path.join(outside, "start"), path.join(release, "escaped-start"));
  const owner = { home, username: "v64d_workspace" };
  assert.equal(resolveAllowedUserHomePath(release, owner), release);
  assert.throws(() => resolveAllowedUserHomePath(path.join(home, "escape"), owner), /outside the target user home/u);
  assert.equal(resolveAllowedCwd(release, owner.username, { operation: "vibe64-command", targetUser: owner }), release);
  assert.throws(() => resolveAllowedCwd(path.join(state, "escape"), owner.username,
    { operation: "vibe64-command", targetUser: owner }));
  assert.equal(resolveAllowedDeploymentServicePath(path.join(release, "start"), owner), path.join(release, "start"));
  assert.throws(() => resolveAllowedDeploymentServicePath(path.join(release, "escaped-start"), owner), /outside managed roots/u);
  assert.equal(canonicalPath(path.join(release, "new.pid"), { allowMissingLeaf: true }), path.join(release, "new.pid"));
  await symlink(path.join(outside, "missing"), path.join(release, "dangling.pid"));
  assert.throws(() => canonicalPath(path.join(release, "dangling.pid"), { allowMissingLeaf: true }), { code: "ENOENT" });
});
