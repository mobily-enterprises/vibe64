import {
  createStepCompletionToken,
  normalizeStepCompletionToken,
  stepCompletionTokenInstruction
} from "./autopilotPromptContract.js";
import {
  normalizeText
} from "./core.js";

const PROMPT_RUN_STATUS = Object.freeze({
  INJECTED: "injected",
  READY: "ready"
});

const PROMPT_RUN_STATUSES = new Set(Object.values(PROMPT_RUN_STATUS));
const PROMPT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

function createPromptRunId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizePromptRunId(value = "") {
  const id = normalizeText(value);
  return PROMPT_RUN_ID_PATTERN.test(id) ? id : "";
}

function normalizePromptRunOutputStart(value) {
  const outputStart = Number(value);
  return Number.isSafeInteger(outputStart) && outputStart >= 0 ? outputStart : 0;
}

function normalizePromptRunOutputCursor(value, outputStart = 0) {
  const outputCursor = Number(value);
  if (!Number.isSafeInteger(outputCursor) || outputCursor < 0) {
    return normalizePromptRunOutputStart(outputStart);
  }
  return Math.max(normalizePromptRunOutputStart(outputStart), outputCursor);
}

function normalizePromptRunStatus(value = "") {
  const status = normalizeText(value);
  return PROMPT_RUN_STATUSES.has(status) ? status : PROMPT_RUN_STATUS.READY;
}

function normalizePromptRun(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const actionId = normalizeText(record.actionId);
  const stepId = normalizeText(record.stepId);
  const completionToken = normalizeStepCompletionToken(record.completionToken);
  if (!actionId || !stepId || !completionToken) {
    return null;
  }

  const outputStart = normalizePromptRunOutputStart(record.outputStart);
  return {
    actionId,
    actionLabel: normalizeText(record.actionLabel),
    completionToken,
    createdAt: normalizeText(record.createdAt),
    injectedAt: normalizeText(record.injectedAt),
    outputCursor: normalizePromptRunOutputCursor(record.outputCursor, outputStart),
    outputStart,
    promptId: normalizeText(record.promptId),
    requestId: normalizePromptRunId(record.requestId) || completionToken,
    sessionBriefingIncluded: record.sessionBriefingIncluded === true,
    status: normalizePromptRunStatus(record.status),
    stepId
  };
}

function createPromptRun({
  action = {},
  now = new Date(),
  promptId = "",
  sessionBriefingIncluded = false,
  session = {}
} = {}) {
  return normalizePromptRun({
    actionId: action.id,
    actionLabel: action.label,
    completionToken: createStepCompletionToken(),
    createdAt: now.toISOString(),
    outputStart: 0,
    promptId,
    requestId: createPromptRunId(),
    sessionBriefingIncluded,
    status: PROMPT_RUN_STATUS.READY,
    stepId: session.currentStep
  });
}

function appendPromptRunInstruction(prompt = "", promptRun = {}, {
  artifactsRoot = ""
} = {}) {
  const normalizedPrompt = String(prompt || "").trim();
  const instruction = stepCompletionTokenInstruction({
    actionId: promptRun.actionId,
    artifactsRoot,
    requestId: promptRun.requestId,
    stepId: promptRun.stepId,
    token: promptRun.completionToken
  });
  return [normalizedPrompt, instruction]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function promptRunForCurrentStep(session = {}) {
  const promptRun = normalizePromptRun(session.promptRun);
  if (!promptRun || promptRun.stepId !== session.currentStep) {
    return null;
  }
  return promptRun;
}

function promptRunBlocksAction(action = {}, session = {}) {
  if (action.allowRepeatedPromptRuns === true) {
    return false;
  }
  const promptRun = promptRunForCurrentStep(session);
  return Boolean(promptRun && promptRun.actionId === action.id);
}

export {
  PROMPT_RUN_STATUS,
  appendPromptRunInstruction,
  createPromptRun,
  normalizePromptRun,
  promptRunBlocksAction,
  promptRunForCurrentStep
};
