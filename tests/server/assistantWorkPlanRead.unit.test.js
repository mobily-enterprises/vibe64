import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createService } from "../../packages/vibe64-terminals/src/server/service.js";
import { workPlanPath } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

test("plan service reads the actual session without AI and preserves private renewal access", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plan-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  const sessionId = "plan-session";
  await store.createSession({ sessionId, runtimeKind: "genesis" });
  const runtime = { stateRoot: root, store, getSession: (id) => store.readSession(id) };
  const unused = () => assert.fail("Reading a plan must not inspect or change project configuration.");
  const service = createService({ env: {}, projectService: { createRuntime: async () => runtime,
    createSessionStore: async () => store, readCurrentProject: unused, readEnv: unused,
    runInProjectContext: unused, saveEnvUserValues: unused },
    codexTerminalController: { codexAppServerProviderFactory() { assert.fail("Reading a plan must not start AI."); } } });
  assert.deepEqual(await service.readSessionWorkPlan(sessionId), { ok: true, sessionId, available: false, current: null, history: [] });
  const context = { runtime, session: await store.readSession(sessionId) };
  const file = workPlanPath(context);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "Status: active\nKeep whitespace 🙂\n  ");
  const first = await service.readSessionWorkPlan(sessionId, { limit: 10 });
  assert.equal(first.ok, true);
  assert.equal(first.available, true);
  const next = await service.readSessionWorkPlan(sessionId, { offset: first.nextOffset, expectedRevision: first.revision });
  assert.equal(first.text + next.text, "Status: active\nKeep whitespace 🙂\n  ");
  assert.equal((await service.readSessionWorkPlan(sessionId, { offset: 1 })).code, "vibe64_work_plan_revision_required");
  const stale = await service.archiveSessionWorkPlan(sessionId, { expectedRevision: "f".repeat(64) });
  assert.equal(stale.code, "vibe64_work_plan_changed");
  assert.equal((await service.readSessionWorkPlan(sessionId)).available, true);
  await store.writeMetadataValue(sessionId, "assistant_routing_request", JSON.stringify({ status: "review_pending" }));
  const busy = await service.archiveSessionWorkPlan(sessionId, { expectedRevision: first.revision });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /review to finish/);
  await store.writeMetadataValue(sessionId, "assistant_routing_request", JSON.stringify({ status: "done" }));
  const archived = await service.archiveSessionWorkPlan(sessionId, { expectedRevision: first.revision });
  assert.equal(archived.ok, true);
  assert.equal(archived.available, false);
  assert.equal(archived.current, null);
  assert.equal(archived.history.length, 1);
  assert.equal(archived.history[0].status, "active", "archiving is not completion");
  assert.equal((await service.readSessionWorkPlan(sessionId, { archiveId: archived.history[0].id })).text,
    "Status: active\nKeep whitespace 🙂\n  ");
  await writeFile(store.paths(sessionId).statusPath, "renewal_pending\n");
  const hidden = await service.readSessionWorkPlan(sessionId);
  assert.equal(hidden.ok, false);
  assert.equal(hidden.code, "vibe64_session_renewal_private");
  assert.equal(hidden.text, undefined);
});
