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

test("the daemon's generic commands admit only exact private Colleague workspaces", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-colleague-path-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const colleague = path.join(home, ".local/state/vibe64/colleague");
  const userKey = Buffer.from("1001").toString("base64url");
  const scopeId = `colleague_${"a".repeat(32)}`;
  const workspace = path.join(colleague, userKey, scopeId);
  const nested = path.join(workspace, "nested");
  const sibling = path.join(home, ".local/state/vibe64/colleague-sibling", userKey, scopeId);
  const malformedUser = path.join(colleague, "user.name", scopeId);
  const malformedScope = path.join(colleague, userKey, "colleague_invalid");
  const outside = path.join(root, "outside");
  for (const directory of [nested, sibling, malformedUser, malformedScope, outside]) {
    await mkdir(directory, { recursive: true });
  }
  const escapingScope = path.join(colleague, userKey, `colleague_${"b".repeat(32)}`);
  const escapingUser = path.join(colleague, "other_user");
  await symlink(outside, escapingScope);
  await mkdir(path.join(outside, scopeId));
  await symlink(outside, escapingUser);
  const owner = { home, username: "v64d_workspace" };
  const options = { operation: "vibe64-command", targetUser: owner };
  assert.equal(resolveAllowedCwd(workspace, owner.username, options), workspace);
  for (const refused of [home, colleague, path.dirname(workspace), nested, sibling,
    malformedUser, malformedScope, escapingScope, path.join(escapingUser, scopeId)]) {
    assert.throws(() => resolveAllowedCwd(refused, owner.username, options), undefined, refused);
  }
  assert.throws(() => resolveAllowedCwd(workspace, "v64d_another", options));
  assert.throws(() => resolveAllowedCwd(workspace, owner.username, { ...options, operation: "github-workflow-command" }));
});

test("the daemon's generic commands admit exact private Learn-mode Colleague workspaces", async (t) => {
  // Colleague keeps each Learn thread's runtime beside its file:
  // colleague/<learnerKey>/learn/<attemptId|lobby>/colleague_<scope>.
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-learn-colleague-path-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const learn = path.join(home, ".local/state/vibe64/colleague", Buffer.from("1000").toString("base64url"), "learn");
  const scopeId = `colleague_${"c".repeat(32)}`;
  const attempt = path.join(learn, "8d074ed1-f737-46f0-8a45-c30d21370db2", scopeId);
  const lobby = path.join(learn, "lobby", scopeId);
  const refused = [
    path.join(attempt, "nested"),
    path.join(learn, "not-an-attempt", scopeId),
    path.join(learn, "8D074ED1-F737-46F0-8A45-C30D21370DB2", scopeId),
    path.join(path.dirname(learn), "teach", "lobby", scopeId),
    path.join(learn, "lobby", "colleague_invalid")
  ];
  const outside = path.join(root, "outside");
  for (const directory of [attempt, lobby, ...refused, path.join(outside, scopeId)]) await mkdir(directory, { recursive: true });
  const escapingAttempt = path.join(learn, "11111111-2222-4333-8444-555555555555");
  await symlink(outside, escapingAttempt);
  const owner = { home, username: "v64d_workspace" };
  const options = { operation: "vibe64-command", targetUser: owner };
  assert.equal(resolveAllowedCwd(attempt, owner.username, options), attempt);
  assert.equal(resolveAllowedCwd(lobby, owner.username, options), lobby);
  for (const candidate of [...refused, path.dirname(attempt), learn, path.join(escapingAttempt, scopeId)]) {
    assert.throws(() => resolveAllowedCwd(candidate, owner.username, options), undefined, candidate);
  }
  assert.throws(() => resolveAllowedCwd(attempt, owner.username, { ...options, operation: "github-workflow-command" }));
});


test("the daemon's generic commands admit only exact Learning source scratch directories", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-training-sources-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const sources = path.join(home, ".local/state/vibe64/training-sources");
  const scratch = path.join(sources, "topic-0f8fad5b-d9cb-469f-a165-70867728950e");
  const catalogue = path.join(sources, "catalogue-7c9e6679-7425-40de-944b-e07fc1f90ae7");
  const nested = path.join(scratch, "training");
  const malformed = path.join(sources, "anything-0f8fad5b-d9cb-469f-a165-70867728950e");
  const sibling = path.join(home, ".local/state/vibe64/training/content");
  const outside = path.join(root, "outside");
  for (const directory of [nested, catalogue, malformed, sibling, outside]) await mkdir(directory, { recursive: true });
  const escaping = path.join(sources, "topic-11111111-2222-4333-8444-555555555555");
  await symlink(outside, escaping);
  const owner = { home, username: "v64d_workspace" };
  const options = { operation: "vibe64-command", targetUser: owner };
  assert.equal(resolveAllowedCwd(scratch, owner.username, options), scratch);
  assert.equal(resolveAllowedCwd(catalogue, owner.username, options), catalogue);
  for (const refused of [sources, nested, malformed, sibling, escaping]) {
    assert.throws(() => resolveAllowedCwd(refused, owner.username, options), undefined, refused);
  }
  assert.throws(() => resolveAllowedCwd(scratch, "v64d_another", options));
  assert.throws(() => resolveAllowedCwd(scratch, owner.username, { ...options, operation: "github-workflow-command" }));
});

// Learning v2 retired the source-less teacher: its former agent directory is
// no longer an allowed working directory (the rule was removed with it).
test("the daemon's generic commands no longer admit retired Learning session agent directories", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-learning-session-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const users = path.join(home, ".local/state/vibe64/training/users");
  const learner = Buffer.from("1000").toString("base64url");
  const attemptId = "9fb73496-78fc-4f42-b8eb-ed7c6ed0bfcc";
  const otherAttempt = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const session = path.join(users, learner, "learning-sessions", attemptId, "sessions/active", `learning-${attemptId}`);
  const native = path.join(session, "native");
  const nested = path.join(native, "nested");
  const mismatched = path.join(users, learner, "learning-sessions", attemptId, "sessions/active", `learning-${otherAttempt}`, "native");
  const malformedLearner = path.join(users, "user.name", "learning-sessions", attemptId, "sessions/active", `learning-${attemptId}`, "native");
  const otherNamespace = path.join(home, ".local/state/vibe64/training/content", learner, "learning-sessions", attemptId, "sessions/active", `learning-${attemptId}`, "native");
  const outside = path.join(root, "outside");
  for (const directory of [nested, mismatched, malformedLearner, otherNamespace, outside]) await mkdir(directory, { recursive: true });
  const escapingAttempt = "11111111-2222-4333-8444-555555555555";
  await mkdir(path.join(users, learner, "learning-sessions", escapingAttempt, "sessions/active", `learning-${escapingAttempt}`), { recursive: true });
  const escaping = path.join(users, learner, "learning-sessions", escapingAttempt, "sessions/active", `learning-${escapingAttempt}`, "native");
  await symlink(outside, escaping);
  const owner = { home, username: "v64d_workspace" };
  const options = { operation: "vibe64-command", targetUser: owner };
  for (const refused of [native, users, session, nested, mismatched, malformedLearner, otherNamespace, escaping]) {
    assert.throws(() => resolveAllowedCwd(refused, owner.username, options), undefined, refused);
  }
});

test("workspace cache jobs use an exact daemon scratch directory without opening other private state", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "cache-job-boundary-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = path.join(home, ".local/state/vibe64/cache-maintenance");
  await mkdir(root, { recursive: true });
  const cwd = await mkdtemp(path.join(root, "composer-"));
  const owner = { username: "v64d_workspace", home };
  const options = { operation: "workspace-cache-command", targetUser: owner };
  assert.equal(resolveAllowedCwd(cwd, owner.username, options), cwd);
  for (const refused of [home, root, path.dirname(root)]) {
    assert.throws(() => resolveAllowedCwd(refused, owner.username, options));
  }
  assert.throws(() => resolveAllowedCwd(cwd, "v64d_other", options));
  await symlink(home, path.join(root, "npm-abcdef"));
  assert.throws(() => resolveAllowedCwd(path.join(root, "npm-abcdef"), owner.username, options));
});
