#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runStateUpgrades } from "@local/vibe64-core/server/stateUpgrades";
import { upgradeAssistantRouting } from "@local/vibe64-accounts/server/assistantRoutingUpgrade";
import { upgradeAssistantHelpers } from "@local/vibe64-accounts/server/assistantHelperUpgrade";
import { upgradeAssistantRoles } from "@local/vibe64-accounts/server/assistantRoleUpgrade";
import { upgradeCompletedDiscussionPlan } from "@local/vibe64-accounts/server/completedDiscussionPlanUpgrade";
import { upgradeAssistantPlans } from "@local/vibe64-accounts/server/assistantPlanUpgrade";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, upgradeColleagueNativeContinuity, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeInstructions, repairColleagueRetiredOperation, upgradeColleagueHistoricalInteractiveContinuity, retireColleagueLearningWatches, retireColleagueFreeModel } from "@local/vibe64-colleague/server/conversationUpgrade";
import { upgradeSessionConversations, inspectConversationUndoRetirement } from "@local/vibe64-runtime/server/conversationStorageUpgrade";
import { upgradeLearningPracticeHistory } from "@local/vibe64-training/server/practiceHistoryUpgrade";
import { resetLearningForLearningSpace } from "@local/vibe64-training/server/learningSpaceResetUpgrade";
import { resolveVibe64ManagedSourceRoot } from "@local/vibe64-core/server/studioRoots";
import { upgradePlanProgress, upgradeAssistantWorkflow } from "@local/vibe64-terminals/server/assistantPlanProgressUpgrade";

import { upgradeClaudeCommandMessages } from "@local/vibe64-terminals/server/assistantClaudeCommandUpgrade";
import { upgradeClaudeRejectedInput } from "@local/vibe64-terminals/server/assistantClaudeDeliveryUpgrade";

import { upgradeIndependentProviderCredentials } from "@local/vibe64-accounts/server/providerCredentialsUpgrade";
import { retireFreeModelRouting } from "@local/vibe64-accounts/server/freeModelRetirementUpgrade";

try {
  const { values } = parseArgs({ options: {
    "system-root": { type: "string" },
    "projects-root": { type: "string" },
    check: { type: "boolean" },
    apply: { type: "boolean" },
    "repair-colleague-retired-operation": { type: "boolean" },
    "repair-colleague-interactive-continuity": { type: "boolean" }
  } });
  if (Boolean(values.check) === Boolean(values.apply)) {
    throw new Error("Usage: node bin/upgrade-state.js --system-root=/absolute/state/path [--projects-root=/absolute/hosted/projects] (--check | --apply) [--repair-colleague-retired-operation | --repair-colleague-interactive-continuity]. Stop all writers before --apply.");
  }
  await runStateUpgrades({
    systemRoot: values["system-root"],
    // Hosted sessions live in their catalogue namespace; local ones under the
    // managed source root, resolved as runtime resolves it.
    ...(values["projects-root"] ? { projectsRoot: values["projects-root"] } : { managedSourceRoot: resolveVibe64ManagedSourceRoot() }),
    apply: Boolean(values.apply),
    repairRetiredOperation: Boolean(values["repair-colleague-retired-operation"]),
    repairInteractiveContinuity: Boolean(values["repair-colleague-interactive-continuity"]),
    upgradeAssistantRouting,
    upgradeAssistantRoles,
    upgradeAssistantHelpers,
    upgradeCompletedDiscussionPlan,
    upgradeAssistantPlans,
    upgradeColleagueConversations,
    upgradeSessionConversations,
    upgradeColleagueConversationRuntime,
    upgradeColleagueConversationHistory,
    upgradeColleagueNativeContinuity,
    upgradeColleagueCodexCompletedPolicy,
    upgradeColleagueNativeInstructions,
    repairColleagueRetiredOperation,
    upgradeColleagueHistoricalInteractiveContinuity,
    inspectConversationUndoRetirement,
    upgradeLearningPracticeHistory,
    resetLearningForLearningSpace,
    retireColleagueLearningWatches,
    retireFreeModelRouting,
    retireColleagueFreeModel,
    upgradePlanProgress,
    upgradeAssistantWorkflow,
    upgradeClaudeRejectedInput,
    upgradeClaudeCommandMessages,
    upgradeIndependentProviderCredentials,
    report: (level, message) => {
      const line = `[vibe64-upgrade] ${level.toUpperCase()}: ${message}`;
      if (level === "warning") console.error(line);
      else console.log(line);
    }
  });
} catch (error) {
  console.error(`[vibe64-upgrade] ERROR: ${error.message}`);
  process.exitCode = 1;
}
