import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createAgentPreviewCommandService } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { createAgentSessionCommandService } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { manageWorkPlan, readWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { moveErdLayoutTables } from "../../packages/vibe64-database-tools/src/server/erdLayout.js";
import { dataOverviewSchema } from "../fixtures/dataOverviewSchema.js";

// 2026-11-25: an agent sent `vibe64-helper plan progress-write` {"progressText": ...} while it took the Progress under
// another name; the helper ignored the field, answered ok and kept an empty Progress. Every vibe64-helper operation that
// takes input, as its server owner receives it, refuses a field it does not read and a missing field it needs, naming
// the fields it takes, and changes nothing: one row per operation.
const PLAN = "# Reporting tree\n\n- [ ] Save the supervisor\n";
const PAIRED = ["expectedRevision", "expectedProgressRevision"];
const UNREAD = "comment";

/** Sends a plan operation as `vibe64-helper plan <operation>` reaches the session command server. */
const plan = (operation) => (f, input) => f.session.managePlan(f.sessionId, { operation, ...input });
/** Calls a session command, as its route hands the agent's own fields to it. */
const session = (name) => (f, input) => f.session[name](f.sessionId, input);
/** `vibe64-helper inventory ...`, a host's own group, as the session control's route hands its fields over. */
const hostGroup = (f, input) => f.session.runHelperGroup(f.sessionId, input, { signal: new AbortController().signal, stdout() {}, stderr() {} });
const erdMoves = (f, input) => moveErdLayoutTables(f.schema, f.layout, input);
const erdMove = (f, move) => erdMoves(f, { revision: 1, moves: [move] });
/** `vibe64-helper preview identities save` with the input as its stdin: a refusal is a failed command answer. */
async function saveIdentities(f, input) {
  const result = await f.preview.run({ args: ["identities", "save"], sessionId: "session-a", stdin: JSON.stringify(input) });
  if (result.ok === false) throw Object.assign(new Error(result.error), { code: result.code });
  return result;
}

const OPERATIONS = [
  { name: "plan read", fields: ["offset", "limit", ...PAIRED, "archiveId"], send: plan("read") },
  { name: "plan history", fields: [], send: plan("history") },
  { name: "plan new", fields: ["text", ...PAIRED, "archiveCurrent"], base: { text: PLAN }, send: plan("new"),
    missing: ["text", "vibe64_work_plan_text_required", "plan new takes the whole new Plan as text, a string that is not empty: nothing changed."] },
  { name: "plan write", fields: ["text", ...PAIRED, "readThrough"], base: { text: PLAN }, send: plan("write"),
    missing: ["text", "vibe64_work_plan_text_required", "plan write takes the whole new Plan as text, a string that is not empty: nothing changed."] },
  { name: "plan progress-write", fields: ["progressText", ...PAIRED, "readThrough"], base: { progressText: "# Progress\nSaved.\n" },
    send: plan("progress-write"),
    missing: ["progressText", "vibe64_work_plan_text_required",
      "plan progress-write takes the whole new Progress as progressText, a string that is not empty: nothing changed."] },
  { name: "plan checked", fields: PAIRED, send: plan("checked") },
  { name: "plan complete", fields: PAIRED, send: plan("complete") },
  { name: "plan archive", fields: PAIRED, send: plan("archive") },
  { name: "plan reopen", fields: [...PAIRED, "archiveId", "archiveCurrent"], send: plan("reopen") },
  // The workflow identity a read returns (messageId, turnId, stage and status) goes back under the same names.
  { name: "plan outcome", fields: ["messageId", "turnId", "stage", "status", "decision", "explanation", "progress", ...PAIRED],
    required: ["messageId", "turnId", "stage", "decision", "explanation", "progress"], send: plan("outcome"),
    base: { messageId: "request-1", turnId: "turn-1", stage: "implementation", decision: "continue", explanation: "Saved.", progress: true } },
  { name: "plan handoff", fields: [], send: plan("handoff") },
  { name: "session list-project", fields: ["projectSlug"], required: ["projectSlug"], base: { projectSlug: "alpha" },
    send: session("listProject") },
  { name: "session message-project", fields: ["projectSlug", "message", "messageId", "destinationSessionId"],
    required: ["projectSlug", "message"], base: { projectSlug: "alpha", message: "Please update." }, send: session("messageProject") },
  { name: "session project-preview", fields: ["projectSlug", "destinationSessionId"], required: ["projectSlug"],
    base: { projectSlug: "alpha" }, send: session("projectPreview") },
  { name: "session rename", fields: ["name"], required: ["name"], base: { name: "Reporting" }, send: session("renameSession") },
  { name: "session setup retry", fields: [], send: session("retrySetup") },
  { name: "session status", fields: [], send: session("sessionStatus") },
  { name: "session update", fields: ["reviewedConflictId"], send: session("updateSession") },
  { name: "session save", fields: [], send: session("saveSession") },
  // A host's group refuses before its folder is checked or its run is called.
  { name: "inventory", fields: ["group", "args", "cwd"], required: ["args", "cwd", "group"],
    base: { group: "inventory", args: ["count"], cwd: "." }, send: hostGroup },
  { name: "database erd apply", fields: ["revision", "moves"], required: ["revision", "moves"],
    base: { revision: 1, moves: [{ table: "public.addresses", x: 400, y: 0 }] }, send: erdMoves },
  { name: "database erd apply move 1", fields: ["table", "x", "y", "pinned"], required: ["table", "x", "y"],
    base: { table: "public.addresses", x: 400, y: 0 }, send: erdMove },
  { name: "preview identities save", fields: ["identities"], required: ["identities"],
    base: { identities: [{ name: "admin", type: "email", value: "admin@example.com" }] }, send: saveIdentities }
];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-unread-fields-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = "test-session";
  const sessionRoot = path.join(root, sessionId);
  const source = path.join(root, "sessions", "active", sessionId, "source");
  await mkdir(source, { recursive: true });
  const paths = () => ({ sessionRoot, conversationsRoot: path.join(sessionRoot, "conversations") });
  const context = { session: { sessionId }, runtime: { store: { paths } } };
  // Senior's running turn, which may make every plan change.
  const request = { schemaVersion: 7, messageId: "request-1", turnId: "turn-1", status: "working", delivery: "accepted",
    mode: "senior", resolvedMode: "senior", reason: "conversation", stage: null };
  const calls = [];
  const called = (name, answer = { ok: true }) => async (...args) => { calls.push(name); return typeof answer === "function" ? answer(...args) : answer; };
  const store = { paths,
    readMetadataValue: async (_id, name) => name === "assistant_routing_request" ? JSON.stringify(request) : undefined,
    writeMetadataValue: called("writeMetadataValue"),
    writeSessionLabel: called("writeSessionLabel", "Reporting"),
    readSessionSourceDescriptor: async () => ({ sessionId,
      metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" } }) };
  const service = createAgentSessionCommandService({ logger: silentLogger, project: {
    createSessionStore: async () => store, readCurrentProject: async () => ({ slug: "project", projectRoot: root }),
    runInProjectContext: async (_slug, callback) => callback()
  }, publishSessionChanged: called("publishSessionChanged"),
  listProjectSessions: called("listProjectSessions"), sendProjectMessage: called("sendProjectMessage"),
  readProjectPreview: called("readProjectPreview"), reportWorkflowOutcome: called("reportWorkflowOutcome"),
  handPlanToSenior: called("handPlanToSenior"), retryWorkspaceSetup: called("retryWorkspaceSetup", { ok: true, state: {} }),
  updateSessionWork: called("updateSessionWork"), saveSessionWork: called("saveSessionWork"),
  previewStartedBefore: () => false,
  helperCommandGroups: [{ name: "inventory", summary: "Count the stock", help: "Usage: vibe64-helper inventory count", run: called("inventory", { exit: 0 }) }] });
  t.after(() => service.closeAllForSession(sessionId));
  await service.bindSession(sessionId, { wrapperHostDir: path.join(root, "commands") });
  await manageWorkPlan(context, { operation: "new", text: PLAN }, "senior");
  const preview = createAgentPreviewCommandService({ logger: silentLogger, publishSessionChanged: called("publishSessionChanged"),
    project: {
      runInProjectContext: async (_slug, operation) => operation(),
      savePreviewApplicationIdentities: called("savePreviewApplicationIdentities", (input) => ({ ok: true, identities: input.identities }))
    },
    launchTarget: { launchStatus: async () => ({ outputTargets: [{ id: "dev", identityTypes: ["email"] }] }) } });
  preview.registerBrowserWorker("session-a", { project: { slug: "alpha" }, socketPath: path.join(root, "preview.sock") });
  const schema = dataOverviewSchema();
  const layout = { revision: 1, nodes: schema.tables.map((table, index) => ({ table: table.qualifiedName, x: index * 600, y: 0 })) };
  return { calls, context, layout, preview, schema, session: service, sessionId };
}

const takes = (fields) => `It takes ${fields.length ? fields.join(", ") : "no input"}.`;

test("every vibe64-helper operation refuses a field it does not read and a missing one it needs, naming what it takes, and changes nothing", async (t) => {
  const f = await fixture(t);
  const before = await readWorkPlan(f.context);
  for (const operation of OPERATIONS) {
    const { name, fields, base = {}, required = [], send } = operation;
    await t.test(name, async () => {
      f.calls.length = 0;
      await assert.rejects(Promise.resolve().then(() => send(f, { ...base, [UNREAD]: "Looks good." })), (error) => {
        assert.equal(error.message, `${name} does not read ${UNREAD}: nothing changed. ${takes(fields)}`);
        assert.equal(error.code, "vibe64_command_input_unread");
        return true;
      });
      const [field, code, message] = operation.missing || (required.length
        ? [required[0], "vibe64_command_input_missing", `${name} needs ${required[0]}: nothing changed. ${takes(fields)}`] : []);
      if (field) {
        const { [field]: _dropped, ...rest } = base;
        await assert.rejects(Promise.resolve().then(() => send(f, rest)), (error) => {
          assert.equal(error.message, message);
          assert.equal(error.code, code);
          return true;
        });
      }
      assert.deepEqual(f.calls, [], `${name} reached no owner`);
    });
  }
  const after = await readWorkPlan(f.context);
  assert.deepEqual([after.text, after.progressText, after.revision], [before.text, before.progressText, before.revision]);
});
