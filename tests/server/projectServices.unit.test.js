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
  assert.deepEqual(parseVibe64ProjectServicesLines(["- Nothing."]), []);
  for (const lines of [[], ['- Start `worker` with `nodejs` in `../elsewhere`: `npm`'], ['- Start `worker` with `nodejs`: npm run worker'],
    ['- Start `worker` with `nodejs`: `npm`', '- Start `worker` with `nodejs`: `npm`']]) {
    assert.throws(() => parseVibe64ProjectServicesLines(lines), { code: "VIBE64_PROJECT_SERVICES_INVALID" });
  }
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
