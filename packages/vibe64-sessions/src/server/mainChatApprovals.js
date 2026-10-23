import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isAssistantRoutingOwner } from "@local/vibe64-runtime/shared/assistantRouting";
import { resolveVibe64SessionPaths } from "@local/vibe64-runtime/server/sessionStore";
import { readWorkspaceTeam } from "@local/vibe64-core/server/workspaceTeam";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

// A team member's main-chat messages wait here, in the chat's own state, until
// the workspace owner approves, edits or declines them. Main chat always runs
// on the owner's setup, so an approved message is sent as the owner's.
const MAIN_CHAT_APPROVALS_METADATA = "main_chat_approvals";
const WAITING_PER_SENDER = 5;
const KEPT_ENTRIES = 200;
const NOTE_MAX_LENGTH = 500;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

function text(value = "") {
  return String(value || "").trim();
}

function failure(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function person(vibe64User = null) {
  const id = text(vibe64User?.username || vibe64User?.id);
  if (!id) return null;
  return { id, username: text(vibe64User.username) || id,
    displayName: text(vibe64User.preferredName) || text(vibe64User.displayName) || id };
}

function parseApprovals(raw = "") {
  if (!text(raw)) return { schemaVersion: 1, entries: [] };
  const value = JSON.parse(raw);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    throw failure("This chat's approval queue is unreadable.", "vibe64_main_chat_approvals_invalid", 500);
  }
  return value;
}

// Keeps the newest entries, dropping the oldest decided ones first.
function prune(entries) {
  let excess = entries.length - KEPT_ENTRIES;
  return entries.filter((entry) => excess <= 0 || ["waiting", "sending"].includes(entry.status) || (excess -= 1, false));
}

// The waiting count of every open session of one project, read straight from
// its session state so project lists never start a project runtime.
async function countWaitingMainChatApprovals({ projectRuntimeRoot = "" } = {}) {
  if (!projectRuntimeRoot) return 0;
  const { activeSessionsRoot } = resolveVibe64SessionPaths({ projectRuntimeRoot });
  const sessions = await readdir(activeSessionsRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  let waiting = 0;
  for (const session of sessions) {
    if (!session.isDirectory()) continue;
    const raw = await readFile(path.join(activeSessionsRoot, session.name, "metadata", MAIN_CHAT_APPROVALS_METADATA), "utf8")
      .catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
    try {
      waiting += parseApprovals(raw).entries.filter((entry) => entry.status === "waiting").length;
    } catch {
      // One unreadable queue must not hide the project's other sessions.
    }
  }
  return waiting;
}

function createMainChatApprovals({
  project,
  terminals,
  deliver,
  publishSessionChanged = async () => null,
  publishProjectChanged = async () => null
} = {}) {
  async function change(sessionId, reason, operation, payload = null) {
    const runtime = await project.createRuntime({ inspectSource: false });
    const result = await runtime.store.mutateSession(sessionId, async () => {
      const approvals = parseApprovals(await runtime.store.readMetadataValue(sessionId, MAIN_CHAT_APPROVALS_METADATA));
      const value = await operation(approvals);
      approvals.entries = prune(approvals.entries);
      await runtime.store.writeMetadataValue(sessionId, MAIN_CHAT_APPROVALS_METADATA, JSON.stringify(approvals));
      return value;
    });
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    await publishSessionChanged(sessionId, { reason, session, ...(payload ? { payload } : {}) });
    await publishProjectChanged({ projectSlug: text(currentProjectRequestContext()?.slug) }, { reason: "main-chat-approvals" });
    return result;
  }

  function entryFor(approvals, approvalId) {
    const entry = approvals.entries.find((item) => item.id === approvalId);
    if (!entry) throw failure("This message is no longer in the approval queue.", "vibe64_main_chat_approval_not_found", 404);
    return entry;
  }

  function requireState(entry, states, expectedRevision) {
    if (!states.includes(entry.status)) {
      throw failure(entry.status === "sending" ? "This message is being sent."
        : `This message was already ${entry.status}.`, "vibe64_main_chat_approval_decided", 409);
    }
    if (expectedRevision !== entry.revision) {
      throw failure(`${entry.sender.displayName} changed this message. Review it again.`,
        "vibe64_main_chat_approval_changed", 409);
    }
  }

  function requireSender(entry, vibe64User) {
    if (person(vibe64User)?.id !== entry.sender.id) {
      throw failure(`Only ${entry.sender.displayName} can change this message.`, "vibe64_main_chat_approval_sender_only", 403);
    }
  }

  function requireOwner(vibe64User) {
    if (!isAssistantRoutingOwner(vibe64User)) {
      throw failure("Only the workspace owner can approve messages.", "vibe64_main_chat_approval_owner_only", 403);
    }
  }

  function decided(entry, vibe64User, status) {
    const now = new Date().toISOString();
    Object.assign(entry, { status, updatedAt: now, decidedAt: now,
      decidedBy: person(vibe64User) || { id: "owner", displayName: "Owner" } });
  }

  return Object.freeze({
    async read(sessionId, { vibe64User = null } = {}) {
      const runtime = await project.createRuntime({ inspectSource: false });
      const approvals = parseApprovals(await runtime.store.readMetadataValue(sessionId, MAIN_CHAT_APPROVALS_METADATA));
      const team = await readWorkspaceTeam();
      return { ok: true, sessionId, owner: isAssistantRoutingOwner(vibe64User), viewer: person(vibe64User),
        ownerName: team.ownerName, entries: approvals.entries };
    },

    async enqueue(sessionId, { message, messageId = "", attachmentIds = [] } = {}, { vibe64User }) {
      if (attachmentIds.length) {
        throw failure("Messages for approval are text only. Remove the attachments and send again.",
          "vibe64_main_chat_approval_text_only", 400);
      }
      const sender = person(vibe64User);
      const id = ENTRY_ID_PATTERN.test(messageId) ? messageId : crypto.randomUUID();
      const team = await readWorkspaceTeam();
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      const steer = (await terminals.agentSessionState?.(sessionId, { runtime, session }))?.turn?.active === true;
      return change(sessionId, "main-chat-approval-queued", (approvals) => {
        const existing = approvals.entries.find((entry) => entry.id === id);
        if (existing?.sender.id === sender.id && existing.text === message) {
          return { ok: true, queued: true, approvalId: id, status: existing.status };
        }
        if (existing) throw failure("Send this message again as a new message.", "vibe64_main_chat_approval_exists", 409);
        if (approvals.entries.filter((entry) => entry.status === "waiting" && entry.sender.id === sender.id).length >= WAITING_PER_SENDER) {
          throw failure(`You have ${WAITING_PER_SENDER} messages waiting. Wait for ${team.ownerName || "the owner"} to review them, or withdraw one.`,
            "vibe64_main_chat_approval_limit", 409);
        }
        const now = new Date().toISOString();
        approvals.entries.push({ id, sender, text: message, steer, status: "waiting",
          revision: 1, createdAt: now, updatedAt: now, messageId: `approval:${id}`, error: "" });
        return { ok: true, queued: true, approvalId: id, status: "waiting" };
      }, { approvalId: id, approvalSender: sender.displayName });
    },

    async edit(sessionId, approvalId, { text: nextText, expectedRevision }, { vibe64User }) {
      if (!text(nextText)) throw failure("Write a message, or withdraw it.", "vibe64_agent_message_input_required", 400);
      return change(sessionId, "main-chat-approval-updated", (approvals) => {
        const entry = entryFor(approvals, approvalId);
        requireSender(entry, vibe64User);
        requireState(entry, ["waiting"], expectedRevision);
        Object.assign(entry, { text: text(nextText), revision: entry.revision + 1, updatedAt: new Date().toISOString(), error: "" });
        return { ok: true, entry };
      });
    },

    async withdraw(sessionId, approvalId, { expectedRevision }, { vibe64User }) {
      return change(sessionId, "main-chat-approval-withdrawn", (approvals) => {
        const entry = entryFor(approvals, approvalId);
        requireSender(entry, vibe64User);
        requireState(entry, ["waiting"], expectedRevision);
        decided(entry, vibe64User, "withdrawn");
        return { ok: true, entry };
      });
    },

    async decline(sessionId, approvalId, { expectedRevision, note = "" }, { vibe64User }) {
      requireOwner(vibe64User);
      if (text(note).length > NOTE_MAX_LENGTH) {
        throw failure(`Keep the note under ${NOTE_MAX_LENGTH} characters.`, "vibe64_main_chat_approval_note_invalid", 400);
      }
      return change(sessionId, "main-chat-approval-declined", (approvals) => {
        const entry = entryFor(approvals, approvalId);
        requireState(entry, ["waiting"], expectedRevision);
        decided(entry, vibe64User, "declined");
        entry.note = text(note);
        return { ok: true, entry };
      });
    },

    // Approval hands the message to the owner's ordinary send. Its delivery
    // id is stable per revision: approving a message already sending retries
    // the stored text, and an edited text is a new delivery.
    async approve(sessionId, approvalId, { expectedRevision, text: editedText } = {}, { vibe64User, browserAuthority = null }) {
      requireOwner(vibe64User);
      const entry = await change(sessionId, "main-chat-approval-approved", (approvals) => {
        const current = entryFor(approvals, approvalId);
        requireState(current, ["waiting", "sending"], expectedRevision);
        const edited = text(editedText) && text(editedText) !== current.text;
        if (edited && current.status === "sending") {
          throw failure("This message is being sent. Approve it again to retry it unchanged.", "vibe64_main_chat_approval_sending", 409);
        }
        if (edited) {
          current.originalText ||= current.text;
          current.text = text(editedText);
          current.revision += 1;
        }
        decided(current, vibe64User, "sending");
        current.error = "";
        return { ...current };
      });
      let result;
      try {
        result = await deliver(sessionId, {
          message: entry.text, messageId: `${entry.messageId}:${entry.revision}`, vibe64User,
          turnMetadata: { sender: { id: entry.sender.id, displayName: entry.sender.displayName,
            approvalId: entry.id, approvedBy: entry.decidedBy.displayName } }
        }, browserAuthority ? { browserAuthority } : {});
      } catch (error) {
        result = { ok: false, error: error.message, code: error.code };
      }
      const sent = result?.ok !== false;
      await change(sessionId, sent ? "main-chat-approval-sent" : "main-chat-approval-updated", (approvals) => {
        const current = entryFor(approvals, approvalId);
        Object.assign(current, { status: sent ? "sent" : "waiting", updatedAt: new Date().toISOString(),
          error: sent ? "" : text(result?.error) || "The message could not be sent." });
      });
      return sent ? { ...result, ok: true, approvalId, status: "sent" }
        : { ...result, ok: false, approvalId, status: "waiting" };
    }
  });
}

export { MAIN_CHAT_APPROVALS_METADATA, countWaitingMainChatApprovals, createMainChatApprovals };
