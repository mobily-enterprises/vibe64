import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareSessionTempFolder, removeSessionTempFolder } from "@local/vibe64-runtime/server/sessionTempFolder";
import { helperChildEnv, sessionTempDirectory } from "../../packages/vibe64-execution/src/host/commandEnvironment.js";
import { resolveCommandEnv } from "../../packages/vibe64-execution/src/server/env/resolveCommandEnv.js";
import { normalizeVibe64CommandRequest } from "../../packages/vibe64-execution/src/server/request.js";

async function withRoot(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-session-temp-")));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

const exists = (target) => stat(target).then(() => true, () => false);

test("a session's temporary folder is made beside its source with the session folder's group, setgid and 2770, and removed with all in it", async (t) => {
  const root = await withRoot(t);
  const sessionFolder = path.join(root, "projects", "demo", "sessions", "active", "session-1");
  const source = path.join(sessionFolder, "source");
  await mkdir(source, { recursive: true });
  // As a managed session folder is: setgid, so what is made in it takes its group.
  await chmod(sessionFolder, 0o2770);
  const previousUmask = process.umask(0o007);
  let temp = "";
  try {
    temp = await prepareSessionTempFolder(source);
  } finally {
    process.umask(previousUmask);
  }
  assert.equal(temp, path.join(sessionFolder, "tmp"));
  const made = await stat(temp);
  assert.equal(made.mode & 0o7777, 0o2770);
  assert.equal(made.gid, (await stat(sessionFolder)).gid);

  await mkdir(path.join(temp, "repo", ".git"), { recursive: true });
  await writeFile(path.join(temp, "repo", "file.txt"), "throwaway\n");
  assert.equal(await prepareSessionTempFolder(source), temp, "an existing folder is kept as it is");
  assert.equal(await exists(path.join(temp, "repo", "file.txt")), true);

  assert.equal(await removeSessionTempFolder(source), true);
  assert.equal(await exists(temp), false);
  assert.equal(await exists(source), true);
  assert.equal(await prepareSessionTempFolder(path.join(root, "projects", "demo", "sessions", "active", "gone", "source")), "",
    "a session whose folder is gone gets none");
});

test("a link in the temporary folder's place is refused, and removing it never follows it", async (t) => {
  const root = await withRoot(t);
  const source = path.join(root, "sessions", "active", "session-1", "source");
  const elsewhere = path.join(root, "elsewhere");
  await mkdir(source, { recursive: true });
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, "keep.txt"), "not the session's\n");
  await symlink(elsewhere, path.join(path.dirname(source), "tmp"));

  await assert.rejects(prepareSessionTempFolder(source), { code: "vibe64_session_temp_folder_invalid" });
  await removeSessionTempFolder(source);
  assert.equal(await exists(path.join(path.dirname(source), "tmp")), false);
  assert.equal(await exists(path.join(elsewhere, "keep.txt")), true);
});

test("the gateway gives a session's command its temporary folder as TMPDIR, which no caller names", async (t) => {
  const root = await withRoot(t);
  const temp = path.join(root, "sessions", "active", "session-1", "tmp");
  const actor = { actor: "app", requiresRealUser: false, user: { home: root, username: os.userInfo().username } };
  const env = (request) => resolveCommandEnv({ actor, baseEnv: { PATH: process.env.PATH, TMPDIR: "/tmp" }, request: normalizeVibe64CommandRequest({
    actor: "app", args: [], command: "true", cwd: root, ...request
  }) });

  assert.equal(env({ tempDirectory: temp }).TMPDIR, temp);
  assert.notEqual(env({}).TMPDIR, temp);
  for (const tempDirectory of ["relative/tmp", `${temp}\n`, 7]) {
    assert.throws(() => env({ tempDirectory }), { code: "vibe64_command_temp_directory_invalid" }, String(tempDirectory));
  }
  assert.throws(() => env({ envPolicy: "staging", tempDirectory: temp }), { code: "vibe64_command_temp_directory_invalid" });
  assert.throws(() => env({ env: { TMPDIR: temp } }), { code: "vibe64_command_env_policy_reserved" });
});

test("plain local Git keeps its own identity and reaches remotes with no credential helper; every other command names the session's person", async (t) => {
  const root = await withRoot(t);
  const actor = { actor: "app", requiresRealUser: false, user: { home: root, username: os.userInfo().username } };
  const own = { GIT_AUTHOR_NAME: "Own Name", GIT_AUTHOR_EMAIL: "own@example.invalid" };
  const env = (request) => resolveCommandEnv({ actor, baseEnv: { PATH: process.env.PATH }, request: normalizeVibe64CommandRequest({
    actor: "app", args: ["commit"], command: "git", cwd: root, env: own, ...request
  }) });
  const config = (resolved) => Object.fromEntries(Array.from({ length: Number(resolved.GIT_CONFIG_COUNT || 0) }, (_, index) =>
    [resolved[`GIT_CONFIG_KEY_${index}`], resolved[`GIT_CONFIG_VALUE_${index}`]]));

  const plain = env({ gitIdentity: "none", gitTransport: "anonymous" });
  assert.equal(plain.GIT_AUTHOR_NAME, "Own Name");
  assert.equal(plain.GIT_AUTHOR_EMAIL, "own@example.invalid");
  assert.equal(plain.GIT_COMMITTER_NAME, undefined);
  assert.equal(config(plain)["credential.helper"], "");
  assert.equal(plain.GIT_TERMINAL_PROMPT, "0");

  const session = env({});
  assert.notEqual(session.GIT_AUTHOR_NAME, "Own Name");
  assert.equal(Object.hasOwn(config(session), "credential.helper"), false);
  assert.throws(() => env({ gitIdentity: "someone" }));
});

test("the host helper gives a session's temporary folder only to the workspace's own commands, as a real folder of an active session", async (t) => {
  const root = await withRoot(t);
  const managedRoot = path.join(root, "managed");
  const owner = "v64d_unitws";
  const projects = path.join(managedRoot, "unitws", "projects");
  const temp = path.join(projects, "demo", "sessions", "active", "session-1", "tmp");
  const elsewhere = path.join(root, "elsewhere");
  const linked = path.join(projects, "demo", "sessions", "active", "session-2", "tmp");
  const otherWorkspace = path.join(managedRoot, "otherws", "projects", "demo", "sessions", "active", "session-1", "tmp");
  for (const folder of [temp, elsewhere, path.dirname(linked), otherWorkspace, path.join(managedRoot, "unitws", "tmp")]) {
    await mkdir(folder, { recursive: true });
  }
  await symlink(elsewhere, linked);
  const daemon = { home: "/home/daemon", username: owner };
  const accepted = (value, user = daemon) => sessionTempDirectory(value, user, owner, { managedRoot });

  assert.equal(accepted(temp), temp);
  assert.equal(accepted(temp, { home: "/home/member", username: "member" }), "", "a person's command keeps the workspace's");
  assert.equal(accepted(temp, { ...daemon, stagingAccount: true }), "", "an application keeps its own");
  for (const refused of [
    path.join(managedRoot, "unitws", "tmp"),
    path.dirname(temp),
    path.join(path.dirname(temp), "source"),
    `${temp}/../tmp`,
    "sessions/active/session-1/tmp",
    linked,
    otherWorkspace,
    path.join(projects, "demo", "sessions", "archived", "session-1", "tmp"),
    7
  ]) {
    assert.equal(accepted(refused), "", String(refused));
  }
  // Through the helper's environment: a folder outside the workspace keeps the workspace's TMPDIR.
  assert.equal(helperChildEnv({ TMPDIR: temp }, daemon, owner).TMPDIR, "/var/lib/vibe64/unitws/tmp");
});
