import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { sessionClosingMetadata } from "@local/vibe64-runtime/server/sessionLifecycle";
import { listProjectSessions, readProjectPreview, sendProjectMessage } from "../../packages/vibe64-terminals/src/server/projectMessage.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

test("project messages use only the current selected Main session with fresh access and fire-and-forget delivery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-message-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  await store.createSession({ runtimeKind: "genesis", sessionId: "source" });
  const published = [];
  const actor = { username: "owner" };
  const input = { sourceProject: "online", sourceSession: "source", projectSlug: "jskit-ai", message: "Review and ping me.", messageId: "receipt", actor };
  let open = true, selection = "selected-1", closing = false, denied = false;
  const sent = [];
  const delivery = Promise.withResolvers();
  const failures = [];
  const dependencies = {
    authorize: async (identity, slug) => {
      assert.equal(identity, actor); assert.equal(slug, "jskit-ai");
      if (denied) throw new Error("Access revoked");
      return actor;
    },
    project: {
      runInProjectContext: async (slug, operation, options) => {
        assert.ok(["jskit-ai", "online"].includes(slug)); assert.equal(options.vibe64User, actor); return operation();
      },
      readCurrentProject: async () => ({ runtime: { open } }),
      createRuntime: async () => ({ store: { readCurrentSession: async () => selection ? { sessionId: selection } : null } }),
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      createSessionStore: async () => store
    },
    assertOpen: () => { if (closing) throw new Error("Project is closing"); },
    prepare: async () => {},
    send: async (...args) => { sent.push(args); return delivery.promise; },
    publish: async (sessionId, patch) => { assert.equal(sessionId, "source"); published.push(patch); },
    reportFailure: (error, receipt) => failures.push({ error, receipt })
  };
  let timer;
  const result = await Promise.race([
    sendProjectMessage(input, dependencies),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Sender waited for native delivery")), 500); })
  ]).finally(() => clearTimeout(timer));
  assert.equal(result.accepted, true);
  assert.equal(result.delivered, undefined);
  assert.equal(result.sessionId, "selected-1");
  assert.equal(result.messageId, "receipt");
  assert.match(sent[0][1].message, /^From project online \(session source\)/);
  assert.match(sent[0][1].message, /not new human authorization/);
  assert.match(sent[0][1].message, /message-project online --session source;/);
  assert.equal(sent[0][1].submissionKind, undefined); // Existing owner chooses send or steering.
  assert.equal(sent[0][1].displayMessage, input.message);
  assert.equal(sent[0][1].turnMetadata.projectMessage.direction, "received");
  assert.match(sent[0][1].message, /ask the person once/);
  assert.match(sent[0][1].message, /ordinary chat answer reaches only the person, not the sender/);
  assert.match(sent[0][1].message, /Write naturally in Markdown/);
  assert.match(sent[0][1].message, /not as visible prefixes/);
  assert.equal((await store.readConversationLog("source"))[0].metadata.projectMessage.status, "accepted");
  assert.equal(published[0].payload.conversationLogPatch.type, "upsert-turn");
  selection = "selected-2";
  await sendProjectMessage({ ...input, messageId: "new-receipt" }, dependencies);
  assert.equal(sent[1][0], "selected-2");
  open = false;
  await assert.rejects(sendProjectMessage(input, dependencies), /project is closed/);
  open = true; selection = null;
  await assert.rejects(sendProjectMessage(input, dependencies), /no selected session/);
  selection = "selected-3"; closing = true;
  await assert.rejects(sendProjectMessage(input, dependencies), /closing/);
  closing = false; denied = true;
  await assert.rejects(sendProjectMessage(input, dependencies), /Access revoked/);
  assert.equal(sent.length, 2);
  denied = false;
  dependencies.prepare = async () => { throw new Error("Assistant unavailable"); };
  await assert.rejects(sendProjectMessage(input, dependencies), /Assistant unavailable/);
  assert.equal(sent.length, 2);
  delivery.resolve({ ok: true, delivered: true });
  async function waitForStatus(status, count) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const turns = await store.readConversationLog("source");
      if (turns.filter(turn => turn.metadata?.projectMessage?.status === status).length === count) return turns;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(`Sender history did not reach ${status}`);
  }
  await waitForStatus("delivered", 2);
  assert.equal(failures.length, 0);
  dependencies.prepare = async () => {};
  const failed = Promise.withResolvers();
  dependencies.reportFailure = (error, receipt) => failed.resolve({ error, receipt });
  dependencies.send = async () => { throw new Error("Native start failed later"); };
  const accepted = await sendProjectMessage(input, dependencies);
  assert.equal(accepted.accepted, true);
  const reported = await failed.promise;
  assert.equal(reported.error.message, "Native start failed later");
  assert.equal(reported.receipt.sessionId, "selected-3");
  assert.equal(reported.receipt.messageId, input.messageId);
  await waitForStatus("failed", 1);
  dependencies.send = async () => ({ ok: true });
  await sendProjectMessage({ ...input, messageId: "queued" }, dependencies);
  const turns = await waitForStatus("accepted", 1);
  assert.equal(turns.length, 4, "Receipt updates reuse their original turn");
  selection = "selected-1";
  dependencies.send = async () => ({ ok: true, delivered: true, duplicate: true });
  await sendProjectMessage(input, dependencies);
  assert.equal((await store.readConversationLog("source")).length, 4, "Retries do not duplicate sender history");
  await assert.rejects(sendProjectMessage({ ...input, message: "Changed text" }, dependencies), /different text/);
});

test("the installed helper sends through its bound socket and supplies server-owned origin", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-message-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const service = createAgentSessionCommandService({ logger: silentLogger,
    project: {
      readCurrentProject: async () => ({ slug: "online", projectRoot: root }),
      runInProjectContext: async (slug, operation) => { assert.equal(slug, "online"); return operation(); },
      createSessionStore: async () => ({
        readSessionSourceDescriptor: async () => ({ metadata: { source_path: path.join(root, "sessions/active/source/source"), source_kind: "session_clone", source_path_authority: "managed_session_source" } }),
        readMetadataValue: async () => JSON.stringify({ submittedBy: { username: "owner" } })
      })
    },
    sendProjectMessage: async input => { calls.push(input); return { ok: true, sessionId: "selected", messageId: input.messageId }; },
    stopOwnedExecutions: async () => ({ supported: true, ok: true })
  });
  t.after(() => service.closeAllForSession("source"));
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId: "source", wrapperHostDir: root });
  await prepareAgentHelperCommand({ env: process.env, wrapperHostDir: root });
  const result = await promisify(execFile)(path.join(root, "vibe64-helper"),
    ["session", "message-project", "jskit-ai", "Publish then ping online with the version.", "stable-id"],
    { env: { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL } });
  assert.equal(JSON.parse(result.stdout).sessionId, "selected");
  assert.deepEqual(calls, [{ projectSlug: "jskit-ai", message: "Publish then ping online with the version.",
    messageId: "stable-id", sourceProject: "online", sourceSession: "source", actor: { username: "owner" } }]);
  await promisify(execFile)(path.join(root, "vibe64-helper"),
    ["session", "message-project", "online", "--session", "other-session", "Please check this.", "exact-id"],
    { env: { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL } });
  assert.deepEqual(calls[1], { projectSlug: "online", destinationSessionId: "other-session", message: "Please check this.",
    messageId: "exact-id", sourceProject: "online", sourceSession: "source", actor: { username: "owner" } });
  await assert.rejects(promisify(execFile)(path.join(root, "vibe64-helper"),
    ["session", "message-project", "online", "--session", "other-session"],
    { env: { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL } }), /Usage:/);
  assert.equal(calls.length, 2, "Malformed addressing never reaches the command service");
});

test("exact same-project messages and replies retain their recipients and reject self-delivery without side effects", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-message-siblings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  for (const sessionId of ["a", "b", "other"]) await store.createSession({ runtimeKind: "genesis", sessionId });
  let selected = "other";
  let delivered;
  const sent = [], prepared = [], failures = [];
  const dependencies = {
    authorize: async (actor, project) => { assert.equal(project, "compas-next"); return actor; },
    project: {
      runInProjectContext: async (project, operation) => { assert.equal(project, "compas-next"); return operation(); },
      readCurrentProject: async () => ({ runtime: { open: true } }),
      createRuntime: async () => ({
        listSessionSummaries: options => store.listSessionSummaries(options),
        store: { readSession: store.readSession, readCurrentSession: () => store.readSession(selected) }
      }),
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      createSessionStore: async () => store
    },
    assertOpen: () => {},
    prepare: async (sessionId, options) => { prepared.push(sessionId); assert.equal(options.requireSelectedSession, false); },
    send: async (sessionId, message) => {
      sent.push({ sessionId, message });
      await store.conversationStorage.write(sessionId, async transaction => {
        await transaction.appendMessage(await transaction.nextTurnId(), {
          role: "user", messageId: message.messageId, text: message.displayMessage, at: new Date().toISOString(),
          turnMetadata: message.turnMetadata
        });
      });
      return { ok: true, delivered: true };
    },
    publish: async (_sessionId, patch) => {
      if (patch.payload.conversationLogPatch.turn.metadata.projectMessage.status === "delivered") delivered.resolve();
    },
    reportFailure: error => { failures.push(error); delivered.reject(error); }
  };
  for (const [sourceSession, destinationSessionId] of [["a", "b"], ["b", "a"]]) {
    delivered = Promise.withResolvers();
    const receipt = await sendProjectMessage({ sourceProject: "compas-next", projectSlug: "compas-next",
      sourceSession, destinationSessionId, message: `From ${sourceSession}`, messageId: `from-${sourceSession}` }, dependencies);
    await delivered.promise;
    assert.equal(receipt.sessionId, destinationSessionId);
    assert.equal(sent.at(-1).sessionId, destinationSessionId);
    assert.ok(sent.at(-1).message.message.includes(`message-project compas-next --session ${sourceSession};`));
    const outbound = (await store.readConversationLog(sourceSession)).find(turn => turn.metadata?.projectMessage?.direction === "sent");
    const inbound = (await store.readConversationLog(destinationSessionId)).find(turn => turn.metadata?.projectMessage?.direction === "received");
    assert.equal(outbound.metadata.projectMessage.status, "delivered");
    assert.equal(outbound.metadata.projectMessage.sessionId, destinationSessionId);
    assert.equal(inbound.metadata.projectMessage.sourceSession, sourceSession);
  }
  assert.equal((await store.readConversationLog("other")).length, 0, "The selected session never receives explicit messages");
  selected = "a";
  const input = { sourceProject: "compas-next", projectSlug: "compas-next", sourceSession: "a", message: "Do not send", messageId: "refused" };
  for (const target of [{}, { destinationSessionId: "a" }]) {
    await assert.rejects(sendProjectMessage({ ...input, ...target }, dependencies), { code: "vibe64_project_message_self_delivery" });
  }
  await assert.rejects(sendProjectMessage({ ...input, destinationSessionId: "" }, dependencies), /session ID or name is required/);
  await assert.rejects(sendProjectMessage({ ...input, destinationSessionId: "missing" }, dependencies), { code: "vibe64_project_session_not_found" });
  await store.writeStatus("b", "blocked");
  await assert.rejects(sendProjectMessage({ ...input, destinationSessionId: "b" }, dependencies), /not active/);
  // Production: "mb #87" was accepted, then failed inside the recipient's chat.
  for (const messageId of ["mb #87", "x".repeat(129)]) {
    await assert.rejects(sendProjectMessage({ ...input, sourceSession: "c", destinationSessionId: "b", messageId }, dependencies),
      { code: "vibe64_project_message_id_invalid" });
  }
  assert.deepEqual(prepared, ["b", "a"]);
  assert.equal(sent.length, 2);
  assert.equal((await store.readConversationLog("a")).length, 2, "Rejected messages leave no sender receipts");
  assert.deepEqual(failures, []);
});

test("project-preview returns the other project's current Preview URL through the bound helper", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const service = createAgentSessionCommandService({ logger: silentLogger,
    project: {
      readCurrentProject: async () => ({ slug: "inspector", projectRoot: root }),
      runInProjectContext: async (slug, operation) => { assert.equal(slug, "inspector"); return operation(); },
      createSessionStore: async () => ({
        readSessionSourceDescriptor: async () => ({ metadata: { source_path: path.join(root, "sessions/active/source/source"), source_kind: "session_clone", source_path_authority: "managed_session_source" } }),
        readMetadataValue: async () => JSON.stringify({ submittedBy: { username: "owner" } })
      })
    },
    readProjectPreview: async input => { calls.push(input); return { ok: true, url: "https://v64preview-abc.example.test/?vibe64_preview_token=t" }; },
    stopOwnedExecutions: async () => ({ supported: true, ok: true })
  });
  t.after(() => service.closeAllForSession("source"));
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId: "source", wrapperHostDir: root });
  await prepareAgentHelperCommand({ env: process.env, wrapperHostDir: root });
  const env = { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL };
  const result = await promisify(execFile)(path.join(root, "vibe64-helper"), ["session", "project-preview", "mercbot"], { env });
  assert.equal(result.stdout, "https://v64preview-abc.example.test/?vibe64_preview_token=t\n");
  await promisify(execFile)(path.join(root, "vibe64-helper"), ["session", "project-preview", "mercbot", "--session", "s-2"], { env });
  assert.deepEqual(calls, [
    { projectSlug: "mercbot", sourceProject: "inspector", sourceSession: "source", actor: { username: "owner" } },
    { projectSlug: "mercbot", destinationSessionId: "s-2", sourceProject: "inspector", sourceSession: "source", actor: { username: "owner" } }
  ]);
  await assert.rejects(promisify(execFile)(path.join(root, "vibe64-helper"), ["session", "project-preview", "mercbot", "--session"], { env }), /Usage:/);
  assert.equal(calls.length, 2, "Malformed addressing never reaches the command service");
});

test("readProjectPreview re-reads the Preview, never waits past its bound and refuses closed or own sessions", async () => {
  const actor = { username: "owner" };
  let open = true, session = { sessionId: "mb-1", status: "active" }, statuses = [];
  const launched = [];
  const dependencies = {
    authorize: async (identity, slug) => { assert.equal(identity, actor); assert.equal(slug, "mercbot"); return actor; },
    assertOpen: () => {},
    project: {
      runInProjectContext: async (slug, operation, options) => { assert.equal(slug, "mercbot"); assert.equal(options.vibe64User, actor); return operation(); },
      readCurrentProject: async () => ({ runtime: { open } }),
      createRuntime: async () => ({
        listSessionSummaries: async () => session ? [{ sessionName: session.sessionId, metadata: {}, ...session }] : [],
        store: { readCurrentSession: async () => session }
      }),
      createRuntimeWithoutSource(options) { return this.createRuntime(options); }
    },
    launchTarget: { launchStatus: async id => { launched.push(id); return statuses.shift() || { previewTarget: {} }; } },
    waitMs: 60,
    pollMs: 5
  };
  const input = { projectSlug: "mercbot", sourceProject: "inspector", sourceSession: "source", actor };
  statuses = [{ previewTarget: {} }, { previewTarget: { href: "http://127.0.0.1:49200/?vibe64_preview_token=a" } }];
  assert.deepEqual(await readProjectPreview(input, dependencies),
    { ok: true, projectSlug: "mercbot", sessionId: "mb-1", url: "http://127.0.0.1:49200/?vibe64_preview_token=a" });
  statuses = [{ previewTarget: { href: "http://127.0.0.1:49201/?vibe64_preview_token=b" } }];
  assert.equal((await readProjectPreview(input, dependencies)).url, "http://127.0.0.1:49201/?vibe64_preview_token=b", "A restarted Preview is read fresh");
  statuses = [];
  const started = Date.now();
  await assert.rejects(readProjectPreview(input, dependencies), { code: "vibe64_project_preview_not_running" });
  assert.ok(Date.now() - started < 1000, "A stopped Preview fails within the bound");
  statuses = [{ preview: { stoppedIntent: true }, previewTarget: { href: "http://127.0.0.1:49202/" } }];
  await assert.rejects(readProjectPreview(input, dependencies), { code: "vibe64_project_preview_not_running" });
  statuses = [{ ok: false, error: "Session is closing.", code: "vibe64_session_closing" }];
  await assert.rejects(readProjectPreview(input, dependencies), { code: "vibe64_session_closing" });
  const before = launched.length;
  open = false;
  await assert.rejects(readProjectPreview(input, dependencies), { code: "vibe64_project_preview_project_closed" });
  open = true;
  session = { sessionId: "mb-1", status: "blocked" };
  await assert.rejects(readProjectPreview({ ...input, destinationSessionId: "mb-1" }, dependencies), { code: "vibe64_project_preview_session_unavailable" });
  session = null;
  await assert.rejects(readProjectPreview(input, dependencies), { code: "vibe64_project_preview_session_unavailable" });
  session = { sessionId: "source", status: "active" };
  await assert.rejects(readProjectPreview({ ...input, sourceProject: "mercbot" }, dependencies), { code: "vibe64_project_preview_self" });
  assert.equal(launched.length, before, "Closed, inactive and own sessions never read or start a Preview");
});

const GEOFF = "2026-10-13_23-38-44";
const JOBS = "2026-10-21_06-04-48";

/**
 * A project "compas" whose selected session is Geoff, with one other active
 * session, "new owners jobs", and sessions no message may reach: a blocked
 * one, a closing one and a hidden renewal successor.
 */
async function compasProject(t, extraSessions = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-message-names-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  const sessions = [
    [GEOFF, "Geoff"],
    [JOBS, "new owners jobs"],
    ["2026-10-01_09-00-00", "New Owners Jobs", "blocked"],
    ["2026-10-02_09-00-00", "Closing", "closing"],
    ["2026-10-03_09-00-00", "Renewing", "renewal_pending"],
    ...extraSessions
  ];
  for (const [sessionId, name, state] of sessions) {
    await store.createSession({ runtimeKind: "genesis", sessionId });
    await store.writeSessionLabel(sessionId, name);
    if (state === "blocked") await store.writeStatus(sessionId, "blocked");
    if (state === "closing") {
      for (const [metadataName, value] of Object.entries(sessionClosingMetadata("closing"))) {
        await store.writeMetadataValue(sessionId, metadataName, value);
      }
    }
    if (state === "renewal_pending") await writeFile(store.paths(sessionId).statusPath, "renewal_pending\n");
  }
  const selection = { sessionId: GEOFF };
  const sent = [];
  const deliveredReceipts = [];
  const project = {
    runInProjectContext: async (slug, operation) => { assert.equal(slug, "compas"); return operation(); },
    readCurrentProject: async () => ({ runtime: { open: true } }),
    createRuntimeWithoutSource: async () => ({
      listSessionSummaries: options => store.listSessionSummaries(options),
      store: { readSession: store.readSession, readCurrentSession: () => store.readSession(selection.sessionId) }
    }),
    createSessionStore: async () => store
  };
  const access = { project, authorize: async actor => actor, assertOpen: () => {} };
  const messaging = {
    ...access,
    prepare: async () => {},
    send: async (sessionId, message) => { sent.push({ sessionId, message }); return { ok: true, delivered: true }; },
    publish: async (_sessionId, patch) => {
      if (patch.payload.conversationLogPatch.turn.metadata.projectMessage.status === "delivered") deliveredReceipts.push(patch);
    },
    reportFailure: error => assert.fail(error)
  };
  async function waitForDeliveries(count) {
    for (let attempt = 0; attempt < 100 && deliveredReceipts.length < count; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(deliveredReceipts.length, count);
  }
  return { root, store, selection, sent, access, messaging, waitForDeliveries };
}

test("an assistant finds the other session by listing, or by its name, without anyone giving an ID", async (t) => {
  const compas = await compasProject(t);
  const service = createAgentSessionCommandService({ logger: silentLogger,
    project: {
      readCurrentProject: async () => ({ slug: "compas", projectRoot: compas.root }),
      runInProjectContext: async (slug, operation) => { assert.equal(slug, "compas"); return operation(); },
      createSessionStore: async () => ({
        readSessionSourceDescriptor: async () => ({ metadata: { source_path: path.join(compas.root, `sessions/active/${GEOFF}/source`), source_kind: "session_clone", source_path_authority: "managed_session_source" } }),
        readMetadataValue: async () => JSON.stringify({ submittedBy: { username: "owner" } })
      })
    },
    listProjectSessions: input => listProjectSessions(input, compas.access),
    sendProjectMessage: input => sendProjectMessage(input, compas.messaging),
    stopOwnedExecutions: async () => ({ supported: true, ok: true })
  });
  t.after(() => service.closeAllForSession(GEOFF));
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId: GEOFF, wrapperHostDir: compas.root });
  await prepareAgentHelperCommand({ env: process.env, wrapperHostDir: compas.root });
  const helper = args => promisify(execFile)(path.join(compas.root, "vibe64-helper"), ["session", ...args],
    { env: { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL } });

  // "Send this to the other session": the selected session is the sender itself.
  const refused = await helper(["message-project", "compas", "Please pick up the owners jobs."]).then(
    () => assert.fail("Self-delivery was accepted"), error => error);
  assert.match(refused.stderr, /selected session of compas receives the message, and that is your own session/);
  assert.match(refused.stderr, /run `vibe64-helper session list-project compas`/);
  assert.match(refused.stderr, /--session <id-or-name>/);
  assert.match(refused.stderr, /If exactly one other active session is listed, send to it/);
  assert.doesNotMatch(refused.stderr, /no other recipient exists/);
  assert.equal(compas.sent.length, 0);

  const listed = await helper(["list-project", "compas"]);
  assert.equal(listed.stdout, `${GEOFF}  Geoff  (your session, selected)\n${JOBS}  new owners jobs\n`);
  const { sessions } = JSON.parse((await helper(["list-project", "compas", "--json"])).stdout);
  assert.deepEqual(sessions, [
    { sessionId: GEOFF, sessionName: "Geoff", own: true, selected: true },
    { sessionId: JOBS, sessionName: "new owners jobs", own: false, selected: false }
  ]);
  const others = sessions.filter(session => !session.own);
  assert.equal(others.length, 1, "Exactly one other active session, so the assistant uses it");
  const byId = JSON.parse((await helper(["message-project", "compas", "--session", others[0].sessionId, "Please pick up the owners jobs.", "jobs-1"])).stdout);
  assert.equal(byId.sessionId, JOBS);

  // "Send this to new owners jobs": the name is enough.
  const byName = JSON.parse((await helper(["message-project", "compas", "--session", "New Owners Jobs", "Here is the follow-up.", "jobs-2"])).stdout);
  assert.equal(byName.sessionId, JOBS);
  assert.deepEqual(compas.sent.map(delivery => delivery.sessionId), [JOBS, JOBS]);
  await compas.waitForDeliveries(2);

  for (const malformed of [["list-project"], ["list-project", "compas", "--yaml"], ["list-project", "compas", "--json", "extra"]]) {
    await assert.rejects(helper(malformed), /Usage:/);
  }
  const usage = (await helper(["--help"])).stdout;
  assert.match(usage, /list-project <project> \[--json\]/);
  assert.match(usage, /--session <session-id-or-name>/);
  assert.match(usage, /If exactly one other active session is listed, use it/);

  await compas.store.writeStatus(JOBS, "blocked");
  assert.equal((await helper(["list-project", "compas"])).stdout,
    `${GEOFF}  Geoff  (your session, selected)\nNo other active session of compas can receive a message.\n`);
});

test("--session resolves an exact ID first, then one active session by name, and never falls back to the selection", async (t) => {
  const compas = await compasProject(t, [
    ["2026-10-22_08-00-00", JOBS],
    ["2026-10-23_08-00-00", "Review"],
    ["2026-10-24_08-00-00", "REVIEW"]
  ]);
  compas.selection.sessionId = JOBS;
  const input = { sourceProject: "compas", projectSlug: "compas", sourceSession: GEOFF, message: "Hello", actor: { username: "owner" } };
  const send = (destinationSessionId, messageId) => sendProjectMessage({ ...input, destinationSessionId, messageId }, compas.messaging);

  assert.equal((await send("  new OWNERS jobs ", "name")).sessionId, JOBS, "Names ignore case and spaces; blocked namesakes do not count");
  assert.equal((await send(JOBS, "id")).sessionId, JOBS, "An exact ID wins over a session named like that ID");
  assert.equal((await send("2026-10-22_08-00-00", "other-id")).sessionId, "2026-10-22_08-00-00");

  const ambiguous = await send("review", "ambiguous").then(() => assert.fail("Ambiguous name was accepted"), error => error);
  assert.equal(ambiguous.code, "vibe64_project_session_ambiguous");
  assert.match(ambiguous.message, /2 active sessions of compas are named "review": 2026-10-23_08-00-00 "Review"; 2026-10-24_08-00-00 "REVIEW"/);
  assert.deepEqual(ambiguous.details.candidates.map(candidate => candidate.sessionId), ["2026-10-23_08-00-00", "2026-10-24_08-00-00"]);

  const missing = await send("nobody", "missing").then(() => assert.fail("Unknown name was accepted"), error => error);
  assert.equal(missing.code, "vibe64_project_session_not_found");
  assert.match(missing.message, /compas has no active session with the ID or name "nobody"/);
  assert.match(missing.message, new RegExp(`${GEOFF} "Geoff" \\(your session\\); ${JOBS} "new owners jobs"`));
  assert.equal(missing.details.candidates.length, 5);

  for (const inactiveName of ["Closing", "Renewing"]) {
    await assert.rejects(send(inactiveName, "inactive"), { code: "vibe64_project_session_not_found" });
  }
  await assert.rejects(send("2026-10-01_09-00-00", "blocked"), { code: "vibe64_project_message_session_unavailable" });
  const self = await send("geoff", "self").then(() => assert.fail("Self-delivery was accepted"), error => error);
  assert.equal(self.code, "vibe64_project_message_self_delivery");
  assert.match(self.message, /--session geoff names your own session/);
  assert.equal(compas.sent.length, 3, "Refused addresses never reach the selected session");
  await compas.waitForDeliveries(3);

  const launched = [];
  const preview = { ...compas.access, launchTarget: { launchStatus: async id => { launched.push(id); return { previewTarget: { href: "http://127.0.0.1:49300/" } }; } } };
  const previewInput = { projectSlug: "compas", sourceProject: "compas", sourceSession: GEOFF, actor: input.actor };
  assert.equal((await readProjectPreview({ ...previewInput, destinationSessionId: "new owners jobs" }, preview)).sessionId, JOBS);
  await assert.rejects(readProjectPreview({ ...previewInput, destinationSessionId: "review" }, preview), { code: "vibe64_project_session_ambiguous" });
  await assert.rejects(readProjectPreview({ ...previewInput, destinationSessionId: "Geoff" }, preview), { code: "vibe64_project_preview_self" });
  assert.deepEqual(launched, [JOBS]);

  const listing = await listProjectSessions({ projectSlug: "compas", sourceProject: "other", sourceSession: "x", actor: input.actor }, compas.access);
  assert.deepEqual(listing.sessions.map(session => [session.sessionId, session.own, session.selected]), [
    [GEOFF, false, false], [JOBS, false, true], ["2026-10-22_08-00-00", false, false],
    ["2026-10-23_08-00-00", false, false], ["2026-10-24_08-00-00", false, false]
  ]);
});

test("list-project refuses a closed project and a malformed slug with their own codes", async (t) => {
  const compas = await compasProject(t);
  const closed = { ...compas.access, project: { ...compas.access.project, readCurrentProject: async () => ({ runtime: { open: false } }) } };
  await assert.rejects(listProjectSessions({ projectSlug: "compas", sourceProject: "compas", sourceSession: GEOFF, actor: null }, closed),
    { code: "vibe64_project_sessions_project_closed" });
  await assert.rejects(listProjectSessions({ projectSlug: "Compas!", sourceProject: "compas", sourceSession: GEOFF, actor: null }, compas.access),
    { code: "vibe64_project_sessions_input_required" });
});
