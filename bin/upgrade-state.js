#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runStateUpgrades } from "@local/vibe64-core/server/stateUpgrades";
import { upgradeAssistantRouting } from "@local/vibe64-accounts/server/assistantRoutingUpgrade";
import { upgradeAssistantHelpers } from "@local/vibe64-accounts/server/assistantHelperUpgrade";
import { upgradeAssistantRoles } from "@local/vibe64-accounts/server/assistantRoleUpgrade";
import { upgradeCompletedDiscussionPlan } from "@local/vibe64-accounts/server/completedDiscussionPlanUpgrade";
import { upgradeAssistantPlans } from "@local/vibe64-accounts/server/assistantPlanUpgrade";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, upgradeColleagueNativeContinuity, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeInstructions, repairColleagueRetiredOperation, upgradeColleagueHistoricalInteractiveContinuity } from "@local/vibe64-colleague/server/conversationUpgrade";
import { upgradeSessionConversations, inspectConversationUndoRetirement } from "@local/vibe64-runtime/server/conversationStorageUpgrade";
import { upgradeLearningPracticeHistory } from "@local/vibe64-training/server/practiceHistoryUpgrade";
import { inspectTrainingStepProgress } from "@local/vibe64-training/server/step-progress-upgrade";
import { upgradePlanProgress, upgradeAssistantWorkflow } from "@local/vibe64-terminals/server/assistantPlanProgressUpgrade";

import { upgradeClaudeCommandMessages } from "@local/vibe64-terminals/server/assistantClaudeCommandUpgrade";
import { upgradeClaudeRejectedInput } from "@local/vibe64-terminals/server/assistantClaudeDeliveryUpgrade";

import { upgradeIndependentProviderCredentials } from "@local/vibe64-accounts/server/providerCredentialsUpgrade";

try {
  const { values } = parseArgs({ options: {
    "system-root": { type: "string" },
    check: { type: "boolean" },
    apply: { type: "boolean" },
    "repair-colleague-retired-operation": { type: "boolean" },
    "repair-colleague-interactive-continuity": { type: "boolean" }
  } });
  if (Boolean(values.check) === Boolean(values.apply)) {
    throw new Error("Usage: node bin/upgrade-state.js --system-root=/absolute/state/path (--check | --apply) [--repair-colleague-retired-operation | --repair-colleague-interactive-continuity]. Stop all writers before --apply.");
  }
  await runStateUpgrades({
    systemRoot: values["system-root"],
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
    inspectTrainingStepProgress,
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
