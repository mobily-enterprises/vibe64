import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { readProjectPreview, sendProjectMessage } from "../../packages/vibe64-terminals/src/server/projectMessage.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";

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
    projectService: {
      runInProjectContext: async (slug, operation, options) => {
        assert.ok(["jskit-ai", "online"].includes(slug)); assert.equal(options.vibe64User, actor); return operation();
      },
      readCurrentProject: async () => ({ runtime: { open } }),
      createRuntime: async () => ({ store: { readCurrentSession: async () => selection ? { sessionId: selection } : null } }),
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
  const service = createAgentSessionCommandService({
    projectService: {
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
  await prepareAgentHelperCommand({ wrapperHostDir: root });
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
    projectService: {
      runInProjectContext: async (project, operation) => { assert.equal(project, "compas-next"); return operation(); },
      readCurrentProject: async () => ({ runtime: { open: true } }),
      createRuntime: async () => ({ store: { readSession: store.readSession, readCurrentSession: () => store.readSession(selected) } }),
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
  await assert.rejects(sendProjectMessage({ ...input, destinationSessionId: "" }, dependencies), /exact destination session ID/);
  await assert.rejects(sendProjectMessage({ ...input, destinationSessionId: "missing" }, dependencies));
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
  const service = createAgentSessionCommandService({
    projectService: {
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
  await prepareAgentHelperCommand({ wrapperHostDir: root });
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
    projectService: {
      runInProjectContext: async (slug, operation, options) => { assert.equal(slug, "mercbot"); assert.equal(options.vibe64User, actor); return operation(); },
      readCurrentProject: async () => ({ runtime: { open } }),
      createRuntime: async () => ({ store: { readCurrentSession: async () => session, readSession: async id => id === session?.sessionId ? session : null } })
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
  session = { sessionId: "mb-1", status: "archived" };
  await assert.rejects(readProjectPreview({ ...input, destinationSessionId: "mb-1" }, dependencies), { code: "vibe64_project_preview_session_unavailable" });
  session = null;
  await assert.rejects(readProjectPreview(input, dependencies), { code: "vibe64_project_preview_session_unavailable" });
  session = { sessionId: "source", status: "active" };
  await assert.rejects(readProjectPreview({ ...input, sourceProject: "mercbot" }, dependencies), { code: "vibe64_project_preview_self" });
  assert.equal(launched.length, before, "Closed, inactive and own sessions never read or start a Preview");
});
