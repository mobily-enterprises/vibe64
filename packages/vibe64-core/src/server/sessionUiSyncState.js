import { randomUUID } from "node:crypto";

import { isPlainObject } from "./core.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const sessionUiSyncStates = new Map();
// Requests for the session's editors to open a page in their Preview, by id,
// while their answers are collected.
const sessionPreviewOpenRequests = new Map();
const PREVIEW_OPEN_ANSWER_TIMEOUT_MS = 4000;
const PREVIEW_OPEN_ANSWER_SETTLE_MS = 750;

function cloneSessionUiSyncRecord(record = null) {
  return isPlainObject(record)
    ? JSON.parse(JSON.stringify(record))
    : null;
}

function sessionUiSyncStateKey(input) {
  const projectSlug = normalizeText(input?.projectSlug);
  const sessionId = normalizeText(input?.sessionId);
  return projectSlug && sessionId ? `${projectSlug}\u0000${sessionId}` : "";
}

function readSessionUiSyncStateForSession(sessionId = "") {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  const state = [...sessionUiSyncStates.values()].find(
    (record) => normalizeText(record?.sessionId) === normalizedSessionId
  );
  return cloneSessionUiSyncRecord(state);
}

function writeSessionUiSyncPatch(input = {}, patch = {}) {
  const key = sessionUiSyncStateKey(input);
  if (!key || !isPlainObject(patch)) {
    return null;
  }
  const base = sessionUiSyncStates.get(key) || {
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(input.sessionId)
  };
  const next = {
    ...base,
    ...patch,
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(input.sessionId)
  };
  sessionUiSyncStates.set(key, next);
  return cloneSessionUiSyncRecord(next);
}

function writeSessionUiSyncPreviewState(previewState) {
  const state = {
    originId: normalizeText(previewState?.originId),
    projectSlug: normalizeText(previewState?.projectSlug),
    route: normalizeText(previewState?.route),
    sessionId: normalizeText(previewState?.sessionId),
    title: normalizeText(previewState?.title),
    updatedAt: normalizeText(previewState?.updatedAt) || new Date().toISOString()
  };
  if (!state.originId || !state.projectSlug || !state.route || !state.sessionId) {
    return null;
  }
  return writeSessionUiSyncPatch(state, {
    preview: state
  });
}

/**
 * Asks the session's editors to open a page in their Preview and collects what
 * each one answers: `send(requestId)` delivers the request, each editor answers
 * once through its Preview state, and the answers are read once none has
 * arrived within `timeoutMs`, or `settleMs` after the first, so a second
 * browser tab can answer too.
 * @param {{
 *   projectSlug: string,
 *   sessionId: string,
 *   send: (requestId: string) => unknown,
 *   settleMs?: number,
 *   timeoutMs?: number
 * }} options
 * @returns {Promise<{ moved: boolean, error: string }[]>}
 */
async function collectSessionPreviewOpenAnswers({
  projectSlug,
  sessionId,
  send,
  settleMs = PREVIEW_OPEN_ANSWER_SETTLE_MS,
  timeoutMs = PREVIEW_OPEN_ANSWER_TIMEOUT_MS
}) {
  const requestId = randomUUID();
  const answers = new Map();
  let settle = () => {};
  const settled = new Promise((resolve) => {
    settle = resolve;
  });
  let settleTimer = null;
  const timeoutTimer = setTimeout(settle, timeoutMs);
  sessionPreviewOpenRequests.set(requestId, {
    projectSlug: normalizeText(projectSlug),
    sessionId: normalizeText(sessionId),
    answer(originId, answer) {
      answers.set(originId, answer);
      settleTimer ??= setTimeout(settle, Math.min(settleMs, timeoutMs));
    }
  });
  try {
    await send(requestId);
    await settled;
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(settleTimer);
    sessionPreviewOpenRequests.delete(requestId);
  }
  return [...answers.values()];
}

/**
 * One editor's answer to a request to open a page in its Preview: whether its
 * Preview moved, else why not. An answer for another session or project, or
 * for a request no longer collected, is ignored.
 * @param {{ error?: string, moved?: boolean, originId?: string, projectSlug?: string, requestId?: string, sessionId?: string }} input
 * @returns {boolean} Whether the answer was counted.
 */
function answerSessionPreviewOpen(input = {}) {
  const request = sessionPreviewOpenRequests.get(normalizeText(input.requestId));
  const originId = normalizeText(input.originId);
  if (
    !request ||
    !originId ||
    request.projectSlug !== normalizeText(input.projectSlug) ||
    request.sessionId !== normalizeText(input.sessionId)
  ) {
    return false;
  }
  request.answer(originId, {
    error: input.moved === true ? "" : normalizeText(input.error).slice(0, 300),
    moved: input.moved === true
  });
  return true;
}

export {
  answerSessionPreviewOpen,
  collectSessionPreviewOpenAnswers,
  readSessionUiSyncStateForSession,
  writeSessionUiSyncPreviewState
};
