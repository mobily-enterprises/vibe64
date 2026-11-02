import { sessionSourcePath as savedSessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

import {
  PROMPT_HINT_CACHE_MAX_ENTRIES,
  PROMPT_HINT_CACHE_TTL_MS
} from "./promptHintRules.js";
import { readPromptHintBlueprint, readPromptHintSubsystems } from "./promptHintGenesisFiles.js";
import { createPromptHintState } from "./promptHintState.js";
import { createPromptHintContext } from "./promptHintContext.js";
import { createPromptHintJobs } from "./promptHintJobs.js";
import { createPromptHintRequests } from "./promptHintRequests.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */

/**
 * A project's prompt hints. Each concern is built once, in dependency order,
 * and the service offers its functions by name.
 * @param {object} dependencies
 * @param {number} [dependencies.cacheMaxEntries]
 * @param {number} [dependencies.cacheTtlMs]
 * @param {SessionAgentManager} dependencies.agent
 * @param {(event: object) => void} dependencies.diagnostic
 * @param {() => number} [dependencies.now]
 * @param {ProjectService} dependencies.project
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
  project,
  publishSessionChanged,
  readBlueprintText = readPromptHintBlueprint,
  readSubsystemsText = readPromptHintSubsystems,
  sessionSourcePath = savedSessionSourcePath
}) {
  const state = createPromptHintState({ diagnostic });
  const hintContext = createPromptHintContext({
    agent,
    project,
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
  const hintRequests = createPromptHintRequests({
    hintContext,
    hintJobs,
    project,
    state
  });

  return Object.freeze({
    cancelSessionPromptHints: hintRequests.cancelSessionPromptHints,
    cancelSessionPromptHintsForSession: hintRequests.cancelSessionPromptHintsForSession,
    generateSessionPromptHints: hintRequests.generateSessionPromptHints
  });
}

export {
  createSessionPromptHintsService
};
