// Save's, Update's and work inspection's Git that carries the session's GitHub
// token, and every program their operation starts, runs no program the
// session's repository names (saveCommand in sessionWorkCommands.js,
// githubTokenGit.js).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { VIBE64_RUNTIME_NAMESPACE_ENV } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { saveCommand } from "../../packages/vibe64-terminals/src/server/sessionWorkCommands.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import { githubTokenTransportFixture } from "./githubTokenTransportFixture.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

const TOKEN = "secret-github-token";
const REFUSED = "vibe64_session_work_git_config_refused";

async function saveFixture(root) {
  const source = path.join(root, "session", "source");
  const fixture = await githubTokenTransportFixture(root, source);
  const context = {
    mode: "github",
    remoteUrl: "https://github.com/owner/repo.git",
    sessionId: "save-token-session",
    standaloneSourceRoot: "",
    worktreePath: source
  };
  // What a GitHub session's Save context gives its commands (sessionWorkSaveContext).
  const commandOptions = {
    actor: "app",
    gitAuthToken: TOKEN,
    gitTransport: "github-token",
    purpose: "github",
    userKey: currentOsUser().username
  };
  const calls = [];
  const run = (command, args) => saveCommand(async (request) => {
    calls.push(request);
    return fixture.runGateway(request);
  }, context, command, args, { commandOptions });
  return { ...fixture, calls, run, source };
}

test("Save's Git with the token, and every Git its operation starts, runs none of the repository's hooks, fsmonitor or helpers", async () => {
  await withTemporaryRoot(async (root) => {
    const fixture = await saveFixture(root);
    const { git, program, source } = fixture;
    for (const name of ["pre-push", "reference-transaction", "post-merge", "pre-commit", "post-commit"]) {
      await program(path.join(source, ".git", "hooks", name), name);
    }
    await git(source, ["config", "core.fsmonitor", await program(path.join(root, "programs", "fsmonitor"), "fsmonitor")]);
    await git(source, ["config", "credential.helper", `!${await program(path.join(root, "programs", "helper"), "helper")}`]);
    await git(fixture.upstream, ["commit", "--quiet", "--allow-empty", "-m", "upstream change"]);
    await git(fixture.upstream, ["push", "--quiet", "origin", "main"]);

    const fetched = await fixture.run("git", ["fetch", "origin"]);
    assert.equal(fetched.ok, true, fetched.stderr || fetched.error);
    assert.match(await readFile(fixture.credential, "utf8"), new RegExp(`^password=${TOKEN}$`, "mu"));
    // As Save's operation does, a program that runs Git itself.
    const saved = await fixture.run("bash", ["-c",
      "git merge --quiet --ff-only origin/main && git commit --quiet --allow-empty -m saved && git push --quiet origin HEAD:main"]);
    assert.equal(saved.ok, true, saved.stderr || saved.error);
    assert.equal(await git(fixture.bare, ["rev-parse", "main"]), await git(source, ["rev-parse", "HEAD"]));
    assert.deepEqual(await fixture.programsRun(), [], "no hook, fsmonitor or helper ran");
    // The token commands' config reads ran with no token.
    assert.deepEqual(fixture.calls.filter((request) => request.args[0] === "config").map((request) => request.gitTransport),
      ["none", "none"]);

    // Git without the token runs them: they are there and run.
    await git(source, ["commit", "--quiet", "--allow-empty", "-m", "local"]);
    assert.ok((await fixture.programsRun()).includes("post-commit "));
  });
});

test("Save refuses a repository whose own config names a program its Git could run, before anything with the token runs", async () => {
  await withTemporaryRoot(async (root) => {
    const fixture = await saveFixture(root);
    const { git, source } = fixture;
    const tokenCommands = () => fixture.calls.filter((request) => request.gitTransport === "github-token");

    await git(source, ["config", "filter.lfs.smudge", "cat"]);
    await assert.rejects(fixture.run("bash", ["-c", "git checkout --quiet -B main origin/main"]), (error) => {
      assert.equal(error.code, REFUSED);
      assert.match(error.message, /sets filter\.lfs\.smudge \(\.git\/config\), a filter program Git runs/u);
      assert.match(error.message, /git config --local --unset-all filter\.lfs\.smudge/u);
      return true;
    });
    assert.deepEqual(tokenCommands(), [], "nothing ran with the token");
    // A push only talks to GitHub: it runs no filter, so it goes on.
    const pushed = await fixture.run("git", ["push", "origin", "HEAD:main"]);
    assert.equal(pushed.ok, true, pushed.stderr || pushed.error);

    fixture.calls.length = 0;
    await git(source, ["config", "core.alternateRefsCommand", "cat"]);
    await assert.rejects(fixture.run("git", ["push", "origin", "HEAD:main"]), { code: REFUSED });
    assert.deepEqual(tokenCommands(), []);
  });
});

test("Save's commands without the token run as before, with no config read and nothing added", async () => {
  const calls = [];
  const context = { mode: "managed-git", remoteUrl: "/srv/canonical.git", sessionId: "plain", standaloneSourceRoot: "", worktreePath: "/srv/s" };
  const result = await saveCommand(async (request) => {
    calls.push(request);
    return { exitCode: 0, ok: true, stdout: "" };
  }, context, "git", ["push", "origin", "main"], { env: { GIT_INDEX_FILE: "/tmp/index" } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].env, { GIT_INDEX_FILE: "/tmp/index" });
});
