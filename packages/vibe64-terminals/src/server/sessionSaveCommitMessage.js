import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileRequest,
  vibe64AgentExecutionProfileAuditSnapshot
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

async function cleanupSessionSaveCommitMessageThread({
  agentContext = {},
  deleteThread,
  executionProfile = null,
  threadId = ""
} = {}) {
  const normalizedThreadId = text(threadId);
  if (!normalizedThreadId) {
    return { ok: true, status: "notFound" };
  }
  if (typeof deleteThread !== "function") {
    throw new TypeError("Commit-message cleanup requires the existing ephemeral assistant lifecycle.");
  }
  const cleanup = await deleteThread({
    executionProfile: sessionSaveExecutionProfileSnapshot(executionProfile) ||
      { ...SESSION_SAVE_COMMIT_EXECUTION_PROFILE },
    threadId: normalizedThreadId
  }, agentContext);
  if (cleanup?.ok !== true) {
    const detail = text(cleanup?.error);
    throw commitMessageError(
      [
        "The temporary naming conversation could not be removed.",
        detail,
        "Cleanup will be retried on the next helper operation; Save can use a checkpoint-based name."
      ].filter(Boolean).join(" "),
      text(cleanup?.code) || "vibe64_session_save_message_cleanup_failed"
    );
  }
  return cleanup;
}

async function generateSessionSaveCommitMessage({
  agentContext = {},
  changes = {},
  deleteThread,
  expectedAccountIdentitySignature = "",
  runAgentTurn
} = {}) {
  if (typeof runAgentTurn !== "function" || typeof deleteThread !== "function") {
    throw new TypeError("Commit-message generation requires the existing ephemeral assistant lifecycle.");
  }
  const accountIdentitySignature = text(expectedAccountIdentitySignature);
  if (!accountIdentitySignature) {
    throw commitMessageError(
      "Save needs a verified assistant account to name this work. Sign in to or reconnect the selected assistant provider, then retry.",
      "vibe64_session_save_message_account_unverified"
    );
  }
  let failure = null;
  let result = null;
  let observedExecutionProfile = null;
  let threadId = "";
  try {
    result = await runAgentTurn({
      ephemeral: true,
      executionProfile: { ...SESSION_SAVE_COMMIT_EXECUTION_PROFILE },
      expectedAccountIdentitySignature: accountIdentitySignature,
      outputSchema: SESSION_SAVE_COMMIT_OUTPUT_SCHEMA,
      prompt: sessionSaveCommitMessagePrompt(changes),
      promptLabel: "Name saved work"
    }, {
      ...agentContext,
      onEvent(event = {}) {
        observedExecutionProfile ||= sessionSaveExecutionProfileSnapshot(event.executionProfile);
        if (event.type === "thread") {
          threadId = text(event.threadId);
        }
      }
    });
    observedExecutionProfile ||= sessionSaveExecutionProfileSnapshot(result?.executionProfile);
    threadId = text(result?.threadId) || threadId;
    if (result?.ok === false) {
      throw commitMessageError(
        text(result.error) || "The assistant could not name this work. Save was not started.",
        text(result.code) || "vibe64_session_save_message_failed"
      );
    }
  } catch (error) {
    failure = error instanceof Error
      ? error
      : commitMessageError("The assistant could not name this work. Save was not started.");
  }

  if (threadId) {
    try {
      await cleanupSessionSaveCommitMessageThread({
        agentContext,
        deleteThread,
        executionProfile: observedExecutionProfile,
        threadId
      });
    } catch (error) {
      const cleanupFailure = error instanceof Error
        ? error
        : commitMessageError("The temporary naming conversation could not be removed. Save was not started.");
      if (failure && cleanupFailure !== failure) {
        cleanupFailure.cause = failure;
      }
      failure = cleanupFailure;
    }
  }

  if (failure) {
    throw failure;
  }
  const executionProfile = sessionSaveExecutionProfileSnapshot(result?.executionProfile);
  if (
    !executionProfile ||
    executionProfile.profileId !== SESSION_SAVE_COMMIT_EXECUTION_PROFILE.profileId ||
    executionProfile.workloadId !== SESSION_SAVE_COMMIT_EXECUTION_PROFILE.workloadId
  ) {
    throw commitMessageError(
      "The low-cost assistant required to name this work did not provide a verified execution profile. Check the selected assistant provider and retry Save.",
      "vibe64_session_save_message_execution_profile_missing"
    );
  }
  return {
    executionProfile,
    subject: parseSessionSaveCommitMessage(result?.text)
  };
}

export {
  MAX_COMMIT_SUBJECT_LENGTH,
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
};
