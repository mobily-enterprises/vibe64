import assert from "node:assert/strict";
import childProcess, { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";

import {
  gitIdentityReadiness,
  isFallbackGitIdentityEmail,
  personGitConfigIdentity,
  personGitConfigIdentitySync,
  resolveGitIdentity
} from "../../packages/vibe64-execution/src/server/env/gitIdentityEnv.js";

const execFileAsync = promisify(execFile);
const REAL_GIT = (await execFileAsync("sh", ["-c", "command -v git"], { encoding: "utf8" })).stdout.trim();

// A fresh home with only git on PATH; the system config is ignored so the
// laptop running the test cannot leak its own identity in.
async function freshHome(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-git-identity-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  await symlink(REAL_GIT, path.join(bin, "git"));
  const env = {
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: home,
    PATH: bin,
    XDG_CONFIG_HOME: path.join(home, ".config")
  };
  const gitConfig = (args, options = {}) => execFileAsync(REAL_GIT, ["config", ...args], { env, ...options });
  return { env, gitConfig, home, root };
}

test("an unconfigured person gets the marked stand-in identity and a warning", async (t) => {
  const { env } = await freshHome(t);
  assert.equal(await personGitConfigIdentity({ env }), null);
  const readiness = await gitIdentityReadiness({ env: {}, gitConfig: { env }, project: { workspace: "local" }, userKey: "ana" });
  assert.equal(readiness.source, "fallback");
  assert.equal(readiness.status, "warn");
  assert.equal(readiness.email, "ana@local.users.vibe64.invalid");
  assert.equal(isFallbackGitIdentityEmail(readiness.email), true);
  assert.match(readiness.explanation, /stand-in/u);
});

test("the person's global Git identity is used before GitHub and the stand-in", async (t) => {
  const { env, gitConfig } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Ana Diaz"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  const identity = await resolveGitIdentity({
    env: {},
    gitConfig: { env },
    project: { githubUser: { email: "octo@example.test", login: "octocat" } }
  });
  assert.deepEqual(identity, {
    authorEmail: "ana@example.test",
    authorName: "Ana Diaz",
    committerEmail: "ana@example.test",
    committerName: "Ana Diaz",
    source: "git-config"
  });
  const readiness = await gitIdentityReadiness({ env: {}, gitConfig: { env } });
  assert.equal(readiness.status, "pass");
  assert.equal(isFallbackGitIdentityEmail(readiness.email), false);
});

test("Git's XDG config location and includes are honoured", async (t) => {
  const { env, home } = await freshHome(t);
  await mkdir(path.join(home, ".config", "git"), { recursive: true });
  await writeFile(path.join(home, "identity.inc"), "[user]\n\temail = xdg@example.test\n");
  await writeFile(path.join(home, ".config", "git", "config"), `[include]\n\tpath = ${path.join(home, "identity.inc")}\n[user]\n\tname = Xdg Person\n`);
  for (const read of [personGitConfigIdentity, personGitConfigIdentitySync]) {
    assert.equal((await read({ env }))?.authorName, "Xdg Person");
    assert.equal((await read({ env }))?.authorEmail, "xdg@example.test");
  }
});

test("a repository's own identity wins over the global one for commands run there", async (t) => {
  const { env, gitConfig, root } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Global Name"]);
  await gitConfig(["--global", "user.email", "global@example.test"]);
  const repository = path.join(root, "repository");
  await mkdir(repository);
  await execFileAsync(REAL_GIT, ["init", "-q", repository], { env });
  await gitConfig(["user.email", "work@example.test"], { cwd: repository });
  for (const read of [personGitConfigIdentity, personGitConfigIdentitySync]) {
    assert.equal((await read({ cwd: repository, env })).authorEmail, "work@example.test");
    assert.equal((await read({ cwd: repository, env })).authorName, "Global Name");
    assert.equal((await read({ env })).authorEmail, "global@example.test");
  }
});

test("a half or empty identity is not used", async (t) => {
  const { env, gitConfig } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Only A Name"]);
  assert.equal(await personGitConfigIdentity({ env }), null);
  await gitConfig(["--global", "user.email", ""]);
  assert.equal(await personGitConfigIdentity({ env }), null);
});

test("explicit project identity still wins over the person's Git config", async (t) => {
  const { env, gitConfig } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Ana Diaz"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  const identity = await resolveGitIdentity({
    env: {},
    gitConfig: { env },
    project: { gitIdentity: { email: "bot@example.test", name: "Project Bot" } }
  });
  assert.equal(identity.source, "configured");
  assert.equal(identity.authorEmail, "bot@example.test");
});

test("without git on PATH the lookup quietly finds nothing", async (t) => {
  const { env, root } = await freshHome(t);
  const identity = await resolveGitIdentity({
    env: {},
    gitConfig: { env: { ...env, PATH: path.join(root, "empty") } },
    userKey: "ana"
  });
  assert.equal(identity.source, "fallback");
});

// Hosted incident 2026-10-24: an agent's PATH starts with Vibe64's git shim,
// which the reading server itself serves; a synchronous read through it froze
// the server and lost chat subscriptions. The read must never run that shim.
test("the identity read never runs a git shim that leads the command's PATH", async (t) => {
  const { env, gitConfig, root } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Ana Shim"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  const shimDir = path.join(root, "shim");
  const marker = path.join(root, "shim-ran");
  await mkdir(shimDir, { recursive: true });
  await writeFile(path.join(shimDir, "git"), `#!/bin/sh\ntouch '${marker}'\nsleep 5\nexit 1\n`, { mode: 0o755 });
  const started = Date.now();
  const identity = await personGitConfigIdentity({ env: { ...env, PATH: `${shimDir}:${env.PATH}` } });
  assert.ok(Date.now() - started < 1_500, "the read waited on the shim");
  assert.equal(identity?.authorName, "Ana Shim");
  assert.equal(await stat(marker).then(() => true, () => false), false, "the shim ran");
});

// Every git the server starts for an identity read goes through this wrapper,
// which records the call (and can be slowed) before running the real git.
async function countedGit(t, { delaySeconds = 0 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-git-reads-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls");
  await mkdir(bin);
  await writeFile(path.join(bin, "git"), [
    "#!/bin/sh",
    `case "$*" in *--get-regexp*) echo read >> '${log}' ;; esac`,
    ...(delaySeconds ? [`sleep ${delaySeconds}`] : []),
    `exec '${REAL_GIT}' "$@"`,
    ""
  ].join("\n"), { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(root, { force: true, recursive: true });
  });
  return {
    reads: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).length
  };
}

// A gateway command whose identity comes only from one global config file.
async function identityCommand(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-git-identity-command-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const globalConfig = path.join(root, "gitconfig");
  const setIdentity = async (name, email) => {
    await execFileAsync(REAL_GIT, ["config", "--file", globalConfig, "user.name", name]);
    await execFileAsync(REAL_GIT, ["config", "--file", globalConfig, "user.email", email]);
  };
  const run = async () => {
    const result = await runVibe64Command({
      actor: "daemon",
      args: ["-e", "console.log(JSON.stringify([process.env.GIT_AUTHOR_NAME, process.env.GIT_AUTHOR_EMAIL, process.env.GIT_COMMITTER_NAME, process.env.GIT_COMMITTER_EMAIL]))"],
      command: process.execPath,
      cwd: root,
      env: { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" }
    });
    assert.equal(result.ok, true, result.error || result.output);
    return JSON.parse(result.stdout);
  };
  return { run, setIdentity };
}

test("commands within the identity memo share one git config read", async (t) => {
  const git = await countedGit(t);
  const { run, setIdentity } = await identityCommand(t);
  await setIdentity("Ana Diaz", "ana@example.test");
  const expected = ["Ana Diaz", "ana@example.test", "Ana Diaz", "ana@example.test"];
  const concurrent = await Promise.all([run(), run(), run()]);
  const sequential = [await run(), await run()];
  for (const identity of [...concurrent, ...sequential]) assert.deepEqual(identity, expected);
  assert.equal(await git.reads(), 1);
});

test("saving a new global identity reaches the very next command", async (t) => {
  const git = await countedGit(t);
  const { run, setIdentity } = await identityCommand(t);
  await setIdentity("Ana Diaz", "ana@example.test");
  assert.deepEqual((await run()).slice(0, 2), ["Ana Diaz", "ana@example.test"]);
  await setIdentity("Ana Gomez", "gomez@example.test");
  assert.deepEqual((await run()).slice(0, 2), ["Ana Gomez", "gomez@example.test"]);
  assert.equal(await git.reads(), 2);
});

test("a command never reads Git's identity with a blocking spawnSync", async (t) => {
  await countedGit(t, { delaySeconds: 0.3 });
  const { run, setIdentity } = await identityCommand(t);
  await setIdentity("Ana Diaz", "ana@example.test");
  const blocking = [];
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, ...rest) => {
    blocking.push(command);
    return original(command, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  });
  let ticks = 0;
  const ticker = setInterval(() => { ticks += 1; }, 20);
  try {
    assert.deepEqual((await run()).slice(0, 2), ["Ana Diaz", "ana@example.test"]);
  } finally {
    clearInterval(ticker);
  }
  assert.deepEqual(blocking, []);
  assert.ok(ticks >= 5, `the server's thread was held while git read the identity (${ticks} ticks)`);
});

test("env overrides of Git config keep their effect and their own memo entry", async (t) => {
  const { env, gitConfig } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Ana Diaz"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  const overridden = { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.email", GIT_CONFIG_VALUE_0: "override@example.test" };
  for (const read of [personGitConfigIdentity, personGitConfigIdentitySync]) {
    assert.equal((await read({ env })).authorEmail, "ana@example.test");
    assert.equal((await read({ env: overridden })).authorEmail, "override@example.test");
    assert.equal((await read({ env })).authorEmail, "ana@example.test");
  }
});

test("a change Git's global file can't show is picked up once the memo ends", async (t) => {
  const git = await countedGit(t);
  const { env, home } = await freshHome(t);
  const include = path.join(home, "identity.inc");
  await writeFile(include, "[user]\n\temail = first@example.test\n");
  await writeFile(path.join(home, ".gitconfig"), `[include]\n\tpath = ${include}\n[user]\n\tname = Ana Diaz\n`);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  assert.equal((await personGitConfigIdentity({ env })).authorEmail, "first@example.test");
  await writeFile(include, "[user]\n\temail = second@example.test\n");
  t.mock.timers.tick(29_000);
  assert.equal((await personGitConfigIdentity({ env })).authorEmail, "first@example.test");
  t.mock.timers.tick(1_001);
  assert.equal((await personGitConfigIdentity({ env })).authorEmail, "second@example.test");
  assert.equal(await git.reads(), 2);
});

test("a read that never finished is not remembered", async (t) => {
  const { env, gitConfig, root } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Ana Diaz"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  // A git that hangs past the read's timeout until the flag is removed.
  const bin = path.join(root, "hanging-bin");
  const hanging = path.join(root, "hanging");
  await mkdir(bin);
  await writeFile(hanging, "");
  await writeFile(path.join(bin, "git"), `#!/bin/sh\n[ -e '${hanging}' ] && exec sleep 10\nexec '${REAL_GIT}' "$@"\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => { process.env.PATH = previousPath; });
  assert.equal(await personGitConfigIdentity({ env }), null);
  await rm(hanging);
  assert.equal((await personGitConfigIdentity({ env })).authorEmail, "ana@example.test");
});

test("connecting GitHub keeps the person's Git identity and never writes empty values", async (t) => {
  const { ghLoginCommandArgs } = await import("../../packages/vibe64-accounts/src/server/service.js");
  const { env, gitConfig, root } = await freshHome(t);
  // A signed-in gh whose setup-git is a no-op, so only the identity lines matter.
  await writeFile(path.join(root, "bin", "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const runLogin = async (identity) => {
    const [command, flag, script] = ghLoginCommandArgs(identity);
    await execFileAsync(command, [flag.replace("l", ""), script], { env: { ...env, PATH: `${env.PATH}:/usr/bin:/bin` } });
  };
  const read = async (key) => (await gitConfig(["--global", "--get", key]).catch(() => ({ stdout: "" }))).stdout.trim();

  await runLogin({ email: "", name: "" });
  assert.equal(await read("user.name"), "");
  assert.equal(await read("user.email"), "");

  await runLogin({ email: "octo@example.test", name: "Octo Cat" });
  assert.equal(await read("user.name"), "Octo Cat");
  assert.equal(await read("user.email"), "octo@example.test");

  await gitConfig(["--global", "user.name", "Ana Diaz"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  await runLogin({ email: "other@example.test", name: "Someone Else" });
  assert.equal(await read("user.name"), "Ana Diaz");
  assert.equal(await read("user.email"), "ana@example.test");
});

test("Git failures a person can fix read as one plain sentence", async (t) => {
  const { describeGitFailure, gitInstallCommand } = await import("../../packages/vibe64-execution/src/server/gitFailure.js");
  const { root } = await freshHome(t);
  const aptBin = path.join(root, "apt-bin");
  await mkdir(aptBin);
  await writeFile(path.join(aptBin, "apt-get"), "#!/bin/sh\n", { mode: 0o755 });
  const apt = { env: { PATH: aptBin }, platform: "linux", systemPath: "" };

  assert.equal(gitInstallCommand({ env: { PATH: "" }, platform: "darwin" }), "xcode-select --install");
  assert.equal(gitInstallCommand(apt), "sudo apt install git");
  assert.equal(gitInstallCommand({ env: { PATH: path.join(root, "none") }, platform: "linux", systemPath: "" }), "");
  // Git runs with the system folders after PATH, so apt-get is found there too.
  assert.equal(gitInstallCommand({ env: { PATH: "" }, platform: "linux", systemPath: aptBin }), "sudo apt install git");
  // Health and the Git failure message give the same install line and find apt-get the same way.
  const { localToolInstall, thisComputerToolFamily } = await import("../../packages/vibe64-execution/src/server/runtime/localTools.js");
  for (const machine of [apt, { env: { PATH: "" }, platform: "darwin" }, { env: { PATH: "" }, platform: "linux", systemPath: aptBin }]) {
    assert.equal(gitInstallCommand(machine), localToolInstall("git", { family: thisComputerToolFamily(machine) }).command);
  }

  const missing = describeGitFailure({ error: "Command failed with ENOENT: git init\nspawn git ENOENT" }, apt);
  assert.equal(missing.code, "vibe64_git_missing");
  assert.equal(missing.message, "Git isn't installed on this computer. Install it with: sudo apt install git");
  assert.equal(describeGitFailure({ stderr: "bash: line 1: git: command not found\n" }, apt).code, "vibe64_git_missing");
  assert.equal(describeGitFailure({ error: "Error: spawnSync git ENOENT" }, apt).code, "vibe64_git_missing");

  const old = describeGitFailure({ stderr: "error: unknown option `initial-branch=main'\nusage: git init" }, apt);
  assert.equal(old.code, "vibe64_git_too_old");
  assert.doesNotMatch(old.message, /usage|unknown option/u);

  const signing = describeGitFailure({ stderr: "error: gpg failed to sign the data\nfatal: failed to write commit object" });
  assert.equal(signing.code, "vibe64_git_signing_failed");

  assert.equal(describeGitFailure({ stderr: "fatal: refusing to merge unrelated histories" }), null);
});
