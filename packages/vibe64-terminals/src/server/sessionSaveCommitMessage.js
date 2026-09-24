import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileRequest,
  vibe64AgentExecutionProfileAuditSnapshot,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";

const MAX_COMMIT_SUBJECT_LENGTH = 72;
const MAX_PROMPT_FILES = 40;
const MAX_PROMPT_PATH_LENGTH = 180;
const MAX_PROMPT_STATUS_LENGTH = 32;
const SESSION_SAVE_COMMIT_EXECUTION_PROFILE = defineVibe64AgentExecutionProfileRequest({
  profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
  workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
});
const SESSION_SAVE_COMMIT_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    subject: {
      maxLength: MAX_COMMIT_SUBJECT_LENGTH,
      minLength: 1,
      type: "string"
    }
  },
  required: ["subject"],
  type: "object"
});

function text(value = "") {
  return String(value || "").trim();
}

function commitMessageError(message, code = "vibe64_session_save_message_failed") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedPath(value = "") {
  const path = text(value);
  return path.length <= MAX_PROMPT_PATH_LENGTH
    ? path
    : `…${path.slice(-(MAX_PROMPT_PATH_LENGTH - 1))}`;
}

function changeDescription(file = {}) {
  const status = text(file.status || file.changeType || "Changed").slice(0, MAX_PROMPT_STATUS_LENGTH);
  const path = boundedPath(file.path || file.newPath || file.oldPath);
  const added = Number.isFinite(Number(file.added)) ? Number(file.added) : 0;
  const deleted = Number.isFinite(Number(file.deleted)) ? Number(file.deleted) : 0;
  return `- ${status}: ${path} (+${added} -${deleted})`;
}

function sessionSaveCommitMessagePrompt(changes = {}) {
  const files = (Array.isArray(changes.files) ? changes.files : []).slice(0, MAX_PROMPT_FILES);
  const totalCount = Math.max(files.length, Number(changes.totalCount) || 0);
  const omitted = Math.max(0, totalCount - files.length);
  return [
    "Write the Git commit subject for the project changes listed below.",
    "Return the subject in the required structured response.",
    `Use an imperative, specific description of the user-visible or architectural outcome. Maximum ${MAX_COMMIT_SUBJECT_LENGTH} characters.`,
    "Do not use Markdown, quotes, a trailing full stop, issue numbers, or generic wording such as 'save work', 'update files', or 'changes'.",
    "Do not inspect the repository and do not use tools. Base the subject only on this bounded change summary.",
    "",
    `Changed files: ${totalCount}`,
    ...files.map(changeDescription),
    ...(omitted ? [`- …and ${omitted} more changed files`] : [])
  ].join("\n");
}

function parseSessionSaveCommitMessage(value = "") {
  let envelope = value;
  if (typeof value === "string") {
    try {
      envelope = JSON.parse(value);
    } catch {
      throw commitMessageError(
        "The assistant did not return a valid structured commit subject. Save was not started.",
        "vibe64_session_save_message_invalid"
      );
    }
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    Object.keys(envelope).length !== 1 ||
    typeof envelope.subject !== "string"
  ) {
    throw commitMessageError(
      "The assistant did not return a valid structured commit subject. Save was not started.",
      "vibe64_session_save_message_invalid"
    );
  }
  return normalizeSessionSaveCommitMessage(envelope.subject);
}

function sessionSaveExecutionProfileSnapshot(value = null) {
  try {
    return vibe64AgentExecutionProfileAuditSnapshot(value);
  } catch {
    return null;
  }
}

function normalizeSessionSaveCommitMessage(value = "") {
  const subject = text(value);
  const hasControlCharacters = [...subject].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    !subject ||
    subject.length > MAX_COMMIT_SUBJECT_LENGTH ||
    hasControlCharacters ||
    /^([`'"]|[-*#]\s)/u.test(subject) ||
    /([`'"])$/u.test(subject) ||
    /\.$/u.test(subject)
  ) {
    throw commitMessageError(
      "The assistant did not return one valid commit subject. Save was not started.",
      "vibe64_session_save_message_invalid"
    );
  }
  if (/^(save( vibe64)? work|update files|changes)$/iu.test(subject)) {
    throw commitMessageError(
      "The assistant returned a generic commit subject. Save was not started.",
      "vibe64_session_save_message_generic"
    );
  }
  return subject;
}

async function cleanupSessionSaveCommitMessage({ agent, agentContext = {} } = {}) {
  const { runtime, session, vibe64User } = agentContext;
  const sessionId = session.sessionId || session.id;
  const helper = (await runtime.store.readBackgroundTask(sessionId, "save-work"))?.assistantHelper;
  if (!helper) return;
  const root = path.join(runtime.stateRoot, "assistant-helpers", helper.scope.id);
  if (!/^naming_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(root, "workdir") ||
      helper.scope.runtimeRoot !== path.join(root, "runtime")) {
    throw commitMessageError("The saved naming task has invalid cleanup paths.");
  }
  const deleted = await agent.deleteEphemeralConversation(helper.scope, {
    conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
    ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
  }, { assistantSelection: helper.selection, vibe64User });
  if (deleted?.ok !== true) throw commitMessageError(
    deleted?.error || "The naming helper could not be closed. Cleanup will be retried on the next Save or session close.",
    deleted?.code || "vibe64_session_save_message_cleanup_failed"
  );
  await runtime.store.writeBackgroundTaskEvent(sessionId, "save-work", {
    event: { kind: "naming-helper-closed" }, patch: { assistantHelper: null }
  });
  await rm(root, { recursive: true, force: true });
}

async function generateSessionSaveCommitMessage({ agent, agentContext = {}, changes = {} } = {}) {
  const { runtime, session, vibe64User } = agentContext;
  const sessionId = session.sessionId || session.id;
  let helper;
  async function retain() {
    await runtime.store.writeBackgroundTaskEvent(sessionId, "save-work", {
      event: { kind: "naming-helper" }, patch: { assistantHelper: helper }
    });
  }
  const cleanup = () => cleanupSessionSaveCommitMessage({ agent, agentContext });
  // The Save task owns failed cleanup across restarts. Do not lose that record
  // or start another helper until its exact native conversation is closed.
  await cleanup();
  const workflowEngineId = assistantRoutingFromMetadata(session.metadata)?.workflowEngineId ||
    vibe64AssistantSelectionFromMetadata(session.metadata).engineId;
  const decision = await agent.resolveAssistantPurpose({ purpose: "commit_title", workflowEngineId }, agentContext);
  if (!decision.available) throw commitMessageError(decision.message, decision.reasonCode);
  const id = `naming_${randomUUID()}`;
  const root = path.join(runtime.stateRoot, "assistant-helpers", id);
  helper = { scope: { id, environment: {}, runtimeRoot: path.join(root, "runtime"), workdir: path.join(root, "workdir"),
    stableContext: "Write only a commit subject from supplied changes. You have no tools or project access." },
    selection: decision.effectiveSelection, connectionIdentity: decision.connectionIdentity,
    conversationId: "", runId: "", executionId: "" };
  await retain();
  const options = { assistantSelection: helper.selection, vibe64User, expectedConnectionIdentity: helper.connectionIdentity,
    async onEvent(event) {
      if (event.type === "thread") helper.conversationId = text(event.threadId);
      else if (event.type === "turn") helper.runId = text(event.turnId);
      else if (event.type === "helper-execution") helper.executionId = text(event.executionId);
      else return;
      await retain();
    } };
  let result;
  let failure;
  try {
    await mkdir(helper.scope.workdir, { recursive: true });
    await mkdir(helper.scope.runtimeRoot, { recursive: true });
    const executionProfile = await agent.resolveEphemeralExecutionProfile(helper.scope, SESSION_SAVE_COMMIT_EXECUTION_PROFILE, options);
    helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
    await retain();
    result = await agent.runEphemeralChatTurn(helper.scope, {
      executionProfile, outputSchema: SESSION_SAVE_COMMIT_OUTPUT_SCHEMA,
      prompt: sessionSaveCommitMessagePrompt(changes), promptLabel: "Name saved work"
    }, options);
    if (result?.ok !== true) throw commitMessageError(result?.error || "The assistant could not name this work.", result?.code);
  } catch (error) { failure = error; }
  try { await cleanup(); }
  catch (error) { if (failure && error !== failure) error.cause = failure; failure = error; }
  if (failure) throw failure;
  const executionProfile = sessionSaveExecutionProfileSnapshot(result?.executionProfile);
  if (!executionProfile || executionProfile.profileId !== SESSION_SAVE_COMMIT_EXECUTION_PROFILE.profileId ||
      executionProfile.workloadId !== SESSION_SAVE_COMMIT_EXECUTION_PROFILE.workloadId) {
    throw commitMessageError("The naming helper did not provide a verified execution profile.",
      "vibe64_session_save_message_execution_profile_missing");
  }
  return { executionProfile, subject: parseSessionSaveCommitMessage(result.text) };
}

export {
  MAX_COMMIT_SUBJECT_LENGTH,
  cleanupSessionSaveCommitMessage,
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
};
