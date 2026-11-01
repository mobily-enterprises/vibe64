import { sessionSourcePath as savedSessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

import {
  PROMPT_HINT_CACHE_MAX_ENTRIES,
  PROMPT_HINT_CACHE_TTL_MS,
  PROMPT_HINT_CONTEXT_VERSION,
  definePromptHintOperationId,
  parsePromptHintSuggestions,
  promptHintBasis,
  promptHintPrompt,
  visibleConversation
} from "./promptHintRules.js";
import { readPromptHintBlueprint, readPromptHintSubsystems } from "./promptHintGenesisFiles.js";
import { createPromptHintState } from "./promptHintState.js";
import { createPromptHintContext } from "./promptHintContext.js";
import { createPromptHintJobs } from "./promptHintJobs.js";
import { createPromptHintRequests } from "./promptHintRequests.js";

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManager.js").createSessionAgentManager>} SessionAgentManager */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/sessionRealtimeEvents").createSessionChangedPublisher>} PublishSessionChanged */

/**
 * A project's prompt hints. Each concern is built once, in dependency order,
 * and the service offers its functions by name.
 * @param {object} dependencies
 * @param {number} [dependencies.cacheMaxEntries]
 * @param {number} [dependencies.cacheTtlMs]
 * @param {SessionAgentManager} dependencies.agent
 * @param {(event: object) => void} dependencies.diagnostic
 * @param {() => number} [dependencies.now]
 * @param {ProjectService} dependencies.projectService
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {typeof readPromptHintBlueprint} [dependencies.readBlueprintText]
 * @param {typeof readPromptHintSubsystems} [dependencies.readSubsystemsText]
 * @param {typeof savedSessionSourcePath} [dependencies.sessionSourcePath]
 */
function createSessionPromptHintsService({
  cacheMaxEntries = PROMPT_HINT_CACHE_MAX_ENTRIES,
  cacheTtlMs = PROMPT_HINT_CACHE_TTL_MS,
  agent,
  diagnostic,
  now = () => Date.now(),
  projectService,
  publishSessionChanged,
  readBlueprintText = readPromptHintBlueprint,
  readSubsystemsText = readPromptHintSubsystems,
  sessionSourcePath = savedSessionSourcePath
}) {
  const state = createPromptHintState({ diagnostic });
  const hintContext = createPromptHintContext({
    agent,
    projectService,
    readBlueprintText,
    readSubsystemsText,
    sessionSourcePath
  });
  const hintJobs = createPromptHintJobs({
    agent,
    cacheMaxEntries,
    cacheTtlMs,
    hintContext,
    now,
    publishSessionChanged,
    state
  });
  const hintRequests = createPromptHintRequests({ hintContext, hintJobs, projectService, state });

  return Object.freeze({
    cancelSessionPromptHints: hintRequests.cancelSessionPromptHints,
    cancelSessionPromptHintsForSession: hintRequests.cancelSessionPromptHintsForSession,
    generateSessionPromptHints: hintRequests.generateSessionPromptHints
  });
}

export {
  PROMPT_HINT_CACHE_MAX_ENTRIES,
  PROMPT_HINT_CACHE_TTL_MS,
  PROMPT_HINT_CONTEXT_VERSION,
  createSessionPromptHintsService,
  definePromptHintOperationId,
  parsePromptHintSuggestions,
  promptHintBasis,
  promptHintPrompt,
  readPromptHintBlueprint,
  readPromptHintSubsystems,
  visibleConversation
};
