import assert from "node:assert/strict";
import test from "node:test";
import { parseVibe64ProjectServicesLines } from "../../packages/vibe64-genesis/src/server/index.js";
import { createProjectServices } from "../../packages/vibe64-terminals/src/server/projectServices.js";

const service = { id: "worker", runtimeRequirements: ["nodejs"], workdir: ".", argv: ["npm", "run", "worker"] };
const context = (root = "/projects/a", source = `${root}/session-a/source`) => ({
  projectContextRoot: root, sessionSourceRoot: source, projectEnvironment: { PROJECT_VALUE: "shared" },
  runtime: { resolvePromptEnvironment: async () => ({}) }
});
function fixture(overrides = {}) {
  const calls = [];
  let alive = true;
  const manager = createProjectServices({
    inspect: async () => ({ status: "ready", services: [service] }),
    runCommand: async (request) => { calls.push(request); return { ok: true, execution: { id: `execution-${calls.length}` } }; },
    inspectExecution: async () => ({ scopeEmpty: !alive }),
    stopOwned: async (selector) => { calls.push({ stop: selector }); return { supported: true, scopeEmpty: true }; },
    ...overrides
  });
  return { manager, calls, exited: () => { alive = false; } };
}

test("project services strictly parse argv, runtime and workdir", () => {
  assert.deepEqual(parseVibe64ProjectServicesLines(['- Start `worker` with `nodejs` in `tools`: `npm` `run` `worker`']), [{ ...service, workdir: "tools" }]);
  assert.deepEqual(parseVibe64ProjectServicesLines(['- Start `worker` per session with `nodejs`: `npm` `run` `worker`']), [{ ...service, scope: "session" }]);
  assert.deepEqual(parseVibe64ProjectServicesLines(["- Nothing."]), []);
  for (const lines of [[], ['- Start `worker` with `nodejs` in `../elsewhere`: `npm`'], ['- Start `worker` with `nodejs`: npm run worker'],
    ['- Start `worker` with `nodejs`: `npm`', '- Start `worker` with `nodejs`: `npm`']]) {
    assert.throws(() => parseVibe64ProjectServicesLines(lines), { code: "VIBE64_PROJECT_SERVICES_INVALID" });
  }
});

const sessionContext = (sessionId) => ({
  ...context("/projects/a", `/projects/a/${sessionId}/source`),
  session: { sessionId, sourcePath: `/projects/a/${sessionId}/source` }
});

test("session services stay warm across output launches without sharing another session's process", async () => {
  const { manager, calls } = fixture({ inspect: async () => ({ services: [{ ...service, scope: "session" }] }) });
  await Promise.all([manager.ensure(sessionContext("a")), manager.ensure(sessionContext("b"))]);
  await manager.ensure(sessionContext("a"));
  await manager.ensure(sessionContext("b"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ execution }) => execution.sessionId), ["a", "b"]);
  assert.deepEqual(calls.map(({ cwd }) => cwd), ["/projects/a/a/source", "/projects/a/b/source"]);
  assert.equal(calls[0].execution.ownerId, calls[1].execution.ownerId);
  assert.equal(calls[0].session.sessionId, "a");
  assert.equal(calls[0].envPolicy, "session");
  assert.equal(calls[0].execution.lifecycle, "service");
  assert.equal(calls[0].timeout, undefined);
  await manager.closeSession(context(), "a");
  assert.deepEqual(calls[2].stop, { ownerId: calls[0].execution.ownerId, sessionId: "a" });
  await manager.ensure(sessionContext("b"));
  assert.equal(calls.length, 3, "closing a must not restart warm b");
  await manager.ensure(sessionContext("a"));
  assert.equal(calls.length, 4, "a may start again through ordinary session admission");
});

test("session cleanup retains shared services and cleans the exact owner after daemon replacement", async () => {
  const inspect = async () => ({ services: [service, { ...service, id: "reference", scope: "session" }] });
  const first = fixture({ inspect });
  await first.manager.ensure(sessionContext("a"));
  await first.manager.ensure(sessionContext("b"));
  assert.equal(first.calls.length, 3);
  const second = fixture({ inspect });
  await second.manager.closeSession(context(), "a");
  assert.deepEqual(second.calls[0].stop, { ownerId: first.calls[0].execution.ownerId, sessionId: "a" });
  await first.manager.closeSession(context(), "a");
  await first.manager.ensure(sessionContext("b"));
  assert.equal(first.calls.length, 4, "neither shared service nor b was restarted");
});

test("session service cannot start or clean up without session identity", async () => {
  const { manager, calls } = fixture({ inspect: async () => ({ services: [{ ...service, scope: "session" }] }) });
  await assert.rejects(manager.ensure(context()), /exact session identity/);
  await assert.rejects(manager.closeSession(context(), ""), /exact session identity/);
  assert.equal(calls.length, 0);
});

test("one session's declaration does not remove another's warm service, but scope changes are refused", async () => {
  let services = [{ ...service, scope: "session" }];
  const { manager, calls } = fixture({ inspect: async () => ({ services }) });
  await manager.ensure(sessionContext("a"));
  services = [];
  await manager.ensure(sessionContext("b"));
  await assert.rejects(manager.ensure(sessionContext("a")), /was removed/);
  services = [service];
  await assert.rejects(manager.ensure(sessionContext("b")), /changed scope/);
  assert.equal(calls.length, 1);
});

test("session close drains a racing start and blocks that session on failed cleanup", async () => {
  let release, started;
  const starting = new Promise(resolve => { started = resolve; });
  const { manager, calls } = fixture({
    inspect: async () => ({ services: [{ ...service, scope: "session" }] }),
    runCommand: async () => { started(); await new Promise(resolve => { release = resolve; }); return { ok: true, execution: { id: "racing" } }; },
    stopOwned: async selector => { calls.push({ stop: selector }); return { supported: true, scopeEmpty: false, error: "still running" }; }
  });
  const launch = manager.ensure(sessionContext("a"));
  await starting;
  const closing = manager.closeSession(context(), "a");
  const queued = manager.ensure(sessionContext("a"));
  const closeCheck = assert.rejects(closing, /still running/);
  const queuedCheck = assert.rejects(queued, /session is closing/);
  release();
  await Promise.all([launch, closeCheck, queuedCheck]);
  assert.equal(calls[0].stop.sessionId, "a");
});

test("standalone session close stops only that session's owned handles", async () => {
  const stopped = [];
  const { manager } = fixture({ inspect: async () => ({ services: [service, { ...service, id: "reference", scope: "session" }] }),
    stopOwned: async () => ({ supported: false, scopeEmpty: true }),
    stopExecution: async id => { stopped.push(id); return { scopeEmpty: true }; } });
  await manager.ensure(sessionContext("a"));
  await manager.ensure(sessionContext("b"));
  await manager.closeSession(context(), "a");
  assert.deepEqual(stopped, ["execution-2"]);
  await manager.close(context());
  assert.deepEqual(stopped.sort(), ["execution-1", "execution-2", "execution-3"]);
});

test("concurrent sessions share one service; another project gets its own", async () => {
  const { manager, calls } = fixture();
  await Promise.all([manager.ensure(context()), manager.ensure(context("/projects/a", "/projects/a/session-b/source"))]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution.lifecycle, "service");
  assert.equal(calls[0].session, undefined);
  assert.equal(calls[0].execution.sessionId, undefined);
  await manager.ensure(context("/projects/b"));
  assert.notEqual(calls[0].execution.ownerId, calls[1].execution.ownerId);
});

test("exited services restart on next launch", async () => {
  const { manager, calls, exited } = fixture();
  await manager.ensure(context());
  exited();
  await manager.ensure(context());
  assert.equal(calls.length, 2);
});

test("a different branch cannot silently replace a running project service", async () => {
  let argv = service.argv;
  const { manager, calls } = fixture({ inspect: async () => ({ services: [{ ...service, argv }] }) });
  await manager.ensure(context());
  argv = ["npm", "run", "different-worker"];
  await assert.rejects(manager.ensure(context()), /Close and reopen/);
  assert.equal(calls.length, 1);
});

test("project close drains a racing start and prevents new starts until reopen", async () => {
  let complete;
  let started;
  const starting = new Promise((resolve) => { started = resolve; });
  const { manager, calls } = fixture({ runCommand: async () => {
    started();
    await new Promise((resolve) => { complete = resolve; });
    return { ok: true, execution: { id: "execution-racing" } };
  } });
  const launch = manager.ensure(context());
  await starting;
  manager.beginClose(context());
  const closing = manager.close(context());
  assert.throws(() => manager.opened(context()), /cleanup is unfinished/);
  complete();
  await Promise.all([launch, closing]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].stop.ownerId);
  await assert.rejects(manager.ensure(context()), /closing/);
});

test("a successfully drained project can reopen and start its service again", async () => {
  const { manager, calls } = fixture();
  await manager.ensure(context());
  await manager.close(context());
  manager.opened(context());
  await manager.ensure(context());
  assert.equal(calls.filter((call) => call.execution).length, 2);
});

test("removing a running declaration requires project close too", async () => {
  let services = [service];
  const { manager, calls } = fixture({ inspect: async () => ({ services }) });
  await manager.ensure(context());
  services = [];
  await assert.rejects(manager.ensure(context()), /was removed.*Close and reopen/);
  assert.equal(calls.length, 1);
});

test("close after server restart stops the exact durable owner without any source session", async () => {
  const first = fixture();
  await first.manager.ensure(context());
  const second = fixture();
  await second.manager.close(context());
  assert.equal(second.calls[0].stop.ownerId, first.calls[0].execution.ownerId);
});

test("failed cleanup remains an error and blocks a new service", async () => {
  const { manager } = fixture({ stopOwned: async () => ({ supported: true, scopeEmpty: false, error: "still running" }) });
  await manager.ensure(context());
  await assert.rejects(manager.close(context()), /still running/);
  await assert.rejects(manager.ensure(context()), /closing/);
  assert.throws(() => manager.opened(context()), /cleanup is unfinished/);
});

test("standalone close uses owned execution handles", async () => {
  const stopped = [];
  const { manager } = fixture({ stopOwned: async () => ({ supported: false, scopeEmpty: true }),
    stopExecution: async (id) => { stopped.push(id); return { scopeEmpty: true }; } });
  await manager.ensure(context());
  await manager.close(context());
  assert.deepEqual(stopped, ["execution-1"]);
});
