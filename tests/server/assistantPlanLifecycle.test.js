import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { manageWorkPlan, readWorkPlan, readWorkPlanPage, readWorkPlanHistory, workPlanPath } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { upgradePlanSession, upgradeAssistantPlans } from "../../packages/vibe64-accounts/src/server/assistantPlanUpgrade.js";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plans-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = "test-session";
  const context = { session: { sessionId }, runtime: { store: {
    paths: () => ({ sessionRoot: path.join(root, sessionId), conversationsRoot: path.join(root, sessionId, "conversations") })
  } } };
  const change = async (operation, role = "senior", extra = {}) => manageWorkPlan(context, {
    operation, expectedRevision: (await readWorkPlan(context))?.revision || "", ...extra
  }, role);
  return { root, context, change };
}
const openText = "# Reporting tree\n\n- [ ] Save the supervisor\n- [ ] Prove access restrictions\n";
const checkedText = openText.replaceAll("[ ]", "[x]") + "\nEvidence: focused checks pass.\n";

test("checklist progress is live but only Senior can explicitly complete or reopen", async t => {
  const f = await fixture(t);
  assert.equal(await readWorkPlan(f.context), null);
  await assert.rejects(f.change("new", "junior", { text: openText }), /Only Senior/);
  await f.change("new", "senior", { text: openText });
  await assert.rejects(f.change("complete"), /unchecked/);
  await f.change("write", "junior", { text: checkedText });
  assert.equal((await readWorkPlan(f.context)).status, "active");
  assert.equal((await readWorkPlanPage(f.context)).checked, 2);
  await assert.rejects(f.change("complete", "junior"), /Only Senior/);
  await f.change("complete", "review");
  const completed = await readWorkPlan(f.context);
  assert.equal(completed.status, "completed");
  assert.equal((await readWorkPlanPage(f.context)).text, completed.text, "completed stays readable");
  await assert.rejects(f.change("write", "junior", { text: openText }), /explicitly reopen/);
  await f.change("reopen");
  await f.change("write", "senior", { text: openText + "- [ ] Missing acceptance check\n" });
  assert.equal((await readWorkPlan(f.context)).checked, 0);
  assert.equal((await readWorkPlan(f.context)).total, 3);
  assert.equal((await readWorkPlanHistory(f.context)).length, 0, "reopening the current plan does not duplicate it in History");
});

test("new plans require an archive announcement and reopening moves the selected archive back to current", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: openText });
  const first = await readWorkPlan(f.context);
  await assert.rejects(f.change("new", "senior", { text: "# Myosh\n- [ ] Inspect administration" }), /Tell the user/);
  assert.equal((await readWorkPlan(f.context)).revision, first.revision);
  const second = await f.change("new", "senior", { text: "# Myosh\n- [ ] Inspect administration", archiveCurrent: true });
  assert.match(second.notice, /Archived “Reporting tree”/);
  assert.equal(second.history[0].status, "active", "archiving is not completion");
  await assert.rejects(f.change("reopen", "senior", { archiveId: first.revision }), /Tell the user/);
  await f.change("reopen", "senior", { archiveId: first.revision, archiveCurrent: true });
  assert.equal((await readWorkPlan(f.context)).text, first.text);
  assert.equal((await readWorkPlanHistory(f.context)).length, 1);
  assert.equal((await readWorkPlanPage(f.context, { archiveId: first.revision })).available, false);
  await f.change("archive");
  const empty = await readWorkPlanPage(f.context);
  assert.equal(empty.available, false);
  assert.equal(empty.history.length, 2, "identical snapshot retry does not create duplicates");
  assert.equal((await readWorkPlanPage(f.context, { archiveId: first.revision })).text, first.text);
});

test("Make current moves a completed archive to Active once, preserves evidence, and cannot replace a current plan", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: checkedText });
  await f.change("complete");
  const completed = await readWorkPlan(f.context);
  await f.change("archive", "user");
  await assert.rejects(f.change("reopen", "junior", { archiveId: completed.revision }), /Only Senior/);
  await assert.rejects(f.change("reopen", "user", { archiveId: "f".repeat(64) }), /unavailable/);
  assert.equal(await readWorkPlan(f.context), null);
  const attempts = await Promise.allSettled([1, 2].map(() => manageWorkPlan(f.context,
    { operation: "reopen", archiveId: completed.revision }, "user")));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.match(attempts.find(result => result.status === "rejected").reason.message, /already a current plan/);
  const current = await readWorkPlan(f.context);
  assert.equal(current.text, completed.text.replace("Status: completed", "Status: active"));
  assert.equal(current.checked, completed.checked);
  assert.equal((await readWorkPlanHistory(f.context)).length, 0);
  await assert.rejects(f.change("reopen", "user", { archiveId: completed.revision, archiveCurrent: true }), /already a current plan/);
  assert.deepEqual(await readWorkPlan(f.context), current);
  await f.change("archive", "user");
  const history = await readWorkPlanHistory(f.context);
  assert.equal(history.length, 1);
  assert.equal(history[0].revision, current.revision);
});

test("concurrent updates cannot overwrite newer evidence and invalid plan writes leave the current record intact", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: openText });
  const first = await readWorkPlan(f.context);
  const results = await Promise.allSettled([checkedText, openText + "- [ ] Another check"].map(text => manageWorkPlan(f.context,
    { operation: "write", expectedRevision: first.revision, text }, "junior")));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "vibe64_work_plan_changed");
  const current = await readWorkPlan(f.context);
  await assert.rejects(f.change("write", "senior", { text: "# No checklist" }), /checklists/);
  await assert.rejects(f.change("write", "senior", { text: "# Only an example\n```markdown\n- [x] Example\n```" }), /checklists/);
  assert.deepEqual(await readWorkPlan(f.context), current);
  await assert.rejects(readWorkPlanPage(f.context, { archiveId: "../current" }), /identity/);
  const archive = path.join(path.dirname(workPlanPath(f.context)), "archive");
  await symlink(f.root, archive);
  await assert.rejects(f.change("archive"), /link/);
  assert.deepEqual(await readWorkPlan(f.context), current);
});

test("the installed plan command uses the admitted role, emits live changes and ignores a forged role", async t => {
  const f = await fixture(t);
  let request = { status: "sent", resolvedMode: "senior" };
  const events = [];
  const store = { ...f.context.runtime.store, readMetadataValue: async () => JSON.stringify(request),
    readSessionSourceDescriptor: async () => ({ sessionId: f.context.session.sessionId,
      metadata: { source_kind: "session_clone", source_path: path.join(f.root, "sessions", "active", f.context.session.sessionId, "source"), source_path_authority: "managed_session_source" } }) };
  const service = createAgentSessionCommandService({ projectService: {
    createSessionStore: async () => store, readCurrentProject: async () => ({ slug: "project", projectRoot: f.root }),
    runInProjectContext: async (_slug, callback) => callback()
  }, publishSessionChanged: async (_id, event) => events.push(event) });
  t.after(() => service.closeAllForSession(f.context.session.sessionId));
  const wrapperHostDir = path.join(f.root, "commands");
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId: f.context.session.sessionId, wrapperHostDir });
  const command = (operation, input = {}) => new Promise((resolve, reject) => {
    const child = execFile(path.join(wrapperHostDir, "vibe64-plan"), [operation], { env: { ...process.env, ...prepared.env }, timeout: 5000 },
      (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(JSON.parse(stdout)));
    if (!["read", "history"].includes(operation)) child.stdin.end(JSON.stringify(input));
  });
  const first = await command("new", { text: openText });
  assert.equal(first.status, "active");
  request = { status: "sent", resolvedMode: "junior" };
  await assert.rejects(command("complete", { role: "senior", expectedRevision: first.revision }), /Only Senior/);
  const ticked = await command("write", { text: checkedText, expectedRevision: first.revision });
  assert.equal(ticked.checked, 2);
  request = { status: "reviewing", resolvedMode: "junior" };
  assert.equal((await command("complete", { expectedRevision: ticked.revision })).status, "completed");
  request = { status: "sent", resolvedMode: "senior", reason: "discussion" };
  await assert.rejects(command("reopen", { expectedRevision: (await command("read")).revision }), /Only Senior/);
  assert.equal(events.filter(event => event.reason === "work-plan-changed").length, 3);
  assert.deepEqual((await command("history")).history, [], "read-only commands finish even with stdin open");
});

test("upgrade uses explicit file completion rather than a successful-turn snapshot", () => {
  for (const status of ["drafting", "ready", "blocked", "implemented"]) {
    const text = `Status: ${status}\n# Existing\n- [ ] Unchanged evidence\n`;
    const saved = { messageId: "kept", status: "done", workPlan: { status: "implemented", text } };
    const result = upgradePlanSession({ metadata: { assistant_routing_request: JSON.stringify(saved) }, conversations: [],
      plans: [{ conversationId: "", originalOld: text, original: null }] });
    const request = JSON.parse(result.metadata.assistant_routing_request);
    assert.equal(request.workPlan.status, status === "implemented" ? "completed" : "active");
    assert.equal(request.workPlan.text.split("\n").slice(1).join("\n"), text.split("\n").slice(1).join("\n"));
    assert.equal(request.messageId, "kept");
  }
  assert.throws(() => upgradePlanSession({ metadata: {}, conversations: [], plans: [{ conversationId: "", originalOld: "Status: ready\nold", original: "Status: active\nnew" }] }), /different contents/);
});

test("stopped-service upgrade is read-only in preflight, backs up old plans and safely retries", async t => {
  const f = await fixture(t);
  const systemRoot = path.join(f.root, "system");
  const projectRuntimeRoot = path.join(systemRoot, "projects", "project");
  const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
  await store.createSession({ sessionId: "plan-session", runtimeKind: "genesis" });
  const session = store.paths("plan-session").sessionRoot;
  const oldFile = path.join(session, "work-plan", "plan.md");
  const original = "Status: ready\n# Existing plan\n- [ ] Keep my evidence\n";
  await mkdir(path.dirname(oldFile), { recursive: true });
  await writeFile(oldFile, original);
  await store.createSession({ sessionId: "archived-plan", runtimeKind: "genesis" });
  await store.writeSessionConversation("archived-plan", "side", { providerConversationId: "native-side" });
  for (const scope of [store.paths("archived-plan").sessionRoot, path.join(store.paths("archived-plan").conversationsRoot, "side")]) {
    await mkdir(path.join(scope, "work-plan"), { recursive: true });
    await writeFile(path.join(scope, "work-plan", "plan.md"), original);
  }
  await store.writeStatus("archived-plan", VIBE64_SESSION_STATUS.ARCHIVED);
  await store.publishSessionArchive("archived-plan");
  const archiveFile = path.join(store.paths().archivedSessionsRoot, "archived-plan.tar.gz");
  const archiveBefore = await readFile(archiveFile);
  const backupRoot = path.join(systemRoot, "upgrades", "backups", "20260929-plan-history");
  const options = { systemRoot, backupRoot, report: () => {} };
  await upgradeAssistantPlans({ ...options, apply: false });
  assert.equal(await readFile(oldFile, "utf8"), original);
  assert.deepEqual(await readFile(archiveFile), archiveBefore);
  await assert.rejects(readFile(path.join(session, "plans", "current.md")), { code: "ENOENT" });
  await upgradeAssistantPlans({ ...options, apply: true });
  assert.equal(await readFile(path.join(session, "plans", "current.md"), "utf8"), original.replace("ready", "active"));
  await assert.rejects(readFile(oldFile), { code: "ENOENT" });
  assert.equal(await readFile(path.join(backupRoot, "before", path.relative(systemRoot, oldFile)), "utf8"), original);
  assert.deepEqual(await readFile(path.join(backupRoot, "before", path.relative(systemRoot, archiveFile))), archiveBefore);
  const exec = promisify(execFile);
  for (const scope of ["archived-plan", "archived-plan/conversations/side"]) {
    assert.equal((await exec("tar", ["-xOf", archiveFile, "./" + scope + "/plans/current.md"])).stdout, original.replace("ready", "active"));
  }
  assert.doesNotMatch((await exec("tar", ["-tzf", archiveFile])).stdout, /work-plan\/plan\.md/u);
  await upgradeAssistantPlans({ ...options, apply: true });
  assert.equal(await readFile(path.join(session, "plans", "current.md"), "utf8"), original.replace("ready", "active"));
});
