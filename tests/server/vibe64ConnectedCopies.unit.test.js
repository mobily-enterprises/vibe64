import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { pathExists } from "@local/vibe64-core/server/core";
import {
  recordSessionConnectedCopyCommits,
  serializeSessionConnectedCopies,
  sessionConnectedCopies
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  checkConnectedCopies,
  inspectConnectedCopies,
  prepareConnectedCopies,
  recoverConnectedCopySaves,
  recoverConnectedCopyUpdate,
  saveConnectedCopies,
  updateConnectedCopies
} from "../../packages/vibe64-terminals/src/server/sessionConnectedCopies.js";
import { connectedCopyExecution } from "../../packages/vibe64-terminals/src/server/serviceSessionConnectedCopies.js";
import { createServiceSessionWork } from "../../packages/vibe64-terminals/src/server/serviceSessionWork.js";
import { createServiceSessionWorkInspection } from "../../packages/vibe64-terminals/src/server/serviceSessionWorkInspection.js";
import { createServiceWorkspacePreparation } from "../../packages/vibe64-terminals/src/server/serviceWorkspacePreparation.js";
import { createWritesWhileAssistantWorks } from "../../packages/vibe64-terminals/src/server/writesWhileAssistantWorks.js";
import { endChildInput } from "./childInputTestHelpers.js";

// Every copy's GitHub URL reaches a local bare repository through Git's own
// URL rewriting, so the engine runs exactly as it does against GitHub.
const execFileAsync = promisify(execFile);
const IDENTITY = {
  GIT_AUTHOR_EMAIL: "vibe64@example.test",
  GIT_AUTHOR_NAME: "Vibe64 Test",
  GIT_COMMITTER_EMAIL: "vibe64@example.test",
  GIT_COMMITTER_NAME: "Vibe64 Test"
};
const SESSION_ID = "s1";

async function git(cwd, args) {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  return String(result.stdout || "").trim();
}

function commandRunner(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: { ...process.env, ...IDENTITY, ...(request.env || {}) }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({ code: "git_failed", error: error.message, ok: false, output: stderr, stderr, stdout }));
    child.once("close", (code) => resolve({ ...(code === 0 ? {} : { code: "git_failed" }), ok: code === 0, output: stdout, stderr, stdout }));
    endChildInput(child, request.input ?? undefined);
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-connected-copies-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const githubConfig = path.join(root, "github.gitconfig");
  const plainConfig = path.join(root, "plain.gitconfig");
  await writeFile(githubConfig, `[url "${path.join(root, "github")}/"]\n\tinsteadOf = https://github.com/\n`);
  await writeFile(plainConfig, "");
  const runnerWith = (config) => (requests = null) => (request = {}) => {
    requests?.push(request);
    return commandRunner({ ...request, env: { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", ...(request.env || {}) } });
  };
  const source = path.join(root, "sessions", "active", SESSION_ID, "source");
  await mkdir(source, { recursive: true });
  const session = {
    metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" },
    sessionId: SESSION_ID,
    sourcePath: source
  };
  const store = {
    mutateSession: (_sessionId, operation) => operation(),
    readMetadataValue: async (_sessionId, name) => session.metadata[name] || "",
    writeMetadataValue: async (_sessionId, name, value) => { session.metadata[name] = value; }
  };
  const github = runnerWith(githubConfig);
  return {
    connectedRoot: path.join(path.dirname(source), "connected"),
    copies: () => sessionConnectedCopies(session),
    executionFor: async () => ({ commandOptions: {}, runCommand: github() }),
    github,
    plain: runnerWith(plainConfig)(),
    project: { ownerUserKey: "owner", slug: "project" },
    recordCommits: (commits) => recordSessionConnectedCopyCommits(store, SESSION_ID, commits),
    root,
    session,
    store,
    writeCopies: async (copies) => { session.metadata.connected_copies = serializeSessionConnectedCopies(copies); }
  };
}

/** A GitHub repository `example/<name>` with one commit on its default branch, and a seed clone for peers. */
async function githubRepository(f, name, { branch = "main" } = {}) {
  const bare = path.join(f.root, "github", "example", `${name}.git`);
  const seed = path.join(f.root, "seeds", name);
  await git(f.root, ["init", "--bare", `--initial-branch=${branch}`, bare]);
  await git(f.root, ["init", `--initial-branch=${branch}`, seed]);
  await git(seed, ["remote", "add", "origin", bare]);
  await writeFile(path.join(seed, `${name}.txt`), "initial\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "initial"]);
  await git(seed, ["push", "origin", `HEAD:${branch}`]);
  return { bare, base: await git(seed, ["rev-parse", "HEAD"]), branch, name, seed };
}

/** Someone else's saved work on the repository's main (or another branch). */
async function pushPeer(repository, file, content, ref = repository.branch) {
  await writeFile(path.join(repository.seed, file), content);
  await git(repository.seed, ["add", file]);
  await git(repository.seed, ["commit", "-m", `peer ${file}`]);
  await git(repository.seed, ["push", "origin", `HEAD:${ref}`]);
  return git(repository.seed, ["rev-parse", "HEAD"]);
}

function remoteMain(repository) {
  return git(repository.bare, ["rev-parse", `refs/heads/${repository.branch}`]);
}

function prepare(f, names, { mirrorFor, requests = null } = {}) {
  return prepareConnectedCopies({
    commandOptions: { runCommand: f.github(requests) },
    connections: names.map(name => ({ fullName: `example/${name}` })),
    mirrorFor,
    ownRepository: "example/project",
    runCommand: f.plain,
    session: f.session,
    writeCopies: f.writeCopies
  });
}

function copyPath(f, name) {
  return path.join(f.connectedRoot, name);
}

async function commitInCopy(f, name, file, content) {
  await writeFile(path.join(copyPath(f, name), file), content);
  await git(copyPath(f, name), ["add", file]);
  await git(copyPath(f, name), ["commit", "-m", `session ${file}`]);
  return git(copyPath(f, name), ["rev-parse", "HEAD"]);
}

function save(f, { beforePush, events = [], executionFor = f.executionFor, recordCommits = f.recordCommits } = {}) {
  return saveConnectedCopies({
    beforePush: async () => {
      events.push("beforePush");
      await beforePush?.();
    },
    copies: f.copies(),
    derivedArtifactPaths: [],
    executionFor,
    nameSave: async (_prepared, copy) => `Save ${copy.name}`,
    onProgress: async ({ message }) => { events.push(message); },
    operationId: "save-1",
    project: f.project,
    recordCommits: async (commits) => {
      events.push(`record ${Object.keys(commits).join(",")}`);
      await recordCommits(commits);
    },
    session: f.session
  });
}

function update(f, input = {}) {
  return updateConnectedCopies({
    copies: f.copies(),
    derivedArtifactPaths: [],
    executionFor: f.executionFor,
    operationId: "update-1",
    project: f.project,
    recordCommits: f.recordCommits,
    session: f.session,
    ...input
  });
}

/**
 * This session's own repository `example/project`, cloned as its source, and the Save and Update
 * service over it and its copies. Every Git command of the service goes through the fixture's GitHub.
 */
async function sessionService(f, { invalidateWorkspaceSetup = async () => {}, requirePullRequest = false, workspacePreparation = null } = {}) {
  const own = await githubRepository(f, "project");
  await git(f.root, ["clone", own.bare, f.session.sourcePath]);
  await git(f.session.sourcePath, ["checkout", "-B", `vibe64/session/${SESSION_ID}`]);
  Object.assign(f.session.metadata, {
    base_commit: own.base,
    canonical_commit: own.base,
    repository_mode: "github",
    source_remote_url: "https://github.com/example/project.git"
  });
  const github = { cloneUrl: "https://github.com/example/project.git", fullName: "example/project" };
  const projectRecord = {
    githubMirrorOptional: true,
    githubMirrorPath: "",
    githubRepository: github,
    ownerUserKey: "owner",
    repository: { defaultBranch: "main", github, mode: "github" },
    repositoryMode: "github",
    slug: "project"
  };
  const runtime = { getSessionWithoutSource: async () => f.session, store: f.store };
  const project = {
    readCurrentProject: async () => projectRecord,
    readRepositoryWorkflow: async () => ({ requirePullRequest }),
    runProjectSourceExclusive: (operation) => operation()
  };
  const sessionAccess = {
    runMainAgentWrite: (_sessionId, _options, operation) => operation({ runtime, session: f.session }),
    sessionContext: async () => ({ runtime, session: f.session })
  };
  const codexGitCommand = { sessionWorkSaveContext: async () => ({ commandOptions: {}, runCommand: f.github() }) };
  const work = createServiceSessionWork({
    agentConversations: {},
    codexGitCommand,
    env: {},
    logger: { error() {}, info() {}, warn() {} },
    project,
    sessionAccess,
    sessionAgent: {},
    state: { lifecycle: { closing: false }, writesWhileAssistantWorks: createWritesWhileAssistantWorks() },
    workspacePreparation: workspacePreparation || { invalidateWorkspaceSetup, waitForRunningPreparation: async () => false },
    workspaceSetup: { isRunning: () => false }
  });
  return {
    destinationReview: { branch: "main", mode: "github", repository: "example/project", sessionId: SESSION_ID },
    inspection: createServiceSessionWorkInspection({ codexGitCommand, env: {}, project, sessionAccess, sessionWork: work }),
    own,
    work
  };
}

test("Prepare copies each listed repository from its default branch, through its mirror when one matches, and keeps no dependency on the mirror", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools", { branch: "trunk" });
  const mirror = async (repository, origin) => {
    const mirrorPath = path.join(f.root, "mirrors", repository.name, "repository.git");
    await mkdir(path.dirname(mirrorPath), { recursive: true });
    await git(f.root, ["clone", "--mirror", repository.bare, mirrorPath]);
    await git(f.root, ["--git-dir", mirrorPath, "remote", "set-url", "origin", origin]);
    return { mirrorPath, remoteUrl: `https://github.com/example/${repository.name}.git` };
  };
  const mirrors = {
    "example/library": await mirror(library, "https://github.com/example/library.git"),
    // A mirror of something else is never used.
    "example/tools": await mirror(tools, "https://github.com/example/elsewhere.git")
  };
  const requests = [];

  const prepared = await prepare(f, ["library", "tools"], { mirrorFor: async (fullName) => mirrors[fullName], requests });

  assert.deepEqual(prepared.lines, [
    `[Connected] library copied at ${library.base.slice(0, 12)}.`,
    `[Connected] tools copied at ${tools.base.slice(0, 12)}.`
  ]);
  assert.deepEqual(f.copies(), [
    { name: "library", repository: "example/library", branch: "main", path: copyPath(f, "library"), baseCommit: library.base, canonicalCommit: library.base },
    { name: "tools", repository: "example/tools", branch: "trunk", path: copyPath(f, "tools"), baseCommit: tools.base, canonicalCommit: tools.base }
  ]);
  const clones = requests.filter(request => request.args?.includes("clone"));
  assert.equal(clones.length, 2);
  assert.ok(clones[0].args.includes("--reference") && clones[0].args.includes(mirrors["example/library"].mirrorPath));
  assert.equal(clones[1].args.includes("--reference"), false);

  await rm(path.join(f.root, "mirrors"), { force: true, recursive: true });
  for (const [copy, repository] of [[copyPath(f, "library"), library], [copyPath(f, "tools"), tools]]) {
    assert.equal(await pathExists(path.join(copy, ".git", "objects", "info", "alternates")), false);
    await git(copy, ["fsck", "--connectivity-only", "--no-dangling"]);
    assert.equal(await git(copy, ["rev-parse", "HEAD"]), repository.base);
    assert.equal(await git(copy, ["branch", "--show-current"]), `vibe64/${SESSION_ID}`);
    assert.equal(await git(copy, ["branch", "--list", repository.branch]), "");
    assert.equal(await git(copy, ["config", "--get", "remote.origin.url"]), `https://github.com/example/${repository.name}.git`);
  }

  // Prepare again: existing copies are never fetched or replaced.
  requests.length = 0;
  await pushPeer(library, "later.txt", "later\n");
  assert.deepEqual((await prepare(f, ["library", "tools"], { requests })).lines, [
    `[Connected] library ready at ${library.base.slice(0, 12)}.`,
    `[Connected] tools ready at ${tools.base.slice(0, 12)}.`
  ]);
  assert.equal(requests.length, 0);
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), library.base);

  // A copy no longer listed goes when it holds no work, and stays when it does.
  assert.deepEqual((await prepare(f, ["library"])).lines, [
    `[Connected] library ready at ${library.base.slice(0, 12)}.`,
    "[Connected] tools removed; it is no longer listed."
  ]);
  assert.equal(await pathExists(copyPath(f, "tools")), false);
  await writeFile(path.join(copyPath(f, "library"), "notes.md"), "unsaved\n");
  assert.deepEqual((await prepare(f, [])).lines, [
    "[Connected] library kept: it is no longer listed but has unsaved work. Save it, then prepare again."
  ]);
  assert.deepEqual(f.copies().map(copy => copy.name), ["library"]);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "notes.md"), "utf8"), "unsaved\n");
});

test("Prepare refuses this project's own repository and a folder it did not record", async (t) => {
  const f = await fixture(t);
  await githubRepository(f, "library");
  await assert.rejects(prepare(f, ["project"]), (error) => {
    assert.equal(error.code, "vibe64_connected_source_self_reference");
    assert.match(error.message, /^Connected repository project: It is this project's own repository/u);
    return true;
  });
  await mkdir(path.join(copyPath(f, "library"), "stray"), { recursive: true });
  await assert.rejects(prepare(f, ["library"]), { code: "vibe64_connected_copy_path_exists" });
  assert.equal(await pathExists(path.join(copyPath(f, "library"), "stray")), true);
  assert.deepEqual(f.copies(), []);
});

test("Update brings every copy onto its main; a copy that conflicts stays exactly as it was while the others update", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  const docs = await githubRepository(f, "docs");
  await prepare(f, ["library", "tools", "docs"]);
  const librarySession = await commitInCopy(f, "library", "library.txt", "session\n");
  await commitInCopy(f, "tools", "session.txt", "session\n");
  await pushPeer(library, "library.txt", "peer\n");
  const toolsPeer = await pushPeer(tools, "peer.txt", "peer\n");

  // The update check sees the copies whose main moved.
  const checks = await checkConnectedCopies({
    copies: f.copies(), executionFor: f.executionFor, operationId: "check-1", project: f.project, session: f.session
  });
  assert.deepEqual(checks.map(check => [check.name, check.updateAvailable]), [["library", true], ["tools", true], ["docs", false]]);

  const results = await update(f);

  assert.deepEqual(results.map(result => [result.name, result.status]), [["library", "failed"], ["tools", "updated"], ["docs", "already_current"]]);
  assert.equal(results[0].code, "vibe64_session_update_conflict");
  assert.deepEqual(results[0].conflictPaths, ["../connected/library/library.txt"]);
  assert.match(results[0].line, /^\[Connected\] library was not updated and is unchanged: /u);
  assert.equal(results[1].line, `[Connected] tools updated to ${toolsPeer.slice(0, 12)}.`);
  assert.equal(results[2].line, "[Connected] docs was already current.");

  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), librarySession);
  assert.equal(await git(copyPath(f, "library"), ["status", "--porcelain"]), "");
  assert.equal(await readFile(path.join(copyPath(f, "library"), "library.txt"), "utf8"), "session\n");
  // Update moves the copy onto its main and keeps the session's work on top, unsaved.
  assert.equal(await git(copyPath(f, "tools"), ["rev-parse", "HEAD"]), toolsPeer);
  assert.match(await git(copyPath(f, "tools"), ["status", "--porcelain"]), /session\.txt/u);
  assert.equal(await readFile(path.join(copyPath(f, "tools"), "peer.txt"), "utf8"), "peer\n");
  assert.equal(await readFile(path.join(copyPath(f, "tools"), "session.txt"), "utf8"), "session\n");
  assert.equal(await git(copyPath(f, "docs"), ["rev-parse", "HEAD"]), docs.base);
  const recorded = Object.fromEntries(f.copies().map(copy => [copy.name, copy.canonicalCommit]));
  assert.deepEqual(recorded, { library: library.base, tools: toolsPeer, docs: docs.base });
});

test("Save refuses before any push while a copy is behind its main, even a copy with nothing to save", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  await prepare(f, ["library", "tools"]);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  const toolsPeer = await pushPeer(tools, "peer.txt", "peer\n");
  const events = [];

  await assert.rejects(save(f, { events }), (error) => {
    assert.equal(error.code, "vibe64_session_save_update_required");
    assert.equal(error.details.connectedRepository, "tools");
    assert.equal(error.details.updateRequired, true);
    assert.match(error.message, /^tools has newer saved work\. Update this session/u);
    return true;
  });
  assert.deepEqual(events, []);
  assert.equal(await remoteMain(library), library.base);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "work.txt"), "utf8"), "library work\n");
  assert.deepEqual((await inspectConnectedCopies({
    copies: f.copies(), project: f.project, runCommand: f.github(), session: f.session
  })).map(copy => [copy.name, copy.unsaved, copy.behind]), [["library", true, 0], ["tools", false, 1]]);

  // Control: once the copy is current, the same Save goes ahead and saves only the copy with work.
  assert.equal((await update(f)).find(result => result.name === "tools").canonicalCommit, toolsPeer);
  const saved = await save(f, { events });
  assert.deepEqual(saved.map(result => result.name), ["library"]);
  assert.equal(events[0], "beforePush");
  assert.equal(await remoteMain(library), saved[0].saveCommit);
  assert.equal(await remoteMain(tools), toolsPeer);
});

test("Save pushes each copy in order and records it before the next; the session's own check runs first and a refusal stops it", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  await prepare(f, ["library", "tools"]);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  await commitInCopy(f, "tools", "work.txt", "tools work\n");

  // The session's own repository behind its main refuses Save before any copy is pushed.
  const ownBehind = Object.assign(new Error("The saved branch has changed."), { code: "vibe64_session_save_update_required" });
  await assert.rejects(save(f, { beforePush: () => { throw ownBehind; } }), ownBehind);
  assert.equal(await remoteMain(library), library.base);
  assert.equal(await remoteMain(tools), tools.base);

  const events = [];
  const saved = await save(f, { events });

  assert.deepEqual(saved.map(result => result.name), ["library", "tools"]);
  const [librarySave, toolsSave] = saved.map(result => result.saveCommit);
  assert.deepEqual(events, [
    "beforePush",
    "Saving library.",
    "record library",
    `[Connected] library saved at ${librarySave.slice(0, 12)}.`,
    "Saving tools.",
    "record tools",
    `[Connected] tools saved at ${toolsSave.slice(0, 12)}.`
  ]);
  assert.equal(await remoteMain(library), librarySave);
  assert.equal(await remoteMain(tools), toolsSave);
  assert.equal(await git(library.bare, ["show", `${librarySave}:work.txt`]), "library work");
  assert.deepEqual(f.copies().map(copy => [copy.name, copy.canonicalCommit]), [["library", librarySave], ["tools", toolsSave]]);
  assert.equal(await git(copyPath(f, "library"), ["status", "--porcelain"]), "");
});

test("a copy's push refused because its main moved becomes Update first and stops Save before the next copy", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  await prepare(f, ["library", "tools"]);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  await writeFile(path.join(copyPath(f, "tools"), "work.txt"), "tools work\n");
  // Someone saves to library's main while this Save pushes: its push is refused once.
  const peer = await pushPeer(library, "peer.txt", "peer\n", "refs/heads/peer");
  const hook = path.join(library.bare, "hooks", "pre-receive");
  await writeFile(hook, [
    "#!/bin/sh",
    "rm -f \"$0\"",
    `env -u GIT_QUARANTINE_PATH -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git update-ref refs/heads/main ${peer}`,
    "echo 'refused: main moved' >&2",
    "exit 1",
    ""
  ].join("\n"), { mode: 0o755 });
  const events = [];

  await assert.rejects(save(f, { events }), (error) => {
    assert.equal(error.code, "vibe64_session_save_update_required");
    assert.equal(error.details.connectedRepository, "library");
    assert.match(error.message, /^library has newer saved work\. Update this session/u);
    return true;
  });
  assert.equal(await pathExists(hook), false, "the push reached the repository");
  assert.equal(await remoteMain(library), peer);
  assert.equal(await remoteMain(tools), tools.base);
  assert.deepEqual(events, ["beforePush", "Saving library."]);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "work.txt"), "utf8"), "library work\n");
  assert.deepEqual(f.copies().map(copy => copy.canonicalCommit), [library.base, tools.base]);
});

test("Save recovery records a copy whose push landed before Save could record it, and leaves a copy that Save never pushed", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  await prepare(f, ["library", "tools"]);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  await writeFile(path.join(copyPath(f, "tools"), "work.txt"), "tools work\n");

  await assert.rejects(save(f, { recordCommits: async () => { throw new Error("simulated service restart"); } }), /simulated service restart/u);
  const pushed = await remoteMain(library);
  assert.notEqual(pushed, library.base);
  assert.equal(await remoteMain(tools), tools.base);
  assert.deepEqual(f.copies().map(copy => copy.canonicalCommit), [library.base, tools.base]);

  const recover = (operationId) => recoverConnectedCopySaves({
    copies: f.copies(), executionFor: f.executionFor, operationId, project: f.project, recordCommits: f.recordCommits, session: f.session
  });
  assert.deepEqual(await recover(""), []);
  assert.deepEqual(await recover("save-1"), [{ name: "library", saveCommit: pushed }]);
  assert.deepEqual(f.copies().map(copy => [copy.name, copy.baseCommit, copy.canonicalCommit]), [
    ["library", pushed, pushed],
    ["tools", tools.base, tools.base]
  ]);
  assert.equal(await remoteMain(library), pushed);
  assert.equal(await remoteMain(tools), tools.base);
  assert.equal(await readFile(path.join(copyPath(f, "tools"), "work.txt"), "utf8"), "tools work\n");
  // The recovered Save is retired: recovering again finds nothing to record.
  assert.deepEqual(await recover("save-1"), []);
});

test("a copy whose Git commands cannot run names its repository once, in Save and in Update", async (t) => {
  const f = await fixture(t);
  await githubRepository(f, "library");
  await prepare(f, ["library"]);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  const codexGitCommand = {
    sessionWorkSaveContext: async () => ({ code: "vibe64_test_actor_unavailable", error: "spawn gh ENOENT", ok: false })
  };
  const executionFor = (copy) => connectedCopyExecution({ codexGitCommand, copy, env: {}, session: f.session });

  await assert.rejects(save(f, { executionFor }), { code: "vibe64_test_actor_unavailable", message: "Connected repository library: spawn gh ENOENT" });
  const [updated] = await update(f, { executionFor });
  assert.equal(updated.line, "[Connected] library was not updated and is unchanged: spawn gh ENOENT");
});

test("a copy keeps derived artifacts only when it is itself a Genesis project", async (t) => {
  const f = await fixture(t);
  await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  await mkdir(path.join(tools.seed, "genesis"));
  await pushPeer(tools, "genesis/blueprint.md", "# Tools\n");
  await prepare(f, ["library", "tools"]);
  for (const name of ["library", "tools"]) await writeFile(path.join(copyPath(f, name), "derived.json"), "{}\n");

  const inspected = await inspectConnectedCopies({
    copies: f.copies(), derivedArtifactPaths: ["derived.json"], project: f.project, runCommand: f.github(), session: f.session
  });

  // A plain repository has no derived artifacts: the file is its work. The Genesis copy regenerates it.
  assert.deepEqual(inspected.map(copy => [copy.name, copy.unsaved]), [["library", true], ["tools", false]]);
});

test("a copy that conflicts on Update reports its conflict for review, named by its repository, and its reviewed repair resumes in that copy only", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tools = await githubRepository(f, "tools");
  await prepare(f, ["library", "tools"]);
  const librarySession = await commitInCopy(f, "library", "library.txt", "session\n");
  const peer = await pushPeer(library, "library.txt", "peer\n");
  const progress = [];

  const [conflicted, current] = await update(f, { onProgress: async (entry) => { progress.push(entry); } });

  assert.equal(current.status, "already_current");
  assert.equal(conflicted.code, "vibe64_session_update_conflict");
  assert.deepEqual(conflicted.conflictPaths, ["../connected/library/library.txt"]);
  assert.equal(conflicted.error, "1 file in connected repository library needs review before this session can update: " +
    "../connected/library/library.txt. Resolve it manually or with AI, then use Review resolved conflicts to apply Update. " +
    "Fix it with AI can help with the repair.");
  assert.equal(conflicted.conflictRecovery.connectedRepository, "library");
  assert.deepEqual(conflicted.conflictRecovery.conflictPaths, conflicted.conflictPaths);
  assert.ok(conflicted.conflictRecovery.reviewId);
  assert.deepEqual(progress.map(entry => [entry.stage, entry.connectedUpdate]), [
    ["connected-failed", null],
    ["connected-updated", null]
  ]);

  // The person or the AI resolves the file in the copy, then Update applies the reviewed resolution.
  await writeFile(path.join(copyPath(f, "library"), "library.txt"), "peer and session\n");
  const [repaired] = await update(f, {
    conflictRecovery: conflicted.conflictRecovery,
    operationId: "update-2",
    reviewedConflictId: conflicted.conflictRecovery.reviewId
  });

  assert.equal(repaired.status, "updated");
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), peer);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "library.txt"), "utf8"), "peer and session\n");
  assert.notEqual(peer, librarySession);
  assert.equal(f.copies().find(copy => copy.name === "library").canonicalCommit, peer);
  assert.equal(await remoteMain(tools), tools.base);
});

test("a copy's Update interrupted after it was prepared recovers from the update it reported, as the session's own does", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "session work\n");
  const peer = await pushPeer(library, "peer.txt", "peer\n");
  const reported = [];

  // Vibe64 stops just before the prepared update changes the copy.
  const [stopped] = await update(f, {
    beforeSourceChange: async () => { throw new Error("simulated service restart"); },
    onProgress: async (entry) => { if (entry.connectedUpdate) reported.push(entry.connectedUpdate); }
  });

  assert.equal(stopped.status, "failed");
  assert.equal(reported.length, 1);
  assert.equal(reported[0].name, "library");
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), library.base);
  assert.equal(f.copies()[0].canonicalCommit, library.base);

  const recovered = await recoverConnectedCopyUpdate({
    connectedUpdate: reported[0],
    copies: f.copies(),
    executionFor: f.executionFor,
    project: f.project,
    recordCommits: f.recordCommits,
    session: f.session
  });

  assert.deepEqual(recovered, { canonicalCommit: peer, line: `[Connected] library updated to ${peer.slice(0, 12)}.`, name: "library" });
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), peer);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "peer.txt"), "utf8"), "peer\n");
  assert.equal(await readFile(path.join(copyPath(f, "library"), "work.txt"), "utf8"), "session work\n");
  assert.deepEqual([f.copies()[0].baseCommit, f.copies()[0].canonicalCommit], [peer, peer]);
});

test("Save of copies alone pushes them without the session's own pull request rule or behind check, and leaves its own repository alone", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const service = await sessionService(f, { requirePullRequest: true });
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  // The session's own main moved, but the session has nothing of its own to save.
  const ownPeer = await pushPeer(service.own, "peer.txt", "peer\n");

  const saved = await service.work.saveSessionWork(SESSION_ID, { destinationReview: service.destinationReview, operationId: "save-1" });

  assert.equal(saved.status, "saved");
  assert.equal(saved.saveCommit, undefined);
  assert.deepEqual(saved.connected.map(copy => copy.name), ["library"]);
  assert.equal(await remoteMain(library), saved.connected[0].saveCommit);
  assert.equal(await git(library.bare, ["show", `${saved.connected[0].saveCommit}:work.txt`]), "library work");
  assert.equal(await remoteMain(service.own), ownPeer);
  assert.equal(f.session.metadata.canonical_commit, service.own.base);
});

test("Save refuses before any copy is pushed while the session's own repository, which has work, is behind its main", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const service = await sessionService(f);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  await writeFile(path.join(f.session.sourcePath, "own.txt"), "own work\n");
  const ownPeer = await pushPeer(service.own, "peer.txt", "peer\n");

  await assert.rejects(
    service.work.saveSessionWork(SESSION_ID, { destinationReview: service.destinationReview, operationId: "save-1" }),
    (error) => {
      assert.equal(error.code, "vibe64_session_save_update_required");
      assert.match(error.message, /^The saved branch has changed\. Update this session/u);
      return true;
    }
  );
  assert.equal(await remoteMain(library), library.base);
  assert.equal(await remoteMain(service.own), ownPeer);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "work.txt"), "utf8"), "library work\n");
});

test("an interrupted Save of copies alone recovers as saved once every copy it pushed is recorded", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const service = await sessionService(f);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  const write = f.store.writeMetadataValue;
  // Vibe64 stops after the copy's push, before Save records it.
  f.store.writeMetadataValue = async () => { throw new Error("simulated service restart"); };
  await assert.rejects(
    service.work.saveSessionWork(SESSION_ID, { destinationReview: service.destinationReview, operationId: "save-1" }),
    /simulated service restart/u
  );
  f.store.writeMetadataValue = write;
  const pushed = await remoteMain(library);
  assert.notEqual(pushed, library.base);

  const recovered = await service.work.recoverSessionWorkSave(SESSION_ID, { recovery: { operationId: "save-1", status: "running" } });

  assert.equal(recovered.status, "saved");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.saveCommit, undefined);
  assert.deepEqual(recovered.connected, [{ name: "library", saveCommit: pushed }]);
  assert.equal(f.copies()[0].canonicalCommit, pushed);
  assert.equal(f.session.metadata.canonical_commit, service.own.base);
});

test("an interrupted Save of copies alone stays retryable while a copy still holds unsaved work", async (t) => {
  const f = await fixture(t);
  await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const service = await sessionService(f);
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");

  // This Save never pushed: the copy's work is still unsaved.
  await assert.rejects(
    service.work.recoverSessionWorkSave(SESSION_ID, { recovery: { operationId: "save-1", status: "running" } }),
    { code: "vibe64_session_save_interrupted_retryable" }
  );
});

test("the service routes a copy's conflict review to that copy, and failure inspection reads that copy's checkout", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const service = await sessionService(f);
  await commitInCopy(f, "library", "library.txt", "session\n");
  const peer = await pushPeer(library, "library.txt", "peer\n");

  const conflicted = await service.work.updateSessionWork(SESSION_ID, { operationId: "update-1" });
  assert.equal(conflicted.status, "already_current");
  const recovery = conflicted.connected[0].conflictRecovery;
  assert.equal(recovery.connectedRepository, "library");
  const failure = (connectedRepository) => service.inspection.inspectSessionUpdateFailure(SESSION_ID, {
    connectedRepository,
    targetCommit: recovery.canonicalCommit
  });
  assert.deepEqual([(await failure("library")).targetInHead, (await failure("library")).updateNeeded], [false, true]);
  // The session's own checkout knows nothing of the copy's main.
  assert.equal((await failure("")).updateNeeded, false);

  await writeFile(path.join(copyPath(f, "library"), "library.txt"), "peer and session\n");
  const repaired = await service.work.updateSessionWork(SESSION_ID, {
    conflictRecovery: recovery,
    operationId: "update-2",
    reviewedConflictId: recovery.reviewId
  });

  assert.equal(repaired.connected[0].status, "updated");
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), peer);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "library.txt"), "utf8"), "peer and session\n");
  assert.equal((await failure("library")).targetInHead, true);
});

test("an interrupted Update recovers the copy it was applying before the session's own repository", async (t) => {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  let stop = true;
  const service = await sessionService(f, {
    invalidateWorkspaceSetup: async () => {
      if (stop) throw new Error("simulated service restart");
    }
  });
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "session work\n");
  const peer = await pushPeer(library, "peer.txt", "peer\n");
  const reported = [];
  await service.work.updateSessionWork(SESSION_ID, {
    onProgress: async (entry) => { if (entry.connectedUpdate) reported.push(entry.connectedUpdate); },
    operationId: "update-1"
  });
  assert.equal(reported.length, 1);
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), library.base);
  stop = false;

  // The session's own repository had not started, so its part stays retryable, as it is without copies.
  await assert.rejects(
    service.work.recoverSessionWorkUpdate(SESSION_ID, { recovery: { connectedUpdate: reported.at(-1), operationId: "update-1", status: "running" } }),
    { code: "vibe64_session_update_interrupted_retryable" }
  );
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), peer);
  assert.equal(await readFile(path.join(copyPath(f, "library"), "work.txt"), "utf8"), "session work\n");
  assert.equal(f.copies()[0].canonicalCommit, peer);
});

/**
 * An Update of a session whose copy `library` has a peer's work to take, while a preparation runs: the session's
 * workspace preparation service over a runner whose run ends when `finishPreparation` is called.
 */
async function updateDuringPreparation(t, { runningPreparationWaitMs } = {}) {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const peer = await pushPeer(library, "peer.txt", "peer\n");
  const run = Promise.withResolvers();
  let running = true;
  const order = [];
  f.session.workspaceSetup = { currentLabel: "Install dependencies", status: "running" };
  const workspacePreparation = createServiceWorkspacePreparation({
    project: {},
    publishSessionChanged: {},
    restartPreviewAfterSetup: async () => ({ ok: true }),
    runningPreparationWaitMs,
    sessionAccess: { publishTerminalSessionChanged: async () => {} },
    workspaceSetup: {
      invalidate: async ({ sourceChange }) => { order.push(`required, source change: ${sourceChange}`); },
      wait: () => running ? run.promise : null
    }
  });
  const service = await sessionService(f, { workspacePreparation });
  const waiting = Promise.withResolvers();
  const progress = [];
  const finishPreparation = () => {
    order.push("preparation finished");
    running = false;
    run.resolve({ status: "succeeded" });
  };
  const update = (input = {}) => service.work.updateSessionWork(SESSION_ID, {
    onProgress: async (entry) => {
      progress.push(entry.message);
      if (entry.stage === "workspace-setup-waiting") waiting.resolve();
    },
    operationId: "update-1",
    ...input
  });
  // Resolves once the Update waits for the preparation; an Update that ends first did not wait.
  const waitingFor = (updating) => Promise.race([waiting.promise, updating.then(
    (result) => assert.fail(`Update did not wait for the running preparation: ${JSON.stringify(result)}`),
    (error) => assert.fail(`Update did not wait for the running preparation: ${error.message}`)
  )]);
  return { f, finishPreparation, library, order, peer, progress, update, waitingFor };
}

test("an Update during a running preparation waits for it, saying so, and then updates", async (t) => {
  const { f, finishPreparation, order, peer, progress, update, waitingFor } = await updateDuringPreparation(t);
  const updating = update();
  await waitingFor(updating);
  assert.deepEqual(progress, ["The workspace is being prepared (Install dependencies); waiting for it to finish."]);
  assert.deepEqual(order, [], "Update changes nothing while the preparation runs");
  finishPreparation();
  const updated = await updating;
  assert.equal(updated.connected[0].status, "updated");
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), peer);
  // Marked required only after the run ended, keeping the record of what it prepared.
  assert.deepEqual(order, ["preparation finished", "required, source change: true"]);
});

test("Cancel ends an Update that waits for a running preparation, and a preparation past the wait's bound refuses, naming it", async (t) => {
  const cancelled = await updateDuringPreparation(t);
  const controller = new AbortController();
  const updating = cancelled.update({ signal: controller.signal });
  await cancelled.waitingFor(updating);
  controller.abort();
  await assert.rejects(updating, { code: "vibe64_session_update_cancelled" });
  assert.deepEqual(cancelled.order, []);
  assert.equal(await git(copyPath(cancelled.f, "library"), ["rev-parse", "HEAD"]), cancelled.library.base);

  const stuck = await updateDuringPreparation(t, { runningPreparationWaitMs: 20 });
  await assert.rejects(stuck.update(), {
    code: "vibe64_workspace_setup_running",
    message: "The workspace is being prepared (Install dependencies). Try again when it finishes."
  });
  assert.deepEqual(stuck.order, []);
  assert.equal(await git(copyPath(stuck.f, "library"), ["rev-parse", "HEAD"]), stuck.library.base);
  stuck.finishPreparation();
});
