import { excludeAgentGuidanceFromPracticeHistory, isPracticeProjectRuntime } from "./practiceAgentGuidance.js";
import {
  closeAssistantForChangeover,
  rememberAssistantBeforeChangeover,
  requireCompletedConversationRewind
} from "./assistantChangeover.js";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  GENESIS_BLUEPRINT_PATH,
  genesisProjectContractNeedsAttention,
  inspectGenesisProjectFormat,
  inspectGenesisAgentIntegrations,
  syncGenesisAgentIntegrations,
  syncGenesisSkills
} from "@local/vibe64-genesis/server";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { vibe64AssistantConversationKey, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { sessionHasActiveAgentRun } from "./serviceSessionRecords.js";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceWorkspacePreparation} ServiceWorkspacePreparation */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {typeof import("@local/vibe64-genesis/server").inspectGenesisSkills} InspectAgentSkills */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */

/**
 * What a session's assistant needs before work reaches it: the previous assistant stopped on a
 * changeover, the routing selection prepared, and the agent skills synced inside the agent write.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 * @param {InspectAgentSkills} dependencies.inspectAgentSkills
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.projectService
 * @param {SessionAgentManager} dependencies.sessionAgent
 */
function createServiceAssistantPreparation({
  sessionAccess,
  workspacePreparation,
  inspectAgentSkills,
  logger,
  projectService,
  sessionAgent
}) {
  // Called inside the selection writer's existing session lock. Closing a
  // controller stops observation/execution, never deletes native history.
  async function prepareAssistantChangeover(sessionId, context) {
    requireCompletedConversationRewind(context.session);
    const engineId = vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
    const metadata = context.session.metadata;
    if (engineId === "codex" && metadata.agent_identity_provider === "codex" && metadata.agent_identity_conversation_id) {
      const modelProviderId = metadata.agent_identity_model_provider || "openai";
      const prefix = modelProviderId === "openai" ? "codex" : `codex_${modelProviderId}`;
      await context.runtime.store.writeMetadataValue(sessionId, `${prefix}_conversation_id`, metadata.agent_identity_conversation_id);
      await context.runtime.store.writeMetadataValue(sessionId, `${prefix}_conversation_workdir`, metadata.agent_identity_workdir);
      // Resuming a Codex thread can resume an active native goal. Pause it
      // before that resume so only the user's next Send starts work.
      await context.runtime.store.writeMetadataValue(sessionId, "codex_changeover_pause_goal", "yes");
    }
    const closed = await closeAssistantForChangeover(sessionAgent, sessionId, context);
    if (closed?.ok === false) return closed;
    const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    await rememberAssistantBeforeChangeover(context, vibe64AssistantConversationKey(selection));
    logOperationalEvent(logger, "info", {
      event: "vibe64.assistant_changeover.previous_stopped", component: "vibe64.agent_message", sessionId, engineId
    }, "Previous assistant stopped; its conversation is retained.");
    return { ok: true };
  }

  async function prepareRoutingSelection(sessionId, selection, context) {
    const previous = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    if (previous.engineId !== selection.engineId) {
      const result = await prepareAssistantChangeover(sessionId, context);
      if (result?.ok === false) throw Object.assign(new Error(result.error || "The previous assistant could not stop."), result);
    }
    const preparation = sessionAgent.prepareSelection(sessionId, selection, context);
    if (preparation) await preparation;
  }

  async function prepareAgentSkillsInsideAgentWrite(sessionId, context) {
    await sessionAgent.requireAssistantAccess(sessionId, context);
    if (sessionHasActiveAgentRun(context.session)) return;
    const projectRoot = sessionSourcePath(context.session);
    if (!projectRoot || !existsSync(path.join(projectRoot, GENESIS_BLUEPRINT_PATH))) return;
    const temporary = await sessionAgent.hasActiveTemporaryConversation(sessionId, {}, context);
    if (temporary.active) return;
    const format = await inspectGenesisProjectFormat({ projectRoot });
    if (format.status !== "current") return;
    if (isPracticeProjectRuntime(context.runtime)) await excludeAgentGuidanceFromPracticeHistory(projectRoot);
    let inspection;
    try {
      inspection = await inspectAgentSkills({ projectRoot });
    } catch (error) {
      if (genesisProjectContractNeedsAttention(error)) {
        logOperationalEvent(logger, "warn", {
          code: error.code,
          component: "vibe64.agent_skills",
          event: "vibe64.agent_skills.refresh_deferred",
          sessionId
        }, "Project contracts need repair or a project decision; skill refresh deferred so chat remains available.");
        return;
      }
      if (error?.code !== "AGENT_SKILL_UNAVAILABLE") throw error;
      await workspacePreparation.invalidateWorkspaceSetup(context,
        `${error.message} Run workspace preparation to restore the project's declared dependencies. Chat remains available.`);
      logOperationalEvent(logger, "warn", {
        code: error.code,
        component: "vibe64.agent_skills",
        event: "vibe64.agent_skills.preparation_required",
        sessionId
      }, "Project skill refresh requires workspace preparation.");
      return;
    }
    const guidance = await inspectGenesisAgentIntegrations({ projectRoot });
    const refreshSkills = ["missing", "outdated"].includes(inspection.status);
    if (!refreshSkills && guidance.status === "current") return;
    const result = await projectService.runProjectSourceExclusive(
      async () => {
        const skills = refreshSkills ? await syncGenesisSkills({ projectRoot }) : { changedFiles: [] };
        const integrations = await syncGenesisAgentIntegrations({ projectRoot });
        return { changedFiles: [...integrations.changedFiles, ...skills.changedFiles] };
      },
      { operation: "sync-agent-skills" }
    );
    if (result.changedFiles.length > 0) {
      await sessionAccess.publishTerminalSessionChanged("agentTerminal", sessionId, "agent-skills-updated", {
        changedFiles: result.changedFiles
      });
    }
  }

  return Object.freeze({
    prepareAgentSkillsInsideAgentWrite,
    prepareAssistantChangeover,
    prepareRoutingSelection
  });
}

export {
  createServiceAssistantPreparation
};
