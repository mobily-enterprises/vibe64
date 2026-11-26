import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createAgentSessionCommandService } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { GENESIS_MASTER_PASS, GENESIS_PASSES } from "../fixtures/genesisPasses.js";

// Which plan changes the agent's plan command takes from the turn it runs in: the role comes from the chat's saved
// routing request, as `vibe64-helper plan` reaches it, never from the command's input.
const PLAN = "# Reporting tree\n\n- [ ] Save the supervisor\n- [ ] Prove access restrictions\n";
const TICKED = PLAN.replace("- [ ] Save", "- [x] Save").replace("- [ ] Prove", "- [~] Prove");
const OTHER_PLAN = "# Contact threads\n\n- [ ] One thread per contact\n";
const SCOPE_REFUSAL = /Only Senior can change the scope/u;

async function planCommand(t, { connected = [], listPasses } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plan-turn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = "test-session";
  const sessionRoot = path.join(root, sessionId);
  const source = path.join(root, "sessions", "active", sessionId, "source");
  await mkdir(source, { recursive: true });
  const paths = () => ({ sessionRoot, conversationsRoot: path.join(sessionRoot, "conversations") });
  const context = { session: { sessionId }, runtime: { store: { paths } } };
  let request = null;
  const handoffs = [];
  const commit = "a".repeat(40);
  const copies = connected.length ? JSON.stringify(Object.fromEntries(connected.map((name) => [name, {
    repository: `example/${name}`, branch: "main", path: path.join(path.dirname(source), "connected", name), baseCommit: commit, canonicalCommit: commit
  }]))) : undefined;
  const metadataValues = { assistant_routing_request: () => JSON.stringify(request), connected_copies: () => copies };
  const store = { paths,
    readMetadataValue: async (_id, name) => metadataValues[name]?.(),
    writeMetadataValue: async () => {},
    readSessionSourceDescriptor: async () => ({ sessionId,
      metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" } }) };
  const service = createAgentSessionCommandService({ logger: silentLogger, project: {
    createSessionStore: async () => store, readCurrentProject: async () => ({ slug: "project", projectRoot: root }),
    runInProjectContext: async (_slug, callback) => callback()
  }, publishSessionChanged: async () => {}, handPlanToSenior: async (_id, input) => { handoffs.push(input); return { ok: true }; },
  ...(listPasses ? { listPasses } : {}) });
  t.after(() => service.closeAllForSession(sessionId));
  await service.bindSession(sessionId, { wrapperHostDir: path.join(root, "commands") });
  await manageWorkPlan(context, { operation: "new", text: PLAN }, "senior");
  const plan = (input) => service.managePlan(sessionId, input);
  // A write as the agent makes one: from a whole read, with its revisions and readThrough.
  const write = async (operation, text) => {
    const read = await plan({ operation: "read" });
    return plan({ operation, text, expectedRevision: read.revision, expectedProgressRevision: read.progressRevision,
      ...(["write", "progress-write"].includes(operation) ? { readThrough: read.readThrough } : {}),
      ...(operation === "new" ? { archiveCurrent: true } : {}) });
  };
  return {
    context, plan, write, handoffs, source,
    // The chat's running request: its turn is working, delivered and accepted unless the fields say otherwise.
    turn: (fields) => { request = { schemaVersion: 7, messageId: "request-1", turnId: "turn-1", status: "working", delivery: "accepted", ...fields }; },
    planText: async () => (await readWorkPlan(context)).text
  };
}

test("a conversation turn works on the plan with its chat's role: Senior's in a Senior chat, Junior's in a Junior chat, and in Auto its routed role with Senior's changes handed over", async t => {
  const f = await planCommand(t);
  // Live: a person in a Senior chat asked "Are you going to do it?"; that turn's ticks were refused as scope changes.
  f.turn({ mode: "senior", resolvedMode: "senior", reason: "conversation", stage: null });
  await f.write("write", TICKED);
  assert.match(await f.planText(), /- \[x\] Save the supervisor\n- \[~\] Prove access restrictions/u, "Senior ticks the plan in a conversation turn");
  await f.write("progress-write", "# Progress\n\nThe supervisor is saved.\n");
  assert.equal((await readWorkPlan(f.context)).progressText, "# Progress\n\nThe supervisor is saved.\n");
  // A Junior chat's conversation turn keeps Junior's ticks and Progress, and its own refusal of the rest.
  f.turn({ mode: "junior", resolvedMode: "junior", reason: "conversation", stage: null });
  await f.write("write", PLAN);
  assert.equal(await f.planText(), `Status: active\n${PLAN}`);
  await assert.rejects(f.write("new", OTHER_PLAN), (error) => {
    assert.equal(error.code, "vibe64_work_plan_senior_required");
    assert.match(error.message, /^This is a Junior chat: it can update a plan's checklist marks and Progress, but only Senior creates a plan/u);
    return true;
  });
  // In Auto, a conversation turn ticks with the role Router gave it; a plan Junior's turn makes goes to Senior's
  // planning turn, and Senior's conversation turn still hands a plan request over, as before.
  f.turn({ mode: "auto", resolvedMode: "junior", reason: "conversation", stage: null });
  await f.write("write", TICKED);
  assert.match(await f.planText(), /- \[x\] Save the supervisor/u);
  await assert.rejects(f.write("new", OTHER_PLAN), { code: "vibe64_work_plan_handed_to_senior" });
  assert.deepEqual(f.handoffs.map(({ operation }) => operation), ["new"]);
  f.turn({ mode: "auto", resolvedMode: "senior", reason: "conversation", stage: null });
  await f.write("write", PLAN);
  assert.equal(await f.planText(), `Status: active\n${PLAN}`);
  assert.equal((await f.plan({ operation: "handoff" })).handedTo, "senior");
  assert.deepEqual(f.handoffs.map(({ operation }) => operation), ["new", "handoff"]);
});

test("the plan command's check of a Passes item gives Genesis the session's connected copies' roots", async t => {
  const listed = [];
  const f = await planCommand(t, { connected: ["ui-kit", "billing"], listPasses: async (options) => {
    listed.push(options);
    return { unavailable: null, passes: GENESIS_PASSES, master: GENESIS_MASTER_PASS };
  } });
  f.turn({ mode: "senior", resolvedMode: "senior", reason: "conversation", stage: null });
  await f.write("write", `${PLAN}\n## Passes\n\n- [ ] Security pass: whole app\n`);
  assert.match(await f.planText(), /- \[ \] Security pass: whole app/u);
  assert.deepEqual(listed, [{ projectRoot: f.source,
    connectedRoots: ["ui-kit", "billing"].map((name) => path.join(path.dirname(f.source), "connected", name)) }]);
});

test("a turn that may only read the plan says which turn it is, that it only reads, and how the person gets the change, never the scope refusal", async t => {
  const f = await planCommand(t);
  const refusedAs = async (fields, words) => {
    f.turn(fields);
    for (const operation of ["write", "progress-write"]) {
      await assert.rejects(f.write(operation, operation === "write" ? TICKED : "# Progress\n\nTicked.\n"), (error) => {
        assert.equal(error.code, "vibe64_work_plan_read_only", `${operation}: ${error.message}`);
        assert.match(error.message, words, operation);
        assert.match(error.message, /, so it can only read the plan \(vibe64-helper plan read and history\): nothing was saved, ticks and Progress included\./u, operation);
        assert.match(error.message, /Do not repeat the plan command\.$/u, operation);
        assert.doesNotMatch(error.message, SCOPE_REFUSAL, operation);
        return true;
      });
    }
    assert.equal(await f.planText(), `Status: active\n${PLAN}`, "nothing changed");
    assert.equal((await f.plan({ operation: "read" })).text, `Status: active\n${PLAN}`, "the turn still reads the plan");
  };
  // A pass the person started by itself, outside the plan, is a task: Senior's, and still read only.
  await refusedAs({ mode: "senior", resolvedMode: "senior", task: "deslop", reason: "review", stage: null },
    /^This turn runs Deslop, which the person started on its own, outside the plan, so .*the person gets it on the plan by asking for it in a new message once this turn ends\./u);
  await refusedAs({ mode: "senior", resolvedMode: "senior", task: "security-pass", reason: "review", stage: null },
    /^This turn runs the pass security-pass, which the person started on its own, outside the plan, so /u);
  // A request that has ended, or a chat with none, runs no turn of its own.
  await refusedAs({ mode: "senior", resolvedMode: "senior", status: "complete" },
    /^This turn belongs to no running request of this chat, so .*they get it by asking for it in a new message in this chat\./u);
  // A Custom chat has no plan rights at all, so it never hears that it may tick.
  await refusedAs({ mode: "custom", resolvedMode: "custom", stage: "implementation" },
    /^This is a Custom chat, so .*Tell the person that a Senior, Junior or Auto chat changes a plan \(Junior its ticks and Progress\), which they choose in Chat mode, and to ask again there\./u);
});
