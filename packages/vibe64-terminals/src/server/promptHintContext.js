import { rm } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError } from "@local/vibe64-core/server/core";

import { cleanupAssistantHelper } from "./assistantHelperTurn.js";
import {
  PROMPT_HINT_ACTIVE_TASK_IDS,
  PROMPT_HINT_HELPER_PREFIX,
  PROMPT_HINT_RECENT_TURN_LIMIT,
  normalizedPromptHints,
  promptHintFailure,
  sessionStateForHints
} from "./promptHintRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * Reads what prompt hints are based on (the session, its recent conversation,
 * running repository tasks and its Genesis documents), resolves the helper
 * identity hints run as, and keeps the helper's durable record.
 * @param {object} dependencies
 * @param {SessionAgentManager} dependencies.agent
 * @param {ProjectService} dependencies.projectService
 * @param {typeof import("./promptHintGenesisFiles.js").readPromptHintBlueprint} dependencies.readBlueprintText
 * @param {typeof import("./promptHintGenesisFiles.js").readPromptHintSubsystems} dependencies.readSubsystemsText
 * @param {typeof import("@local/vibe64-core/server/sessionSourcePath").sessionSourcePath} dependencies.sessionSourcePath
 */
function createPromptHintContext({
  agent,
  projectService,
  readBlueprintText,
  readSubsystemsText,
  sessionSourcePath
}) {
  async function readGenesisText(reader, sourceRoot = "") {
    try {
      return await reader(sourceRoot);
    } catch (error) {
      if (isMissingPathError(error)) {
        return "";
      }
      throw error;
    }
  }

  async function readContext(sessionId = "") {
    const runtime = await projectService.createRuntime({ inspectSource: false });
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    const sourceRoot = toText(sessionSourcePath(session));
    const [promptHintsResult, conversation, repositoryTasks, blueprint, subsystems] = await Promise.all([
      projectService.readPromptHints(),
      runtime.readConversationLogPage(sessionId, {
        limit: PROMPT_HINT_RECENT_TURN_LIMIT
      }),
      Promise.all(PROMPT_HINT_ACTIVE_TASK_IDS.map((taskId) => (
        runtime.store.readBackgroundTask(sessionId, taskId)
      ))),
      sourceRoot ? readGenesisText(readBlueprintText, sourceRoot) : "",
      sourceRoot ? readGenesisText(readSubsystemsText, sourceRoot) : ""
    ]);
    if (promptHintsResult?.ok === false) {
      throw new Error(promptHintsResult.error || "Project prompt-hint settings could not be read.");
    }
    const repositoryOperationActive = repositoryTasks.some((task) => (
      ["queued", "running", "starting"].includes(toText(task?.status))
    ));
    const sessionState = sessionStateForHints(session, {
      repositoryOperationActive,
      sourceAvailable: Boolean(sourceRoot)
    });
    return {
      blueprint,
      conversation,
      promptHints: normalizedPromptHints(promptHintsResult || {}),
      runtime,
      session,
      sessionState,
      sourceRoot,
      subsystems
    };
  }

  function agentOptions(context, vibe64User) {
    return {
      runtime: context.runtime,
      session: context.session,
      vibe64User
    };
  }

  async function resolvedAgentIdentity(context, vibe64User, cancelled) {
    if (cancelled()) {
      return null;
    }
    const options = agentOptions(context, vibe64User);
    const decision = await agent.resolveAssistantPurpose({ purpose: "prompt_hint" }, options);
    if (cancelled()) return null;
    if (!decision.available) throw Object.assign(new Error(decision.message), { code: decision.reasonCode });
    return {
      selection: decision.effectiveSelection,
      connectionIdentity: decision.connectionIdentity,
      settingsRevision: decision.settingsRevision
    };
  }

  /**
   * The prompt hint helper's durable record. No draft or prompt is ever stored in it.
   */
  function promptHintHelperRecord(context, artifact) {
    const sessionId = context.session.sessionId;
    const store = context.runtime.store;
    return {
      async read() {
        const saved = context.renewalCleanup
          ? await store.readArtifactForRenewal(sessionId, artifact)
          : await store.readArtifact(sessionId, artifact);
        return saved ? JSON.parse(saved) : null;
      },
      write: (helper) => store.writeJsonArtifact(sessionId, artifact, helper),
      async retire() {
        const retire = (paths) => rm(path.join(paths.artifactsRoot, artifact), { force: true });
        if (context.renewalCleanup) await store.mutateSessionForRenewal(sessionId, retire);
        else await store.mutateSession(sessionId, retire);
      }
    };
  }

  function cleanupHelper(context, artifact, vibe64User) {
    return cleanupAssistantHelper({
      agent,
      fail: promptHintFailure,
      prefix: PROMPT_HINT_HELPER_PREFIX,
      record: promptHintHelperRecord(context, artifact),
      stateRoot: context.runtime.stateRoot,
      vibe64User
    });
  }

  return Object.freeze({
    cleanupHelper,
    promptHintHelperRecord,
    readContext,
    resolvedAgentIdentity
  });
}

export {
  createPromptHintContext
};
