import {
  vibe64Error,
  isPlainObject,
  normalizeText,
  plainClone
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

const WORKFLOW_DEFINITION_PART_KIND = "workflow_definition_part";

function cloneStepEntry(entry) {
  return typeof entry === "string" ? normalizeText(entry) : plainClone(entry);
}

function emptyExpansion() {
  return {
    intentHandlers: {},
    steps: []
  };
}

function normalizeIntentHandlers(intentHandlers = {}, context = "") {
  if (intentHandlers === undefined || intentHandlers === null) {
    return {};
  }
  if (!isPlainObject(intentHandlers)) {
    throw vibe64Error(
      `Vibe64 workflow ${context} intentHandlers must be an object.`,
      "vibe64_workflow_definition_part_invalid"
    );
  }

  const normalizedHandlers = {};
  for (const [rawStepId, stepHandlers] of Object.entries(intentHandlers)) {
    const stepId = normalizeText(rawStepId);
    if (!stepId) {
      throw vibe64Error(
        `Vibe64 workflow ${context} intentHandlers contains an empty step id.`,
        "vibe64_workflow_definition_part_invalid"
      );
    }
    if (!isPlainObject(stepHandlers)) {
      throw vibe64Error(
        `Vibe64 workflow ${context} intentHandlers.${stepId} must be an object.`,
        "vibe64_workflow_definition_part_invalid"
      );
    }

    normalizedHandlers[stepId] = {};
    for (const [rawIntentId, handler] of Object.entries(stepHandlers)) {
      const intentId = normalizeText(rawIntentId);
      if (!intentId || typeof handler !== "function") {
        throw vibe64Error(
          `Vibe64 workflow ${context} intentHandlers.${stepId}.${intentId || "(empty)"} must be a function.`,
          "vibe64_workflow_definition_part_invalid"
        );
      }
      normalizedHandlers[stepId][intentId] = handler;
    }
  }
  return normalizedHandlers;
}

function mergeWorkflowIntentHandlers(handlerSets = [], context = "") {
  const merged = {};
  for (const handlerSet of handlerSets) {
    const sourceHandlers = normalizeIntentHandlers(handlerSet, context);
    for (const [stepId, stepHandlers] of Object.entries(sourceHandlers)) {
      merged[stepId] = merged[stepId] || {};
      for (const [intentId, handler] of Object.entries(stepHandlers)) {
        if (Object.hasOwn(merged[stepId], intentId)) {
          throw vibe64Error(
            `Vibe64 workflow ${context} has duplicate intent handler: ${stepId}.${intentId}.`,
            "vibe64_workflow_duplicate_intent_handler"
          );
        }
        merged[stepId][intentId] = handler;
      }
    }
  }
  return merged;
}

function isWorkflowDefinitionPart(part = {}) {
  return isPlainObject(part) && part.kind === WORKFLOW_DEFINITION_PART_KIND;
}

function expandWorkflowPart(part, context = "") {
  if (!part) {
    return emptyExpansion();
  }
  if (Array.isArray(part)) {
    return expandWorkflowParts(part, context);
  }
  if (isWorkflowDefinitionPart(part)) {
    return {
      intentHandlers: normalizeIntentHandlers(part.intentHandlers, `${context} ${part.id}`.trim()),
      steps: (Array.isArray(part.steps) ? part.steps : []).map(cloneStepEntry)
    };
  }
  if (typeof part === "string" || isPlainObject(part)) {
    return {
      intentHandlers: {},
      steps: [cloneStepEntry(part)]
    };
  }
  throw vibe64Error(
    `Vibe64 workflow ${context} contains an invalid workflow definition part.`,
    "vibe64_workflow_definition_part_invalid"
  );
}

function expandWorkflowParts(parts = [], context = "") {
  const expansion = emptyExpansion();
  for (const part of Array.isArray(parts) ? parts : [parts]) {
    const partExpansion = expandWorkflowPart(part, context);
    expansion.steps.push(...partExpansion.steps);
    expansion.intentHandlers = mergeWorkflowIntentHandlers([
      expansion.intentHandlers,
      partExpansion.intentHandlers
    ], context);
  }
  return expansion;
}

function workflowGroup({
  id = "",
  intentHandlers = {},
  steps = []
} = {}) {
  const groupId = normalizeText(id);
  if (!groupId) {
    throw vibe64Error(
      "Vibe64 workflow groups require an id.",
      "vibe64_workflow_definition_part_invalid"
    );
  }

  const expansion = expandWorkflowParts(steps, `group ${groupId}`);
  return deepFreeze({
    id: groupId,
    intentHandlers: mergeWorkflowIntentHandlers([
      expansion.intentHandlers,
      intentHandlers
    ], `group ${groupId}`),
    kind: WORKFLOW_DEFINITION_PART_KIND,
    steps: expansion.steps
  });
}

function workflowWhen(condition, part) {
  return condition ? part : null;
}

function defineWorkflow(definition = {}) {
  const definitionObject = isPlainObject(definition) ? definition : {};
  const workflowId = normalizeText(definitionObject.id);
  if (!workflowId) {
    throw vibe64Error(
      "Vibe64 workflow definitions require an id.",
      "vibe64_workflow_definition_invalid"
    );
  }
  if (Object.hasOwn(definitionObject, "steps") && Object.hasOwn(definitionObject, "parts")) {
    throw vibe64Error(
      `Vibe64 workflow ${workflowId} cannot define both steps and parts.`,
      "vibe64_workflow_definition_invalid"
    );
  }

  const expansion = expandWorkflowParts(
    Object.hasOwn(definitionObject, "parts") ? definitionObject.parts : definitionObject.steps,
    `workflow ${workflowId}`
  );
  const workflow = {
    ...definitionObject,
    id: workflowId,
    intentHandlers: mergeWorkflowIntentHandlers([
      expansion.intentHandlers,
      definitionObject.intentHandlers
    ], `workflow ${workflowId}`),
    steps: expansion.steps
  };
  delete workflow.parts;
  return deepFreeze(workflow);
}

export {
  defineWorkflow,
  workflowGroup,
  workflowWhen
};
