import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  gitIdentityReadiness,
  isFallbackGitIdentityEmail,
  personGitConfigIdentity,
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
  assert.equal(personGitConfigIdentity({ env }), null);
  const readiness = gitIdentityReadiness({ env: {}, gitConfig: { env }, project: { workspace: "local" }, userKey: "ana" });
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
  const identity = resolveGitIdentity({
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
  const readiness = gitIdentityReadiness({ env: {}, gitConfig: { env } });
  assert.equal(readiness.status, "pass");
  assert.equal(isFallbackGitIdentityEmail(readiness.email), false);
});

test("Git's XDG config location and includes are honoured", async (t) => {
  const { env, home } = await freshHome(t);
  await mkdir(path.join(home, ".config", "git"), { recursive: true });
  await writeFile(path.join(home, "identity.inc"), "[user]\n\temail = xdg@example.test\n");
  await writeFile(path.join(home, ".config", "git", "config"), `[include]\n\tpath = ${path.join(home, "identity.inc")}\n[user]\n\tname = Xdg Person\n`);
  assert.equal(personGitConfigIdentity({ env })?.authorName, "Xdg Person");
  assert.equal(personGitConfigIdentity({ env })?.authorEmail, "xdg@example.test");
});

test("a repository's own identity wins over the global one for commands run there", async (t) => {
  const { env, gitConfig, root } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Global Name"]);
  await gitConfig(["--global", "user.email", "global@example.test"]);
  const repository = path.join(root, "repository");
  await mkdir(repository);
  await execFileAsync(REAL_GIT, ["init", "-q", repository], { env });
  await gitConfig(["user.email", "work@example.test"], { cwd: repository });
  assert.equal(personGitConfigIdentity({ cwd: repository, env }).authorEmail, "work@example.test");
  assert.equal(personGitConfigIdentity({ cwd: repository, env }).authorName, "Global Name");
  assert.equal(personGitConfigIdentity({ env }).authorEmail, "global@example.test");
});

test("a half or empty identity is not used", async (t) => {
  const { env, gitConfig } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Only A Name"]);
  assert.equal(personGitConfigIdentity({ env }), null);
  await gitConfig(["--global", "user.email", ""]);
  assert.equal(personGitConfigIdentity({ env }), null);
});

test("explicit project identity still wins over the person's Git config", async (t) => {
  const { env, gitConfig } = await freshHome(t);
  await gitConfig(["--global", "user.name", "Ana Diaz"]);
  await gitConfig(["--global", "user.email", "ana@example.test"]);
  const identity = resolveGitIdentity({
    env: {},
    gitConfig: { env },
    project: { gitIdentity: { email: "bot@example.test", name: "Project Bot" } }
  });
  assert.equal(identity.source, "configured");
  assert.equal(identity.authorEmail, "bot@example.test");
});

test("without git on PATH the lookup quietly finds nothing", async (t) => {
  const { env, root } = await freshHome(t);
  const identity = resolveGitIdentity({
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
  const identity = personGitConfigIdentity({ env: { ...env, PATH: `${shimDir}:${env.PATH}` } });
  assert.ok(Date.now() - started < 1_500, "the read waited on the shim");
  assert.equal(identity?.authorName, "Ana Shim");
  assert.equal(await stat(marker).then(() => true, () => false), false, "the shim ran");
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
