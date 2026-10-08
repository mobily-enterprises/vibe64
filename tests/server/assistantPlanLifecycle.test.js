import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { manageWorkPlan, readWorkPlan, readWorkPlanPage, readWorkPlanHistory, workPlanPath, workPlanInstructions, planProgressUpgradeChanges } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { upgradePlanProgress } from "../../packages/vibe64-terminals/src/server/assistantPlanProgressUpgrade.js";
import { upgradePlanSession, upgradeAssistantPlans } from "../../packages/vibe64-accounts/src/server/assistantPlanUpgrade.js";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plans-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = "test-session";
  const context = { session: { sessionId }, runtime: { store: {
    paths: () => ({ sessionRoot: path.join(root, sessionId), conversationsRoot: path.join(root, sessionId, "conversations") })
  } } };
  const change = async (operation, role = "senior", extra = {}) => {
    const current = await readWorkPlan(context);
    return manageWorkPlan(context, { operation, expectedRevision: current?.revision || "",
      expectedProgressRevision: current?.progressRevision || "", ...extra }, role);
  };
  return { root, context, change };
}
const openText = "# Reporting tree\n\n- [ ] Save the supervisor\n- [ ] Prove access restrictions\n";
const checkedText = openText.replaceAll("[ ]", "[x]") + "\nEvidence: focused checks pass.\n";

test("stable scope and separate progress retain explicit Senior completion and reopen", async t => {
  const f = await fixture(t);
  assert.equal(await readWorkPlan(f.context), null);
  await assert.rejects(f.change("new", "junior", { text: openText }), /Only Senior/);
  await f.change("new", "senior", { text: openText });
  assert.equal((await readWorkPlan(f.context)).checked, 0, "Unchecked scope is not an implementation outcome");
  await f.change("progress-write", "junior", { text: checkedText });
  assert.equal((await readWorkPlan(f.context)).status, "active");
  assert.equal((await readWorkPlanPage(f.context)).checked, 0);
  await assert.rejects(f.change("complete", "junior"), /Only Senior/);
  await f.change("complete", "review");
  const completed = await readWorkPlan(f.context);
  assert.equal(completed.status, "completed");
  assert.equal((await readWorkPlanPage(f.context)).text, completed.text, "completed stays readable");
  await assert.rejects(f.change("progress-write", "junior", { text: openText }), /explicitly reopen/);
  await f.change("reopen");
  await f.change("write", "senior", { text: openText + "- [ ] Missing acceptance check\n" });
  assert.equal((await readWorkPlan(f.context)).checked, 0);
  assert.equal((await readWorkPlan(f.context)).total, 3);
  assert.equal((await readWorkPlanHistory(f.context)).length, 0, "reopening the current plan does not duplicate it in History");
});

test("new plans require acknowledged replacement and reopening moves the selected archive back to current", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: openText });
  const first = await readWorkPlan(f.context);
  await assert.rejects(f.change("new", "senior", { text: "# Myosh\n- [ ] Inspect administration" }), /Once the user has authorized replacement/);
  assert.equal((await readWorkPlan(f.context)).revision, first.revision);
  const second = await f.change("new", "senior", { text: "# Myosh\n- [ ] Inspect administration", archiveCurrent: true });
  assert.match(second.notice, /Archived “Reporting tree”/);
  assert.equal(second.history[0].status, "active", "archiving is not completion");
  await assert.rejects(f.change("reopen", "senior", { archiveId: first.artifactRevision }), /Once the user has authorized replacement/);
  await f.change("reopen", "senior", { archiveId: first.artifactRevision, archiveCurrent: true });
  assert.equal((await readWorkPlan(f.context)).text, first.text);
  assert.equal((await readWorkPlanHistory(f.context)).length, 1);
  assert.equal((await readWorkPlanPage(f.context, { archiveId: first.artifactRevision })).available, false);
  await f.change("archive");
  const empty = await readWorkPlanPage(f.context);
  assert.equal(empty.available, false);
  assert.equal(empty.history.length, 2, "identical snapshot retry does not create duplicates");
  assert.equal((await readWorkPlanPage(f.context, { archiveId: first.artifactRevision })).text, first.text);
});

test("Make current moves a completed archive to Active once, preserves evidence, and cannot replace a current plan", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: checkedText });
  await f.change("complete");
  const completed = await readWorkPlan(f.context);
  await f.change("archive", "user");
  await assert.rejects(f.change("reopen", "junior", { archiveId: completed.artifactRevision }), /Only Senior/);
  await assert.rejects(f.change("reopen", "user", { archiveId: "f".repeat(64) }), /unavailable/);
  assert.equal(await readWorkPlan(f.context), null);
  const attempts = await Promise.allSettled([1, 2].map(() => manageWorkPlan(f.context,
    { operation: "reopen", archiveId: completed.artifactRevision }, "user")));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.match(attempts.find(result => result.status === "rejected").reason.message, /already a current plan/);
  const current = await readWorkPlan(f.context);
  assert.equal(current.text, completed.text.replace("Status: completed", "Status: active"));
  assert.equal(current.checked, completed.checked);
  assert.equal((await readWorkPlanHistory(f.context)).length, 0);
  await assert.rejects(f.change("reopen", "user", { archiveId: completed.artifactRevision, archiveCurrent: true }), /already a current plan/);
  assert.deepEqual(await readWorkPlan(f.context), current);
  await f.change("archive", "user");
  const history = await readWorkPlanHistory(f.context);
  assert.equal(history.length, 1);
  assert.equal(history[0].artifactRevision, current.artifactRevision);
});

test("concurrent updates cannot overwrite newer evidence and invalid plan writes leave the current record intact", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: openText });
  const first = await readWorkPlan(f.context);
  const results = await Promise.allSettled([checkedText, openText + "- [ ] Another check"].map(text => manageWorkPlan(f.context,
    { operation: "write", expectedRevision: first.revision, expectedProgressRevision: first.progressRevision, text }, "senior")));
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
    const child = execFile(path.join(wrapperHostDir, "vibe64-plan"), [operation, ...(["read", "history"].includes(operation) && Object.keys(input).length ? ["--input"] : [])], { env: { ...process.env, ...prepared.env }, timeout: 5000 },
      (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(JSON.parse(stdout)));
    if (!["read", "history"].includes(operation) || Object.keys(input).length) child.stdin.end(JSON.stringify(input));
  });
  const first = await command("new", { text: openText });
  assert.equal(first.status, "active");
  request = { status: "sent", resolvedMode: "junior" };
  await assert.rejects(command("complete", { role: "senior", expectedRevision: first.revision }), /Only Senior/);
  const ticked = await command("progress-write", { text: checkedText, expectedRevision: first.revision, expectedProgressRevision: first.progressRevision });
  assert.equal(ticked.checked, 0);
  assert.equal(ticked.progressText, checkedText);
  request = { status: "reviewing", resolvedMode: "junior" };
  assert.equal((await command("complete", { expectedRevision: ticked.revision, expectedProgressRevision: ticked.progressRevision })).status, "completed");
  request = { status: "sent", resolvedMode: "senior", reason: "discussion" };
  await assert.rejects(command("reopen", { expectedRevision: (await command("read")).revision }), /Only Senior/);
  assert.equal(events.filter(event => event.reason === "work-plan-changed").length, 3);
  assert.deepEqual((await command("history")).history, [], "read-only commands finish even with stdin open");
  request = { status: "sent", resolvedMode: "senior" };
  const reopened = await command("reopen", { expectedRevision: (await command("read")).revision,
    expectedProgressRevision: (await command("read")).progressRevision });
  request = { status: "sent", resolvedMode: "junior" };
  const expectedProgress = "# Progress\n" + "native helper evidence 🙂\n".repeat(1200);
  await command("progress-write", { text: expectedProgress, expectedRevision: reopened.revision, expectedProgressRevision: reopened.progressRevision });
  let page = await command("read"); const readRevision = page.revision; const progressRevision = page.progressRevision;
  let allPlan = page.text; let allProgress = page.progressText;
  while (page.hasMore) {
    page = await command("read", { offset: page.nextOffset, expectedRevision: readRevision, expectedProgressRevision: progressRevision });
    allPlan += page.text; allProgress += page.progressText;
  }
  assert.equal(allPlan, reopened.text);
  assert.equal(allProgress, expectedProgress, "The actual helper supplies companion beyond the first page before work/review");

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


test("paired progress writes preserve scope and explicit Senior completion rejects stale evidence", async t => {
  const f = await fixture(t);
  const first = await f.change("new", "senior", { text: openText });
  await assert.rejects(f.change("write", "junior", { text: checkedText }), /Only Senior/);
  const updated = await f.change("progress-write", "junior", { text: "# Progress\nActual focused evidence\n- still blocked: permission\n" });
  assert.equal(updated.text, first.text);
  assert.equal(updated.revision, first.revision);
  assert.notEqual(updated.progressRevision, first.progressRevision);
  await assert.rejects(manageWorkPlan(f.context, { operation: "complete", expectedRevision: first.revision,
    expectedProgressRevision: first.progressRevision }, "review"), { code: "vibe64_work_plan_changed" });
  assert.equal((await readWorkPlan(f.context)).status, "active");
  // This explicit command is the admitted Senior decision, not a server inference of a pass.
  const completed = await f.change("complete", "review");
  assert.equal(completed.status, "completed");
  assert.equal(completed.checked, 0);
  assert.equal(completed.progressText, updated.progressText);
});

test("archive replacement and reopen retain one exact pair and start replacement progress fresh", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: openText });
  await f.change("progress-write", "junior", { text: "# Progress\nOld evidence 🙂\n" });
  const old = await readWorkPlan(f.context);
  const replacement = await f.change("new", "senior", { text: "# Next scope\n- [ ] Verify next requirement", archiveCurrent: true });
  assert.equal(replacement.progressText, "# Progress\n\n");
  const archived = await readWorkPlanPage(f.context, { archiveId: old.artifactRevision });
  assert.equal(archived.text, old.text);
  assert.equal(archived.progressText, old.progressText);
  await f.change("reopen", "senior", { archiveId: old.artifactRevision, archiveCurrent: true });
  assert.equal((await readWorkPlan(f.context)).progressText, old.progressText);
  await f.change("progress-write", "junior", { text: "# Progress\nDifferent evidence\n" });
  const next = await readWorkPlan(f.context);
  assert.equal(next.revision, old.revision);
  assert.notEqual(next.artifactRevision, old.artifactRevision);
  await f.change("archive");
  assert.equal((await readWorkPlanPage(f.context, { archiveId: next.artifactRevision })).progressText, next.progressText);
  assert.equal((await readWorkPlanHistory(f.context)).some(item => item.id === old.artifactRevision), false, "Original reopen moved the old pair out of History");
});

test("paired pages preserve full Unicode and reject progress replacement without changing scope", async t => {
  const f = await fixture(t);
  await f.change("new", "senior", { text: openText });
  await f.change("progress-write", "junior", { text: "# Progress\n" + "🙂 actual evidence\n".repeat(2000) });
  const expected = await readWorkPlan(f.context);
  let page = await readWorkPlanPage(f.context, { limit: 100 });
  const first = page;
  let plan = page.text; let progress = page.progressText;
  while (page.hasMore) {
    page = await readWorkPlanPage(f.context, { offset: page.nextOffset, limit: 100,
      expectedRevision: first.revision, expectedProgressRevision: first.progressRevision });
    assert.ok(Array.from(page.text).length + Array.from(page.progressText).length <= 100);
    plan += page.text; progress += page.progressText;
  }
  assert.equal(plan, expected.text); assert.equal(progress, expected.progressText);
  await f.change("progress-write", "junior", { text: "# Progress\nChanged evidence" });
  await assert.rejects(readWorkPlanPage(f.context, { offset: first.nextOffset, limit: 100,
    expectedRevision: first.revision, expectedProgressRevision: first.progressRevision }), { code: "vibe64_work_plan_changed" });
});

test("full paired agent reads retain detailed implementation instructions beyond the first page", async t => {
  const f = await fixture(t);
  const text = "# Reporting\nUser-friendly summary\n- [ ] Prove privacy\n## Technical details\n" +
    "Follow the existing authorization owner and verify foreign access.\n".repeat(350) +
    "Final implementation constraint: never bypass account isolation.";
  await f.change("new", "senior", { text });
  await f.change("progress-write", "junior", { text: "# Progress\nAcceptance remains open." });
  const expected = await readWorkPlan(f.context);
  let page = await readWorkPlanPage(f.context);
  const first = page;
  assert.equal(page.hasMore, true);
  assert.equal(page.text.includes("Final implementation constraint"), false);
  let plan = page.text; let progress = page.progressText;
  while (page.hasMore) {
    page = await readWorkPlanPage(f.context, { offset: page.nextOffset,
      expectedRevision: first.revision, expectedProgressRevision: first.progressRevision });
    plan += page.text; progress += page.progressText;
  }
  assert.equal(plan, expected.text);
  assert.equal(progress, expected.progressText);
  assert.match(plan, /Final implementation constraint: never bypass account isolation\./);
  assert.deepEqual(await readWorkPlan(f.context), expected, "Presentation/read changes never rewrite Plan");
  for (const role of ["senior", "junior", "review"]) {
    assert.match(workPlanInstructions(role), /MUST read and follow the complete technical section/);
    assert.match(workPlanInstructions(role), /Read every page of BOTH text and progressText/);
  }
});

test("offline pair conversion preserves exact legacy Markdown identities timestamps and inline evidence", () => {
  const text = "Status: completed\n# Frozen\n- [x] Original evidence remains inline 🙂\n";
  const id = createHash("sha256").update(text).digest("hex");
  const archivedAt = "2026-09-29T13:22:41.000Z";
  const original = [{ name: "current.md", text }, { name: "archive/" + id + ".md", text, archivedAt }];
  const copy = structuredClone(original);
  const changes = planProgressUpgradeChanges(original);
  assert.deepEqual(original, copy, "Preflight does not mutate its inputs");
  const after = new Map(original.map(file => [file.name, file]));
  for (const patch of changes) patch.text === null ? after.delete(patch.name) : after.set(patch.name, patch);
  assert.equal(after.get("plan/" + id + ".md").text, text);
  const record = JSON.parse(after.get("archive/" + id + ".json").text);
  assert.equal(record.planRevision, id); assert.equal(record.progressRevision, null);
  assert.equal(record.archivedAt, archivedAt); assert.equal(record.legacyArchive, true);
  assert.deepEqual(planProgressUpgradeChanges([...after.values()]), [], "Converted format retry is unchanged");
  assert.throws(() => planProgressUpgradeChanges([{ name: "archive/" + id + ".md", text: text + "changed", archivedAt }]), /differs/);
  assert.throws(() => planProgressUpgradeChanges([{ name: "current.json", text: "{}" }]), /binding/);
});


test("actual paired offline publisher is read-only then backs up complete current and archived evidence before interrupted retry", async t => {
  const f = await fixture(t);
  const systemRoot = path.join(f.root, "system");
  const projectRuntimeRoot = path.join(systemRoot, "projects", "project");
  const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
  const original = "Status: active\n# Original\n- [ ] Scope stays exact\n\nOld inline verification evidence 🙂\n";
  const id = createHash("sha256").update(original).digest("hex");
  await store.createSession({ sessionId: "plan-session", runtimeKind: "genesis" });
  await store.createSession({ sessionId: "archived-plan", runtimeKind: "genesis" });
  await store.writeSessionConversation("archived-plan", "side", { providerConversationId: "native-side" });
  const scopes = [store.paths("plan-session").sessionRoot, store.paths("archived-plan").sessionRoot,
    path.join(store.paths("archived-plan").conversationsRoot, "side")];
  for (const scope of scopes) {
    await mkdir(path.join(scope, "plans", "archive"), { recursive: true });
    await writeFile(path.join(scope, "plans", "current.md"), original);
    await writeFile(path.join(scope, "plans", "archive", id + ".md"), original);
  }
  await store.writeStatus("archived-plan", VIBE64_SESSION_STATUS.ARCHIVED);
  await store.publishSessionArchive("archived-plan");
  const archiveFile = path.join(store.paths().archivedSessionsRoot, "archived-plan.tar.gz");
  const archiveBefore = await readFile(archiveFile);
  const file = path.join(scopes[0], "plans", "current.md");
  const backupRoot = path.join(systemRoot, "upgrades", "backups", "20261008-plan-progress");
  const options = { systemRoot, backupRoot, report: () => {} };
  await upgradePlanProgress({ ...options, apply: false });
  assert.equal(await readFile(file, "utf8"), original);
  assert.deepEqual(await readFile(archiveFile), archiveBefore);
  await assert.rejects(readFile(path.join(backupRoot, "manifest.json")), { code: "ENOENT" });
  let interrupted = false;
  await assert.rejects(upgradePlanProgress({ ...options, apply: true, report(_level, message) {
    if (!interrupted && message.startsWith("Published state:")) { interrupted = true; throw new Error("controlled publication interruption"); }
  } }), /controlled publication interruption/);
  assert.equal(await readFile(path.join(backupRoot, "before", path.relative(systemRoot, file)), "utf8"), original);
  assert.deepEqual(await readFile(path.join(backupRoot, "before", path.relative(systemRoot, archiveFile))), archiveBefore);
  const manifestBeforeRetry = await readFile(path.join(backupRoot, "manifest.json"));
  await upgradePlanProgress({ ...options, apply: true });
  assert.deepEqual(await readFile(path.join(backupRoot, "manifest.json")), manifestBeforeRetry);
  const current = await readWorkPlan({ runtime: { store }, session: { sessionId: "plan-session" } });
  assert.equal(current.text, original); assert.equal(current.progressText, null);
  assert.equal(current.revision, id);
  assert.equal((await readWorkPlanHistory({ runtime: { store }, session: { sessionId: "plan-session" } }))[0].id, id);
  const exec = promisify(execFile);
  for (const scope of ["archived-plan", "archived-plan/conversations/side"]) {
    assert.equal((await exec("tar", ["-xOf", archiveFile, "./" + scope + "/plans/plan/" + id + ".md"])).stdout, original);
    const saved = JSON.parse((await exec("tar", ["-xOf", archiveFile, "./" + scope + "/plans/archive/" + id + ".json"])).stdout);
    assert.equal(saved.planRevision, id); assert.equal(saved.progressRevision, null); assert.equal(saved.legacyArchive, true);
  }
  await upgradePlanProgress({ ...options, apply: true });
  assert.equal((await readWorkPlan({ runtime: { store }, session: { sessionId: "plan-session" } })).text, original);
});


test("legacy current and archived plans remain exact read-only documents until the explicit pair upgrade", async t => {
  const f = await fixture(t);
  const currentText = "# Existing plan\nStatus: active\n\n- [x] Original recorded acceptance\n\nExact inline evidence stays here.\n";
  const archivedText = currentText.replace("Status: active", "Status: completed");
  const currentPath = workPlanPath(f.context);
  const planRoot = path.dirname(currentPath);
  const archiveId = createHash("sha256").update(archivedText).digest("hex");
  const archivePath = path.join(planRoot, "archive", `${archiveId}.md`);
  await mkdir(path.dirname(archivePath), { recursive: true, mode: 0o700 });
  await writeFile(currentPath, currentText, { mode: 0o600 });
  await writeFile(archivePath, archivedText, { mode: 0o600 });
  const snapshot = async filePath => {
    const info = await lstat(filePath);
    return { bytes: await readFile(filePath), ino: info.ino, mode: info.mode, mtimeMs: info.mtimeMs };
  };
  const beforeCurrent = await snapshot(currentPath);
  const beforeArchive = await snapshot(archivePath);
  assert.equal((await readWorkPlan(f.context)).text, currentText);
  const page = await readWorkPlanPage(f.context);
  assert.equal(page.text, currentText);
  assert.equal(page.progressAvailable, false);
  assert.equal(page.progressText, "");
  const history = await readWorkPlanHistory(f.context);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, archiveId);
  const oldPage = await readWorkPlanPage(f.context, { archiveId });
  assert.equal(oldPage.text, archivedText);
  assert.equal(oldPage.progressAvailable, false);
  await assert.rejects(f.change("progress-write", "junior", { text: "# Progress\n" }), /stopped-service plan-progress upgrade/);
  assert.deepEqual(await snapshot(currentPath), beforeCurrent);
  assert.deepEqual(await snapshot(archivePath), beforeArchive);
  for (const name of ["current.json", "plan", "progress", path.join("archive", `${archiveId}.json`)]) {
    await assert.rejects(lstat(path.join(planRoot, name)), { code: "ENOENT" });
  }
});


test("direct pair readers hold the original per-path queue until referenced documents are consumed before cleanup", async t => {
  for (const reader of ["current", "page", "history"]) {
    const f = await fixture(t);
    await f.change("new", "senior", { text: openText });
    await f.change("progress-write", "junior", { text: `# Progress\nRetained ${reader} evidence\n` });
    const saved = await readWorkPlan(f.context);
    if (reader === "history") {
      await f.change("archive");
      await f.change("new", "senior", { text: "# Replacement\n- [ ] Current requirement\n" });
    }
    const current = await readWorkPlan(f.context);
    const directory = path.dirname(workPlanPath(f.context));
    const recordPath = reader === "history"
      ? path.join(directory, "archive", saved.artifactRevision + ".json")
      : path.join(directory, "current.json");
    const recordText = await readFile(recordPath, "utf8");
    const probe = await open(recordPath, "r");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalRead = prototype.readFile;
    let started;
    const reached = new Promise(resolve => { started = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let captured = false;
    const mock = t.mock.method(prototype, "readFile", async function(...args) {
      const value = await originalRead.apply(this, args);
      if (!captured && value === recordText) {
        captured = true;
        started();
        await held;
      }
      return value;
    });
    let reading;
    let writing;
    try {
      reading = reader === "current" ? readWorkPlan(f.context)
        : reader === "page" ? readWorkPlanPage(f.context) : readWorkPlanHistory(f.context);
      await reached;
      let enteredMutation = false;
      writing = manageWorkPlan(f.context, {
        get operation() { enteredMutation = true; return "progress-write"; },
        expectedRevision: current.revision, expectedProgressRevision: current.progressRevision,
        text: `# Progress\nNew ${reader} evidence\n`
      }, "junior");
      // Drain the original catch().then() scheduling without releasing the held file read.
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(enteredMutation, false, "The queued mutation must not enter while an earlier reader holds captured references");
      release();
      const result = await reading;
      await writing;
      assert.equal(reader === "history" ? result[0].progressRevision : result.progressRevision, saved.progressRevision);
      if (reader !== "history") assert.equal(result.progressText, saved.progressText);
      const superseded = path.join(directory, "progress", current.progressRevision + ".md");
      await assert.rejects(lstat(superseded), { code: "ENOENT" });
      if (reader === "history") {
        assert.equal(await readFile(path.join(directory, "progress", saved.progressRevision + ".md"), "utf8"), saved.progressText,
          "Cleanup retains actual archived evidence rather than keeping every intermediate update");
      }
    } finally {
      release();
      await Promise.allSettled([reading, writing].filter(Boolean));
      mock.mock.restore();
    }
  }
});
