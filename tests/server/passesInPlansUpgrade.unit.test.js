import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { assistantRoutingRequestForMessage } from "../../packages/vibe64-terminals/src/server/assistantRoutingRequests.js";
import passesInPlans from "../../packages/vibe64-core/src/server/stateUpgrades/20261123-passes-in-plans.js";
import { __testables, upgradePassesInPlans } from "../../packages/vibe64-terminals/src/server/passesInPlansUpgrade.js";

const { passesInPlansChanges } = __testables;

const passChain = { index: 1, stopped: false, passes: [{ id: "review", title: "Review", request: "Review: the changes since base commit abc." },
  { id: "security-pass", title: "Security pass", request: "Security pass: the changes since base commit abc." }] };
const request = (fields) => JSON.stringify({ schemaVersion: 6, messageId: "m1", status: "waiting", delivery: "accepted", mode: "auto",
  stage: "implementation", workflow: true, input: { message: "Add validation." }, afterPlan: { planAtAdmission: null }, ...fields });
const converted = (fields) => JSON.parse(passesInPlansChanges({ metadata: { assistant_routing_request: request(fields) } })
  .metadata.assistant_routing_request);

async function snapshot(root, prefix = "") {
  const result = {};
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return result; throw error; }
  for (const entry of entries) {
    const name = path.join(prefix, entry.name), filename = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(filename, name));
    else result[name] = await readFile(filename, "utf8");
  }
  return result;
}

test("saved routing requests move to version 7 without their list of after-plan passes or a plan handoff's draft", () => {
  const kept = JSON.parse(request({}));
  assert.deepEqual(converted({ passChain }), { ...kept, schemaVersion: 7 });
  assert.deepEqual(converted({ planHandoff: { turnId: "t1", role: "junior", reason: "conversation", operation: "new", draft: "# Junior's plan" } }).planHandoff,
    { turnId: "t1", role: "junior", reason: "conversation", operation: "new" });
  assert.equal(converted({ status: "complete", stage: "review" }).status, "complete", "a finished request stays finished");
});

test("a request still at one of its after-plan passes finishes, stopped, so nothing replays it", () => {
  const followup = { messageId: "f1", message: "Security pass: the changes since base commit abc.", messages: [] };
  for (const status of ["working", "waiting"]) {
    const pass = converted({ stage: "pass", status, passChain, followup, error: "The turn ended without a confirmed workflow outcome." });
    assert.deepEqual([pass.schemaVersion, pass.status, pass.stopped, pass.followup, pass.error, pass.passChain],
      [7, "complete", true, undefined, undefined, undefined], status);
  }
});

test("Main chat's and each temporary chat's requests are converted; a request already at version 7 is left alone, and unreadable or older ones stop the upgrade", () => {
  const changes = passesInPlansChanges({
    metadata: { assistant_routing_request: request({ passChain }), assistant_routing: "{\"mode\":\"auto\"}" },
    conversations: [
      { conversationId: "helper", routingMetadata: { assistant_routing_request: request({ mode: "senior" }), other: "keep" } },
      { conversationId: "plain" }
    ]
  });
  assert.deepEqual(Object.keys(changes.metadata), ["assistant_routing_request"], "only the request changes");
  assert.equal(JSON.parse(changes.conversations[0].routingMetadata.assistant_routing_request).schemaVersion, 7);
  assert.equal(changes.conversations[0].routingMetadata.other, "keep");
  assert.deepEqual(changes.conversations[1], { conversationId: "plain" });
  const current = JSON.stringify({ ...JSON.parse(request({})), schemaVersion: 7 });
  assert.equal(passesInPlansChanges({ metadata: { assistant_routing_request: current } }).metadata.assistant_routing_request, current);
  assert.throws(() => passesInPlansChanges({ metadata: { assistant_routing_request: "{" } }), /unreadable/u);
  assert.throws(() => passesInPlansChanges({ metadata: { assistant_routing_request: request({ schemaVersion: 5 }) } }), /unsupported/u);
  assert.throws(() => passesInPlansChanges({ metadata: { assistant_routing_request: "[]" } }), /must be an object/u);
});

test("a converted request reads back at runtime, and one that missed the upgrade is refused", () => {
  const raw = passesInPlansChanges({ metadata: { assistant_routing_request: request({ passChain }) } }).metadata.assistant_routing_request;
  assert.equal(assistantRoutingRequestForMessage({ assistant_routing_request: raw }, (id) => id === "m1").messageId, "m1");
  assert.throws(() => assistantRoutingRequestForMessage({ assistant_routing_request: request({}) }, () => true),
    (error) => error.code === "vibe64_assistant_workflow_upgrade_required");
});

test("the numbered upgrade refuses without its owner, checks without writing, converts with a backup and changes nothing on retry", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-passes-in-plans-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: systemRoot, projectRuntimeRoot: path.join(systemRoot, "projects/project-one") });
  await store.createSession({ sessionId: "auto", runtimeKind: "genesis" });
  await store.writeMetadataValue("auto", "assistant_routing_request", request({ stage: "pass", status: "working", passChain }));
  await store.writeMetadataValue("auto", "unrelated", "keep");
  await store.writeSessionConversation("auto", "helper", { title: "Helper",
    routingMetadata: { assistant_routing_request: request({ mode: "senior", status: "complete" }) } });
  await store.createSession({ sessionId: "plain", runtimeKind: "genesis" });
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261123-passes-in-plans");
  const context = { systemRoot, backupRoot, report: () => {}, upgradePassesInPlans };
  assert.equal(passesInPlans.id, "20261123-passes-in-plans");
  await assert.rejects(passesInPlans.run({ systemRoot, backupRoot, report: () => {} }), /candidate upgrade-state command/u);
  const before = await snapshot(systemRoot);
  await passesInPlans.run({ ...context, apply: false });
  assert.deepEqual(await snapshot(systemRoot), before, "the check writes nothing");
  await passesInPlans.run({ ...context, apply: true });
  const saved = JSON.parse(await store.readMetadataValue("auto", "assistant_routing_request"));
  assert.deepEqual([saved.schemaVersion, saved.passChain, saved.status, saved.stopped], [7, undefined, "complete", true]);
  assert.equal(await store.readMetadataValue("auto", "unrelated"), "keep");
  assert.equal(JSON.parse((await store.readSessionConversation("auto", "helper")).routingMetadata.assistant_routing_request).schemaVersion, 7);
  const backups = await snapshot(backupRoot);
  assert.ok(Object.keys(backups).some((name) => name.includes("before") && name.endsWith("assistant_routing_request")), Object.keys(backups).join(", "));
  const after = await snapshot(systemRoot);
  await passesInPlans.run({ ...context, apply: true });
  assert.deepEqual(await snapshot(systemRoot), after, "a retry changes nothing");
});
