import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sessionTempPath } from "@local/vibe64-core/server/sessionSourcePath";
import { PROJECT_SLUG_MAX_LENGTH } from "@local/vibe64-core/shared/projectSlug";
import {
  assertSessionTempRootFits,
  prepareSessionTempFolder,
  removeSessionTempFolder
} from "@local/vibe64-runtime/server/sessionTempFolder";
import { prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { sessionCommandCwd } from "../../packages/vibe64-terminals/src/server/agentSessionCommandRun.js";
import {
  helperChildEnv,
  sessionTempDirectory,
  sessionTempFolderCwd
} from "../../packages/vibe64-execution/src/host/commandEnvironment.js";
import { DAEMON_USERNAME_PREFIX, MANAGED_ROOT, workspaceTempRoot } from "../../packages/vibe64-execution/src/host/hostAccounts.js";
import { resolveCommandEnv } from "../../packages/vibe64-execution/src/server/env/resolveCommandEnv.js";
import { normalizeVibe64CommandRequest } from "../../packages/vibe64-execution/src/server/request.js";

async function withRoot(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-session-temp-")));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

const exists = (target) => stat(target).then(() => true, () => false);

// A Unix socket's path holds at most 107 bytes on Linux (sun_path is 108, with its NUL), 103 on macOS and the BSDs.
const SOCKET_PATH_MAX = process.platform === "linux" ? 107 : 103;

test("a session's TMPDIR leaves room for a Unix socket a command makes in it, at the longest names Vibe64 allows", async (t) => {
  // A managed workspace's paths at their longest: its daemon is the Linux account DAEMON_USERNAME_PREFIX and the
  // workspace's name, at most 32 characters; a project's slug has at most PROJECT_SLUG_MAX_LENGTH; and a session's id
  // is its creation time with, past the first session of that second, a suffix up to _1000. The editor's TMPDIR there
  // is the workspace's temporary folder (workspaceTempRoot), below the helper's MANAGED_ROOT. The test's root, under
  // /tmp as every test holding a socket keeps it, stands for MANAGED_ROOT, and the workspace's name is shorter by as
  // much as the root is longer, so each path below has its real length.
  const workspaceNameMax = 32 - DAEMON_USERNAME_PREFIX.length;
  const managedRoot = await realpath(await mkdtemp("/tmp/v64-st-"));
  t.after(() => rm(managedRoot, { force: true, recursive: true }));
  const workspace = "w".repeat(workspaceNameMax - (managedRoot.length - MANAGED_ROOT.length));
  const workspaceRoot = path.join(managedRoot, workspace);
  assert.equal(path.join(workspaceRoot, "tmp").length,
    workspaceTempRoot(`${DAEMON_USERNAME_PREFIX}${"w".repeat(workspaceNameMax)}`).length);
  const source = path.join(workspaceRoot, "projects", "p".repeat(PROJECT_SLUG_MAX_LENGTH), "sessions", "active",
    "2026-11-24_23-59-59_1000", "source");
  const editorTemp = path.join(workspaceRoot, "tmp");
  await mkdir(source, { recursive: true });
  await mkdir(editorTemp, { mode: 0o2770 });
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = editorTemp;
  t.after(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });

  const temp = await prepareSessionTempFolder(source);
  // Room for what a test or tool makes there: a folder mkdtemp names (mb-net-XXXXXX) and a 20-character socket in it.
  const room = "/mb-net-XXXXXX".length + "/".length + 20;
  assert.ok(Buffer.byteLength(temp) <= SOCKET_PATH_MAX - room,
    `the session's TMPDIR ${temp} is ${Buffer.byteLength(temp)} bytes, leaving no room for a socket (${room} bytes) within ${SOCKET_PATH_MAX}`);
  const folder = await mkdtemp(path.join(temp, "mb-net-"));
  const socketPath = path.join(folder, `${"s".repeat(15)}.sock`);
  assert.ok(Buffer.byteLength(socketPath) <= SOCKET_PATH_MAX, `${socketPath} is ${Buffer.byteLength(socketPath)} bytes`);
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await new Promise((resolve) => server.close(resolve));
});

// The editor's own TMPDIR for one test: a folder in its root, setgid as a
// managed workspace's temporary folder is, so what is made in it takes its group.
async function withEditorTemp(t, root) {
  const editorTemp = path.join(root, "tmp");
  await mkdir(editorTemp);
  await chmod(editorTemp, 0o2770);
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = editorTemp;
  t.after(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });
  return editorTemp;
}

test("a session's temporary folder is its own short folder in the editor's TMPDIR, made with its group, setgid and 2770, and removed with all in it", async (t) => {
  const root = await withRoot(t);
  const editorTemp = await withEditorTemp(t, root);
  const sessionFolder = path.join(root, "projects", "demo", "sessions", "active", "session-1");
  const source = path.join(sessionFolder, "source");
  const otherSource = path.join(root, "projects", "other", "sessions", "active", "session-1", "source");
  await mkdir(source, { recursive: true });
  await mkdir(otherSource, { recursive: true });
  const previousUmask = process.umask(0o007);
  let temp = "";
  try {
    temp = await prepareSessionTempFolder(source);
  } finally {
    process.umask(previousUmask);
  }
  assert.equal(path.dirname(temp), editorTemp);
  assert.match(path.basename(temp), /^v64s-[0-9a-f]{12}$/u);
  assert.equal(sessionTempPath(source), temp, "the same session always has the same folder");
  assert.notEqual(sessionTempPath(otherSource), temp, "another project's session of the same id has its own");
  const made = await stat(temp);
  assert.equal(made.mode & 0o7777, 0o2770);
  assert.equal(made.gid, (await stat(editorTemp)).gid);

  await mkdir(path.join(temp, "repo", ".git"), { recursive: true });
  await writeFile(path.join(temp, "repo", "file.txt"), "throwaway\n");
  assert.equal(await prepareSessionTempFolder(source), temp, "an existing folder is kept as it is");
  assert.equal(await exists(path.join(temp, "repo", "file.txt")), true);

  assert.equal(await removeSessionTempFolder(source), true);
  assert.equal(await exists(temp), false);
  assert.equal(await exists(source), true);
  assert.equal(await removeSessionTempFolder(source), false, "a folder already gone is nothing to remove");
  const gone = path.join(root, "projects", "demo", "sessions", "active", "gone", "source");
  assert.equal(await prepareSessionTempFolder(gone), "", "a session whose folder is gone gets none");
  assert.equal(await exists(sessionTempPath(gone)), false);
});

test("a link, a file or a folder others may enter in the temporary folder's place is refused, and removing a link never follows it", async (t) => {
  const root = await withRoot(t);
  await withEditorTemp(t, root);
  const source = path.join(root, "sessions", "active", "session-1", "source");
  const elsewhere = path.join(root, "elsewhere");
  await mkdir(source, { recursive: true });
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, "keep.txt"), "not the session's\n");
  const temp = sessionTempPath(source);
  await symlink(elsewhere, temp);

  await assert.rejects(prepareSessionTempFolder(source), { code: "vibe64_session_temp_folder_invalid" });
  assert.equal(await removeSessionTempFolder(source), true);
  assert.equal(await exists(temp), false);
  assert.equal(await exists(path.join(elsewhere, "keep.txt")), true);

  await writeFile(temp, "a file\n");
  await assert.rejects(prepareSessionTempFolder(source), { code: "vibe64_session_temp_folder_invalid" });
  await rm(temp);
  await mkdir(temp);
  await chmod(temp, 0o777);
  await assert.rejects(prepareSessionTempFolder(source), (error) => {
    assert.equal(error.code, "vibe64_session_temp_folder_invalid");
    assert.match(error.message, /Remove what is there; Vibe64 makes the folder again\./u);
    return true;
  });
});

test("a TMPDIR too long for the sockets below a session's folder is refused at the AI's start and at each command, naming the fix, never shortened", async (t) => {
  // Under /tmp, so the longest TMPDIR that fits can be made below it.
  const root = await realpath(await mkdtemp("/tmp/v64-st-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = path.join(root, "sessions", "active", "session-1", "source");
  await mkdir(source, { recursive: true });
  // The longest TMPDIR that still leaves room: the session's folder adds 18 bytes (/v64s- and 12 hex digits).
  const longest = SOCKET_PATH_MAX - ("/mb-net-XXXXXX".length + "/".length + 20) - "/v64s-0123456789ab".length;
  const fits = path.join(root, "f".repeat(longest - root.length - 1));
  const tooLong = `${fits}x`;
  assert.equal(Buffer.byteLength(fits), longest);
  await mkdir(fits);
  await mkdir(tooLong);
  const previousTmpdir = process.env.TMPDIR;
  t.after(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });

  process.env.TMPDIR = fits;
  assertSessionTempRootFits();
  assert.equal(path.dirname(await prepareSessionTempFolder(source)), fits);
  assert.equal(await removeSessionTempFolder(source), true);

  process.env.TMPDIR = tooLong;
  const refusal = (error) => {
    assert.equal(error.code, "vibe64_session_temp_folder_too_long");
    assert.ok(error.message.includes(`Start Vibe64 with a TMPDIR of at most ${longest} bytes (it is ${tooLong})`), error.message);
    return true;
  };
  assert.throws(() => assertSessionTempRootFits(), refusal);
  await assert.rejects(prepareAgentSessionCommand({
    commandService: { bindSession: () => assert.fail("the AI starts with no room for its sockets") },
    sessionId: "session-1",
    wrapperHostDir: path.join(root, "wrappers")
  }), refusal);
  await assert.rejects(prepareSessionTempFolder(source), refusal);
  assert.equal(await exists(sessionTempPath(source)), false, "nothing is made in its place");
  const command = await sessionCommandCwd(source, source);
  assert.equal(command.ok, false);
  assert.equal(command.code, "vibe64_session_temp_folder_too_long");
  assert.match(command.stderr, /Start Vibe64 with a TMPDIR of at most/u);
});

test("the gateway gives a session's command its temporary folder as TMPDIR, which no caller names", async (t) => {
  const root = await withRoot(t);
  const temp = path.join(root, "tmp", "v64s-0123456789ab");
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

test("the host helper gives a session's temporary folder only to the workspace's own commands, as a real v64s- folder in the workspace's temporary folder, and lets them start there", async (t) => {
  const root = await withRoot(t);
  const managedRoot = path.join(root, "managed");
  // The workspace's own account: the helper finds its workspace folder (unitws) by the daemon prefix.
  const owner = `${DAEMON_USERNAME_PREFIX}unitws`;
  const workspaceTemp = path.join(managedRoot, "unitws", "tmp");
  const temp = path.join(workspaceTemp, "v64s-0123456789ab");
  const nested = path.join(temp, "mb-net-abc123");
  const elsewhere = path.join(root, "elsewhere");
  const linked = path.join(workspaceTemp, "v64s-0123456789ac");
  const otherWorkspace = path.join(managedRoot, "otherws", "tmp", "v64s-0123456789ab");
  const oldShape = path.join(managedRoot, "unitws", "projects", "demo", "sessions", "active", "session-1", "tmp");
  for (const folder of [nested, elsewhere, otherWorkspace, oldShape, path.join(workspaceTemp, "v64s-xyz"), path.join(workspaceTemp, "other")]) {
    await mkdir(folder, { recursive: true });
  }
  await symlink(elsewhere, linked);
  const daemon = { home: "/home/daemon", username: owner };
  const member = { home: "/home/member", username: "member" };
  const accepted = (value, user = daemon) => sessionTempDirectory(value, user, owner, { managedRoot });

  assert.equal(accepted(temp), temp);
  assert.equal(accepted(temp, member), "", "a person's command keeps the workspace's");
  assert.equal(accepted(temp, { ...daemon, stagingAccount: true }), "", "an application keeps its own");
  for (const refused of [
    workspaceTemp,
    nested,
    path.join(workspaceTemp, "v64s-xyz"),
    path.join(workspaceTemp, "other"),
    path.join(workspaceTemp, "v64s-0123456789ad"),
    `${nested}/..`,
    "tmp/v64s-0123456789ab",
    linked,
    otherWorkspace,
    oldShape,
    7
  ]) {
    assert.equal(accepted(refused), "", String(refused));
  }
  // Through the helper's environment: a folder outside the workspace keeps the workspace's TMPDIR.
  assert.equal(helperChildEnv({ TMPDIR: temp }, daemon, owner).TMPDIR, workspaceTempRoot(owner));

  // The workspace's own commands may start in a session's temporary folder, as it really is.
  const cwd = (value, user = daemon) => sessionTempFolderCwd(value, user, owner, { managedRoot });
  assert.equal(cwd(temp), temp);
  assert.equal(cwd(nested), nested);
  assert.equal(cwd(`${nested}/..`), temp);
  assert.equal(cwd(temp, member), "");
  assert.equal(cwd(temp, { ...daemon, stagingAccount: true }), "");
  for (const refused of [workspaceTemp, linked, path.join(workspaceTemp, "other"), path.join(workspaceTemp, "v64s-xyz"),
    otherWorkspace, path.join(workspaceTemp, "v64s-0123456789ad")]) {
    assert.equal(cwd(refused), "", refused);
  }
});
