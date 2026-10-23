import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import {
  ACTION_APPROVE_MAIN_CHAT_APPROVAL,
  ACTION_DECLINE_MAIN_CHAT_APPROVAL,
  ACTION_EDIT_MAIN_CHAT_APPROVAL,
  ACTION_READ_MAIN_CHAT_APPROVALS,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_WITHDRAW_MAIN_CHAT_APPROVAL,
  createSessionActions
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  MAIN_CHAT_APPROVALS_METADATA,
  countWaitingMainChatApprovals
} from "../../packages/vibe64-sessions/src/server/mainChatApprovals.js";
import { registerWorkspaceTeamReader } from "../../packages/vibe64-core/src/server/workspaceTeam.js";

const owner = Object.freeze({ username: "tony", role: "owner", preferredName: "Tony" });
const ana = Object.freeze({ username: "ana", role: "member", preferredName: "Ana" });
const bob = Object.freeze({ username: "bob", role: "member", preferredName: "Bob" });

function harness({ turnActive = false, deliver = async () => ({ ok: true, delivered: true }) } = {}) {
  const metadata = new Map();
  let queue = Promise.resolve();
  const store = {
    mutateSession(_sessionId, operation) {
      const run = queue.then(() => operation());
      queue = run.catch(() => {});
      return run;
    },
    async readMetadataValue(_sessionId, name) { return metadata.get(name) || ""; },
    async writeMetadataValue(_sessionId, name, value) { metadata.set(name, value); }
  };
  const runtime = { store, async getSession(sessionId) { return { sessionId, metadata: Object.fromEntries(metadata) }; } };
  const sent = [];
  const sessionEvents = [];
  const projectEvents = [];
  const service = createService({
    project: { async createRuntime() { return runtime; } },
    async publishSessionChanged(sessionId, event) { sessionEvents.push(event.reason); },
    async publishProjectChanged(value, options) { projectEvents.push(options.reason); },
    terminals: {
      async agentSessionState() { return { turn: { active: turnActive } }; },
      async sendAgentMessage(sessionId, input, options) {
        sent.push({ sessionId, input, options });
        return deliver(input, options);
      }
    }
  });
  const entries = () => JSON.parse(metadata.get(MAIN_CHAT_APPROVALS_METADATA) || "{\"entries\":[]}").entries;
  return { service, sent, sessionEvents, projectEvents, entries, metadata };
}

test.before(() => registerWorkspaceTeamReader(async () => ({ available: true, ownerName: "Tony", memberCount: 2 })));

test("a member's main-chat message is queued; the owner's and internal sends go straight through", async () => {
  const { service, sent, sessionEvents, projectEvents, entries } = harness({ turnActive: true });
  const queued = await service.sendAgentMessage("s1", { message: " Add dark mode ", messageId: "message-0001", vibe64User: ana });
  assert.deepEqual(queued, { ok: true, queued: true, approvalId: "message-0001", status: "waiting", sessionId: "s1" });
  assert.equal(sent.length, 0);
  const [entry] = entries();
  assert.deepEqual({ ...entry, createdAt: "", updatedAt: "" }, {
    id: "message-0001", sender: { id: "ana", username: "ana", displayName: "Ana" }, text: "Add dark mode",
    steer: true, status: "waiting", revision: 1, createdAt: "", updatedAt: "", error: ""
  });
  assert.deepEqual(sessionEvents, ["main-chat-approval-queued"]);
  assert.deepEqual(projectEvents, ["main-chat-approvals"]);

  // A retried request with the same identity does not queue twice.
  await service.sendAgentMessage("s1", { message: "Add dark mode", messageId: "message-0001", vibe64User: ana });
  assert.equal(entries().length, 1);

  await service.sendAgentMessage("s1", { message: "Owner message", messageId: "m-owner", vibe64User: owner });
  await service.sendAgentMessage("s1", { message: "Local message", messageId: "m-local" });
  assert.deepEqual(sent.map(({ input }) => input.message), ["Owner message", "Local message"]);
  assert.equal(entries().length, 1);
});

test("queued messages are text only and limited to five waiting per sender", async () => {
  const { service, entries } = harness();
  await assert.rejects(service.sendAgentMessage("s1", { message: "See this", attachmentIds: ["a"], vibe64User: ana }),
    /text only/u);
  for (let index = 0; index < 5; index += 1) {
    await service.sendAgentMessage("s1", { message: `Request ${index}`, vibe64User: ana });
  }
  await assert.rejects(service.sendAgentMessage("s1", { message: "One more", vibe64User: ana }),
    { statusCode: 409, message: "You have 5 messages waiting. Wait for Tony to review them, or withdraw one." });
  await service.sendAgentMessage("s1", { message: "Bob's own", vibe64User: bob });
  const first = entries()[0];
  await service.withdrawMainChatApproval("s1", first.id, { expectedRevision: 1, vibe64User: ana });
  await service.sendAgentMessage("s1", { message: "Now it fits", vibe64User: ana });
  assert.equal(entries().filter((entry) => entry.status === "waiting").length, 6);
});

test("only the sender edits or withdraws a waiting message, at its current revision", async () => {
  const { service, entries, sessionEvents } = harness();
  await service.sendAgentMessage("s1", { message: "First words", messageId: "message-0002", vibe64User: ana });
  await assert.rejects(service.editMainChatApproval("s1", "message-0002", { text: "Bob's words", expectedRevision: 1, vibe64User: bob }),
    { statusCode: 403, message: "Only Ana can change this message." });
  await assert.rejects(service.withdrawMainChatApproval("s1", "message-0002", { expectedRevision: 1, vibe64User: owner }),
    { statusCode: 403 });
  await service.editMainChatApproval("s1", "message-0002", { text: "Better words", expectedRevision: 1, vibe64User: ana });
  assert.equal(entries()[0].text, "Better words");
  assert.equal(entries()[0].revision, 2);
  await assert.rejects(service.withdrawMainChatApproval("s1", "message-0002", { expectedRevision: 1, vibe64User: ana }),
    { statusCode: 409, message: "Ana changed this message. Review it again." });
  await service.withdrawMainChatApproval("s1", "message-0002", { expectedRevision: 2, vibe64User: ana });
  assert.equal(entries()[0].status, "withdrawn");
  await assert.rejects(service.editMainChatApproval("s1", "message-0002", { text: "Late", expectedRevision: 2, vibe64User: ana }),
    { statusCode: 409, message: "This message was already withdrawn." });
  assert.deepEqual(sessionEvents.slice(1), ["main-chat-approval-updated", "main-chat-approval-withdrawn"]);
});

test("only the owner declines, with an optional note", async () => {
  const { service, entries, sessionEvents } = harness();
  await service.sendAgentMessage("s1", { message: "Deploy it", messageId: "message-0003", vibe64User: ana });
  await assert.rejects(service.declineMainChatApproval("s1", "message-0003", { expectedRevision: 1, vibe64User: bob }),
    { statusCode: 403, message: "Only the workspace owner can approve messages." });
  await service.declineMainChatApproval("s1", "message-0003", { expectedRevision: 1, note: "Not now, I'm deploying.", vibe64User: owner });
  const [entry] = entries();
  assert.equal(entry.status, "declined");
  assert.equal(entry.note, "Not now, I'm deploying.");
  assert.deepEqual(entry.decidedBy, { id: "tony", username: "tony", displayName: "Tony" });
  assert.equal(sessionEvents.at(-1), "main-chat-approval-declined");
  await assert.rejects(service.approveMainChatApproval("s1", "message-0003", { expectedRevision: 1, vibe64User: owner }),
    { statusCode: 409, message: "This message was already declined." });
});

test("approval sends the message as the owner with its sender, keeping an edited original", async () => {
  const { service, sent, entries, sessionEvents } = harness();
  await service.sendAgentMessage("s1", { message: "Add a toggel", messageId: "message-0004", vibe64User: ana });
  await assert.rejects(service.approveMainChatApproval("s1", "message-0004", { expectedRevision: 1, vibe64User: ana }),
    { statusCode: 403 });
  const browserAuthority = { sessionId: "s1", actorId: "tony" };
  const result = await service.approveMainChatApproval("s1", "message-0004",
    { expectedRevision: 1, text: "Add a toggle", vibe64User: owner }, { browserAuthority });
  assert.equal(result.ok, true);
  assert.equal(result.status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.message, "Add a toggle");
  assert.equal(sent[0].input.messageId, "approval_message-0004_2", "an edited text is its own delivery");
  assert.match(sent[0].input.messageId, /^[\w-]{1,128}$/u, "conversations accept only word-character message ids");
  assert.equal(sent[0].input.vibe64User, owner);
  assert.equal(sent[0].options.vibe64User, owner);
  assert.equal(sent[0].options.browserAuthority, browserAuthority);
  assert.deepEqual(sent[0].input.turnMetadata, {
    sender: { id: "ana", displayName: "Ana", approvalId: "message-0004", approvedBy: "Tony" }
  });
  const [entry] = entries();
  assert.equal(entry.status, "sent");
  assert.equal(entry.text, "Add a toggle");
  assert.equal(entry.originalText, "Add a toggel");
  assert.deepEqual(sessionEvents.slice(1), ["main-chat-approval-approved", "session-agent-message-accepted", "main-chat-approval-sent"]);
});

test("a failed approval returns to waiting with its error and retries with the same delivery identity", async () => {
  let attempt = 0;
  const { service, sent, entries, metadata } = harness({ deliver: async () => (attempt += 1) === 1
    ? { ok: false, error: "The assistant started another turn. Review it before sending." } : { ok: true } });
  await service.sendAgentMessage("s1", { message: "Fix the header", messageId: "message-0005", vibe64User: ana });
  const failed = await service.approveMainChatApproval("s1", "message-0005", { expectedRevision: 1, vibe64User: owner });
  assert.equal(failed.ok, false);
  assert.equal(entries()[0].status, "waiting");
  assert.equal(entries()[0].error, "The assistant started another turn. Review it before sending.");

  // A send interrupted after approval leaves the entry sending; the owner can
  // approve it again unchanged, but not edit it.
  const stuck = JSON.parse(metadata.get(MAIN_CHAT_APPROVALS_METADATA));
  stuck.entries[0].status = "sending";
  metadata.set(MAIN_CHAT_APPROVALS_METADATA, JSON.stringify(stuck));
  await assert.rejects(service.approveMainChatApproval("s1", "message-0005", { expectedRevision: 1, text: "Fix the footer", vibe64User: owner }),
    { statusCode: 409, code: "vibe64_main_chat_approval_sending" });
  assert.equal(entries()[0].text, "Fix the header");
  assert.equal((await service.approveMainChatApproval("s1", "message-0005", { expectedRevision: 1, vibe64User: owner })).ok, true);
  assert.deepEqual(sent.map(({ input }) => input.messageId), ["approval_message-0005_1", "approval_message-0005_1"]);
  assert.equal(entries()[0].status, "sent");
  assert.equal(entries()[0].error, "");
});

test("everyone with access reads the queue with their own viewer facts", async () => {
  const { service } = harness();
  await service.sendAgentMessage("s1", { message: "Hello", vibe64User: ana });
  const asBob = await service.readMainChatApprovals("s1", { vibe64User: bob });
  assert.equal(asBob.owner, false);
  assert.deepEqual(asBob.viewer, { id: "bob", username: "bob", displayName: "Bob" });
  assert.equal(asBob.ownerName, "Tony");
  assert.equal(asBob.entries.length, 1);
  assert.equal((await service.readMainChatApprovals("s1", {})).owner, true);
});

test("approval operations are people's actions, not assistant tools", () => {
  const actions = createSessionActions({ sessions: {} });
  for (const id of [ACTION_READ_MAIN_CHAT_APPROVALS, ACTION_EDIT_MAIN_CHAT_APPROVAL, ACTION_WITHDRAW_MAIN_CHAT_APPROVAL,
    ACTION_APPROVE_MAIN_CHAT_APPROVAL, ACTION_DECLINE_MAIN_CHAT_APPROVAL]) {
    const definition = actions.find((action) => action.id === id);
    assert.ok(definition, id);
    assert.equal(definition.extensions.assistant, undefined, id);
  }
  const send = actions.find((action) => action.id === ACTION_SEND_AGENT_MESSAGE);
  assert.match(send.extensions.assistant.description, /queues the message for the owner's approval/u);
});

test("project lists count the waiting messages of every open session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-approvals-"));
  try {
    const write = async (sessionId, statuses) => {
      const directory = path.join(root, "sessions", "active", sessionId, "metadata");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, MAIN_CHAT_APPROVALS_METADATA),
        JSON.stringify({ schemaVersion: 1, entries: statuses.map((status) => ({ status })) }));
    };
    assert.equal(await countWaitingMainChatApprovals({ projectRuntimeRoot: root }), 0);
    await write("a", ["waiting", "sent", "waiting"]);
    await write("b", ["declined", "waiting"]);
    await mkdir(path.join(root, "sessions", "active", "c"), { recursive: true });
    assert.equal(await countWaitingMainChatApprovals({ projectRuntimeRoot: root }), 3);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
