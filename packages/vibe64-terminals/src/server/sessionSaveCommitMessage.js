import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileRequest
} from "@local/vibe64-runtime/shared";

import { cleanupSessionNamingHelper, runSessionNamingHelper } from "./sessionNamingHelper.js";

const MAX_COMMIT_SUBJECT_LENGTH = 72;
const MAX_PROMPT_FILES = 40;
const MAX_PROMPT_PATH_LENGTH = 180;
const MAX_PROMPT_STATUS_LENGTH = 32;
const SESSION_SAVE_COMMIT_EXECUTION_PROFILE = defineVibe64AgentExecutionProfileRequest({
  profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
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

function commitMessageError(message, code, suffix = "failed") {
  const error = new Error(message);
  error.code = code || `vibe64_session_save_message_${suffix}`;
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

function cleanupSessionSaveCommitMessage({ agent, agentContext = {} } = {}) {
  return cleanupSessionNamingHelper({ agent, agentContext, taskId: "save-work", namingError: commitMessageError });
}

async function generateSessionSaveCommitMessage({ agent, agentContext = {}, changes = {} } = {}) {
  const result = await runSessionNamingHelper({
    agent, agentContext, taskId: "save-work",
    profile: SESSION_SAVE_COMMIT_EXECUTION_PROFILE, outputSchema: SESSION_SAVE_COMMIT_OUTPUT_SCHEMA,
    prompt: sessionSaveCommitMessagePrompt(changes), promptLabel: "Name saved work",
    stableContext: "Write only a commit subject from supplied changes. You have no tools or project access.",
    namingError: commitMessageError
  });
  return { executionProfile: result.executionProfile, subject: parseSessionSaveCommitMessage(result.text) };
}

export {
  MAX_COMMIT_SUBJECT_LENGTH,
  cleanupSessionSaveCommitMessage,
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
};
