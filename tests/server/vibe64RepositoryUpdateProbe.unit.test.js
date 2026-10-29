import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { normalizeRepositoryUpdateCheck } from "@local/vibe64-core/shared";
import { runCaptureCommand } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import { createRepositoryUpdateWatchActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  createRepositoryUpdateProbe,
  registerRepositoryUpdateWatch
} from "../../packages/vibe64-sessions/src/server/repositoryUpdateProbe.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { Vibe64RepositoryUpdatesProvider } from "../../packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js";
import {
  REPOSITORY_UPDATES_RELEASE,
  REPOSITORY_UPDATES_WATCH
} from "../../packages/vibe64-sessions/src/shared/repositoryUpdates.js";
import { gitEnv } from "../../packages/vibe64-execution/src/server/env/gitEnv.js";
import { checkSessionUpdates, readSessionAuthorityHeads } from "../../packages/vibe64-terminals/src/server/sessionWorkUpdate.js";

const H0 = "0".repeat(40);
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const CONTRIBUTION_ID = "6f1c2b9e-0d4a-4c3e-9b7a-1f2e3d4c5b6a";

async function settle() {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

function fakeClock() {
  let time = 0;
  const timers = new Set();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const timer = { at: time + delay, callback };
      timers.add(timer);
      return timer;
    },
    clearTimer(timer) {
      timers.delete(timer);
    },
    pending: () => timers.size,
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        await settle();
        const next = [...timers].filter((timer) => timer.at <= end).sort((left, right) => left.at - right.at)[0];
        if (!next) break;
        timers.delete(next);
        time = next.at;
        next.callback();
      }
      time = end;
      await settle();
    }
  };
}

function checkedMetadata(commit) {
  return {
    base_commit: H0,
    canonical_commit: commit,
    repository_update_check: JSON.stringify(normalizeRepositoryUpdateCheck({
      ahead: 0, behind: 0, canonicalCommit: commit, sessionHead: H0
    }, "2026-10-29T00:00:00.000Z"))
  };
}

// The real sessions service and the real grouped head read, with Git, the
// clock and the ordinary update check (its fetch) faked at their boundaries.
function harness(t, projects = { alpha: 3 }) {
  const clock = fakeClock();
  const context = new AsyncLocalStorage();
  const state = new Map(Object.entries(projects).map(([slug, count]) => [slug, {
    branches: { main: H0 },
    failure: "",
    fetches: 0,
    hold: null,
    lsRemote: 0,
    sessions: new Map(Array.from({ length: count }, (_, index) => {
      const sessionId = `${slug}-${index + 1}`;
      return [sessionId, {
        agentRuns: [], metadata: checkedMetadata(H0), sessionId,
        sourcePath: `/sessions/${sessionId}`, status: "active"
      }];
    }))
  }]));
  const publications = [];
  const current = () => state.get(context.getStore());
  const projectRecord = (slug) => ({
    githubRepository: { cloneUrl: `https://github.com/acme/${slug}.git`, fullName: `acme/${slug}` },
    repository: { defaultBranch: "main", github: { cloneUrl: `https://github.com/acme/${slug}.git`, fullName: `acme/${slug}` }, mode: "github" },
    repositoryMode: "github",
    slug
  });
  async function runCommand(request) {
    const project = current();
    assert.equal(request.args[0], "ls-remote", "the probe itself only lists the authority's heads");
    assert.ok(request.timeout <= 20_000, "a hung head read cannot hold the probe past its cadence");
    project.lsRemote += 1;
    if (project.hold) await project.hold.promise;
    if (project.failure) return { ok: false, code: "vibe64_git_failed", stderr: project.failure };
    const refs = request.args.slice(3);
    return { ok: true, stdout: refs.filter((ref) => project.branches[ref.slice("refs/heads/".length)])
      .map((ref) => `${project.branches[ref.slice("refs/heads/".length)]}\t${ref}\n`).join("") };
  }
  const runtime = {
    async listSessions() { return [...current().sessions.values()].map((session) => structuredClone(session)); },
    async listSessionSummaries() { return this.listSessions(); },
    async getSession(sessionId) { return structuredClone(current().sessions.get(sessionId)); },
    store: {
      async readSessionRenewalStateRecord() { return ""; },
      async writeMetadataValue(sessionId, name, value) {
        const session = current().sessions.get(sessionId);
        session.metadata = { ...session.metadata, [name]: value };
      }
    }
  };
  const sessions = createService({
    project: {
      runInProjectContext: (slug, operation) => context.run(slug, operation),
      async createRuntime() { return runtime; },
      async readCurrentProject() { return projectRecord(context.getStore()); }
    },
    async publishSessionChanged(sessionId, event) {
      publications.push({ projectSlug: context.getStore(), sessionId, ...event });
    },
    terminals: {
      readRepositoryAuthorityHeads: ({ sessions: open }) => readSessionAuthorityHeads({
        executionFor: async () => ({ commandOptions: {}, ok: true, runCommand }),
        project: projectRecord(context.getStore()),
        sessions: open
      }),
      async checkSessionUpdates() {
        const project = current();
        project.fetches += 1;
        return { ahead: 0, behind: 1, canonicalCommit: project.branches.main, incomingVersions: [],
          reconciled: false, sessionHead: H0, updateAvailable: true };
      }
    }
  });
  const errors = [];
  const probe = createRepositoryUpdateProbe({
    clearTimer: clock.clearTimer,
    now: clock.now,
    onError: (error) => errors.push(error),
    probe: (slug, options) => sessions.probeRepositoryUpdates(slug, options),
    setTimer: clock.setTimer
  });
  t.after(() => probe.close());
  return { clock, errors, probe, publications, state };
}

test("each project lists its authority once per 30 s, whatever the number of sessions and viewers", async (t) => {
  const h = harness(t, { alpha: 3, beta: 1 });
  const alpha = h.state.get("alpha");
  const beta = h.state.get("beta");
  for (let viewer = 0; viewer < 3; viewer += 1) h.probe.watch("alpha");
  h.probe.watch("beta");
  await h.clock.advance(0);
  assert.deepEqual([alpha.lsRemote, beta.lsRemote], [1, 1]);
  await h.clock.advance(45_000);
  assert.deepEqual([alpha.lsRemote, beta.lsRemote], [2, 2]);
  // Another viewer or a starting turn does not add a probe between ticks.
  h.probe.watch("alpha");
  h.probe.wake("alpha");
  await h.clock.advance(0);
  assert.equal(alpha.lsRemote, 2);
  await h.clock.advance(255_000);
  assert.deepEqual([alpha.lsRemote, beta.lsRemote], [11, 11]);
  assert.deepEqual([alpha.fetches, beta.fetches], [0, 0], "an unchanged head is not fetched");
  assert.deepEqual(h.errors, []);
});

test("a session is fetched and rechecked only when its authority head moved", async (t) => {
  const h = harness(t);
  const alpha = h.state.get("alpha");
  h.probe.watch("alpha");
  await h.clock.advance(0);
  assert.equal(alpha.fetches, 0);
  alpha.branches.main = H1;
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 2);
  assert.equal(alpha.fetches, 3, "each session's own clone is checked once");
  assert.deepEqual(h.publications.filter((event) => event.reason === "session-repository-checked")
    .map((event) => event.sessionId).sort(), ["alpha-1", "alpha-2", "alpha-3"]);
  await h.clock.advance(90_000);
  assert.equal(alpha.lsRemote, 5);
  assert.equal(alpha.fetches, 3);
});

test("a connected contribution is rechecked when its published or integration branch moves", async (t) => {
  const h = harness(t, { alpha: 1 });
  const alpha = h.state.get("alpha");
  const published = `vibe64-incoming/${CONTRIBUTION_ID}`;
  alpha.branches[published] = H1;
  alpha.sessions.set("contribution", {
    agentRuns: [], sessionId: "contribution", sourcePath: "/sessions/contribution", status: "active",
    metadata: { ...checkedMetadata(H1), connected_contribution: JSON.stringify({
      schemaVersion: 1, id: CONTRIBUTION_ID, repository: "acme/alpha", integrationBranch: "main", baseCommit: H0
    }) }
  });
  h.probe.watch("alpha");
  await h.clock.advance(0);
  assert.equal(alpha.lsRemote, 1, "the contribution's branches share the project's one listing");
  assert.equal(alpha.fetches, 1, "a contribution is checked once when the probe first sees it");
  await h.clock.advance(30_000);
  assert.equal(alpha.fetches, 1);
  alpha.branches.main = H2;
  await h.clock.advance(30_000);
  assert.equal(alpha.fetches, 3, "the integration branch moved for both sessions");
});

test("a project that nobody watches and no agent turn uses is not probed and keeps no timer", async (t) => {
  const h = harness(t);
  const alpha = h.state.get("alpha");
  await h.clock.advance(120_000);
  h.probe.wake("alpha");
  await h.clock.advance(0);
  assert.equal(alpha.lsRemote, 0);
  assert.equal(h.clock.pending(), 0);
  await h.clock.advance(120_000);
  assert.equal(alpha.lsRemote, 0);
});

test("the probe stops after the last viewer leaves or the last agent turn ends", async (t) => {
  const h = harness(t);
  const alpha = h.state.get("alpha");
  const releases = [h.probe.watch("alpha"), h.probe.watch("alpha")];
  await h.clock.advance(0);
  releases[0]();
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 2, "one viewer still watches");
  releases[1]();
  releases[1]();
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 2, "the tick after the last viewer reads no Git");
  assert.equal(h.clock.pending(), 0);

  await h.clock.advance(60_000);
  alpha.sessions.get("alpha-2").agentRuns = [{ runId: "run-1", state: "active" }];
  h.probe.wake("alpha");
  await h.clock.advance(0);
  assert.equal(alpha.lsRemote, 3, "a running turn keeps the project in use without a viewer");
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 4);
  alpha.sessions.get("alpha-2").agentRuns = [{ runId: "run-1", state: "completed" }];
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 4);
  assert.equal(h.clock.pending(), 0);
});

test("a probe never overlaps itself and skips the tick that passes while it runs", async (t) => {
  const h = harness(t);
  const alpha = h.state.get("alpha");
  alpha.hold = Promise.withResolvers();
  h.probe.watch("alpha");
  await h.clock.advance(0);
  await h.clock.advance(35_000);
  assert.equal(alpha.lsRemote, 1);
  alpha.hold.resolve();
  alpha.hold = null;
  await h.clock.advance(24_000);
  assert.equal(alpha.lsRemote, 1);
  await h.clock.advance(1_000);
  assert.equal(alpha.lsRemote, 2, "the next probe starts on the following tick");
});

test("a failed probe is shown once, retried every 60 s, and cleared by a recheck when it recovers", async (t) => {
  const h = harness(t);
  const alpha = h.state.get("alpha");
  const failures = () => h.publications.filter((event) => event.reason === "session-repository-check-failed");
  h.probe.watch("alpha");
  await h.clock.advance(0);
  alpha.failure = "fatal: unable to access 'https://github.com/acme/alpha.git/': Could not resolve host: github.com";
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 2);
  assert.deepEqual(failures().map((event) => event.sessionId).sort(), ["alpha-1", "alpha-2", "alpha-3"]);
  assert.match(failures()[0].payload.repositoryUpdateCheckError.message, /Could not resolve host/u);
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 2, "a failure backs off to the product's 60 s limit");
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 3, "later probes still run");
  assert.equal(failures().length, 3, "the same failure is not shown again");
  alpha.failure = "";
  await h.clock.advance(60_000);
  assert.equal(alpha.lsRemote, 4);
  assert.equal(alpha.fetches, 3, "a recovered session is checked again, which clears its failure");
  await h.clock.advance(30_000);
  assert.equal(alpha.lsRemote, 5, "a successful probe returns to the 30 s cadence");
  assert.equal(alpha.fetches, 3);
});

test("a browser watch is authorized as an action and released with its connection", async () => {
  let allowed = true;
  const actions = createActionCatalogue();
  registerVibe64ActionContext(actions, {
    projectContext: { projectsRoot: "/fixture", readWorkspaceProject: async () => ({ project: { path: "/fixture/project" } }) },
    resolveUser: async () => ({ uid: 42, role: "member" }),
    authorizeProject() { if (!allowed) throw Object.assign(new Error("Denied"), { statusCode: 403 }); }
  });
  const watching = new Set();
  const probe = { watch(slug) { watching.add(slug); return () => watching.delete(slug); } };
  actions.register({ contributorId: "repository-updates", domain: "vibe64-sessions",
    actions: createRepositoryUpdateWatchActions({ probe }).map((action) => ({ ...action, surfaces: ["app"] })) });
  let connect;
  registerRepositoryUpdateWatch({ actions, realtime: { onConnection(listener) { connect = listener; return () => {}; } } });
  const socket = new EventEmitter();
  socket.connected = true;
  const close = connect({ socket, readRequest: async () => ({ params: {} }) });
  const send = (input) => new Promise((resolve) => socket.emit(REPOSITORY_UPDATES_WATCH, input, resolve));
  assert.deepEqual(await send({ watchId: "tab-1", projectSlug: "alpha" }), { ok: true });
  assert.deepEqual([...watching], ["alpha"]);
  socket.emit(REPOSITORY_UPDATES_RELEASE, { watchId: "tab-1" });
  assert.deepEqual([...watching], []);
  allowed = false;
  assert.equal((await send({ watchId: "tab-1", projectSlug: "beta" })).ok, false);
  assert.deepEqual([...watching], [], "a refused project is not watched");
  allowed = true;
  assert.deepEqual(await send({ watchId: "tab-1", projectSlug: "beta" }), { ok: true });
  assert.deepEqual(await send({ watchId: "tab-1", projectSlug: "gamma" }), { ok: true });
  assert.deepEqual([...watching], ["gamma"], "the same browser watch moves to its new project");
  close();
  assert.deepEqual([...watching], [], "a closed connection watches nothing");
});

// Hosted Git runs through the managed gateway: the probe's head read must be
// the same daemon job, with the same user token and safe directories, as the
// update check it replaces.
test("the probe reads heads through the same gateway request as the update check", async () => {
  const requests = [];
  async function runCommand(request) {
    requests.push(request);
    return request.command === "git" ? { ok: true, stdout: `${H1}\trefs/heads/main\n` } : { ok: false, stderr: "stopped" };
  }
  const commandOptions = { gitAuthToken: "user-token", gitTransport: "github-token", purpose: "github", userKey: "alice" };
  const github = { cloneUrl: "https://github.com/acme/alpha.git", fullName: "acme/alpha" };
  const project = { githubRepository: github, repository: { defaultBranch: "main", github, mode: "github" }, repositoryMode: "github", slug: "alpha" };
  const session = { metadata: { base_commit: H0 }, sessionId: "alpha-1", sourcePath: "/sessions/alpha-1", status: "active" };
  const heads = await readSessionAuthorityHeads({ executionFor: async () => ({ commandOptions, ok: true, runCommand }), project, sessions: [session] });
  assert.deepEqual(heads.get("alpha-1"), { head: H1 });
  await assert.rejects(checkSessionUpdates({ commandOptions, project, runCommand, session }));
  const [probe, check] = requests;
  assert.deepEqual([probe.command, check.command], ["git", "node"]);
  const gateway = ({ actor, cwd, envPolicy, execution, gitAuthToken, gitTransport, mode, project: target, purpose, session: owner, userKey }) => ({
    actor, cwd, envPolicy, execution: { ...execution, operationId: undefined }, gitAuthToken, gitTransport, mode, project: target, purpose, session: owner, userKey
  });
  assert.deepEqual(gateway(probe), gateway(check));
  assert.equal(probe.actor, "daemon");
  assert.equal(probe.purpose, "github");
  assert.ok(probe.gitSafeDirectories.includes("/sessions/alpha-1"));
  assert.deepEqual(probe.gitSafeDirectories, check.gitSafeDirectories.filter((root) => probe.gitSafeDirectories.includes(root)),
    "the head read trusts the session's directories and nothing the update check does not");
  assert.deepEqual(probe.allowedRoots, probe.gitSafeDirectories);
  const env = gitEnv({ request: probe });
  assert.equal(env.VIBE64_GIT_AUTH_TOKEN, "user-token", "the head read authenticates with the signed-in user's token");
  assert.ok(Object.entries(env).some(([key, value]) => key.startsWith("GIT_CONFIG_VALUE_") && value === "/sessions/alpha-1"),
    "the session worktree is a Git safe directory for the daemon");
});

test("a starting agent turn wakes its project's probe", async () => {
  const listeners = [];
  const probes = [];
  const { repositoryUpdates } = await Vibe64RepositoryUpdatesProvider.setup({
    actionCatalogue: createActionCatalogue(),
    events: { register: (listener) => listeners.push(listener) },
    realtime: { onConnection() { return () => {}; } },
    sessions: { async probeRepositoryUpdates(slug, { watched }) { probes.push([slug, watched]); return { failed: false, inUse: false }; } }
  }, {});
  try {
    const [turnActive] = listeners;
    const change = (reason) => ({ entity: "session", realtime: { payload: { projectSlug: "alpha", reason } } });
    assert.equal(turnActive.matches(change("session-repository-checked")), false);
    for (const reason of ["claude-stream-turn-active", "codex-app-server-turn-active", "opencode-server-turn-active"]) {
      assert.equal(turnActive.matches(change(reason)), true, reason);
    }
    turnActive.handle(change("codex-app-server-turn-active"));
    // This probe runs on real timers, which fire no sooner than 1 ms.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(probes, [["alpha", false]]);
  } finally {
    repositoryUpdates.close();
  }
});

test("the head read lists each local or managed authority once with real Git", async (t) => {
  const exec = promisify(execFile);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Probe Test", GIT_AUTHOR_EMAIL: "probe@example.test",
    GIT_COMMITTER_NAME: "Probe Test", GIT_COMMITTER_EMAIL: "probe@example.test" };
  const git = async (cwd, ...args) => (await exec("git", args, { cwd, env })).stdout.trim();
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-probe-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const folder = path.join(root, "project");
  await git(root, "init", "--initial-branch=trunk", folder);
  await writeFile(path.join(folder, "base.txt"), "base\n");
  await git(folder, "add", ".");
  await git(folder, "commit", "-m", "base");
  const bare = path.join(root, "canonical.git");
  await git(root, "clone", "--bare", folder, bare);
  const listings = [];
  const runCommand = (request) => {
    if (request.args[0] === "ls-remote") listings.push(request.args[2]);
    return runCaptureCommand(request.command, request.args, { cwd: request.cwd, env, timeout: 10_000 });
  };
  const sessions = [];
  for (const name of ["one", "two"]) {
    const sourcePath = path.join(root, name);
    await git(root, "clone", folder, sourcePath);
    sessions.push({ metadata: { base_commit: await git(sourcePath, "rev-parse", "HEAD") }, sessionId: name, sourcePath });
  }
  const read = (project) => readSessionAuthorityHeads({
    executionFor: async () => ({ commandOptions: {}, ok: true, runCommand }), project, sessions
  });
  const local = { repository: { defaultBranch: "trunk", mode: "local_source" }, repositoryMode: "local_source", slug: "local", sourceRoot: folder };
  const head = await git(folder, "rev-parse", "HEAD");
  assert.deepEqual([...await read(local)], [["one", { head }], ["two", { head }]]);
  await writeFile(path.join(folder, "next.txt"), "next\n");
  await git(folder, "add", ".");
  await git(folder, "commit", "-m", "next");
  const moved = await git(folder, "rev-parse", "HEAD");
  assert.equal((await read(local)).get("one").head, moved, "a commit in the project folder moves its head");
  const managed = { canonicalRepositoryPath: bare, repository: { defaultBranch: "trunk", mode: "managed_git" }, repositoryMode: "managed_git", slug: "managed" };
  assert.deepEqual([...await read(managed)], [["one", { head }], ["two", { head }]]);
  const missing = { ...managed, repository: { defaultBranch: "gone", mode: "managed_git" } };
  assert.equal((await read(missing)).get("one").code, "vibe64_session_update_branch_missing");
  assert.deepEqual(listings, [folder, folder, bare, bare], "one listing per authority, however many sessions");
});

test("the head read skips an authority without a recorded Git actor and reports a refused one", async () => {
  const project = { canonicalRepositoryPath: "/repositories/alpha.git", repository: { defaultBranch: "main", mode: "managed_git" },
    repositoryMode: "managed_git", slug: "alpha" };
  const sessions = [{ metadata: { base_commit: H0 }, sessionId: "one", sourcePath: "/sessions/one" }];
  const runCommand = async () => assert.fail("no Git runs without an actor");
  const missing = await readSessionAuthorityHeads({ project, sessions, executionFor: async () => ({
    code: "vibe64_session_git_command_actor_missing", error: "No actor.", ok: false
  }) });
  assert.equal(missing.size, 0, "the session's first opened check records its actor");
  const refused = await readSessionAuthorityHeads({ project, sessions, executionFor: async () => ({
    code: "vibe64_codex_git_actor_access_denied", error: "This GitHub actor no longer has access.", ok: false, runCommand
  }) });
  assert.deepEqual(refused.get("one"), { code: "vibe64_codex_git_actor_access_denied", error: "This GitHub actor no longer has access." });
});
