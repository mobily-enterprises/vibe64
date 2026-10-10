#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runStateUpgrades } from "@local/vibe64-core/server/stateUpgrades";
import { upgradeAssistantRouting } from "@local/vibe64-accounts/server/assistantRoutingUpgrade";
import { upgradeAssistantHelpers } from "@local/vibe64-accounts/server/assistantHelperUpgrade";
import { upgradeAssistantRoles } from "@local/vibe64-accounts/server/assistantRoleUpgrade";
import { upgradeCompletedDiscussionPlan } from "@local/vibe64-accounts/server/completedDiscussionPlanUpgrade";
import { upgradeAssistantPlans } from "@local/vibe64-accounts/server/assistantPlanUpgrade";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeContinuity, upgradeColleagueNativeInstructions } from "@local/vibe64-colleague/server/conversationUpgrade";
import { upgradeSessionConversations, inspectConversationUndoRetirement } from "@local/vibe64-runtime/server/conversationStorageUpgrade";
import { upgradeLearningPracticeHistory } from "@local/vibe64-training/server/practiceHistoryUpgrade";
import { upgradePlanProgress, upgradeAssistantWorkflow } from "@local/vibe64-terminals/server/assistantPlanProgressUpgrade";

try {
  const { values } = parseArgs({ options: {
    "system-root": { type: "string" },
    check: { type: "boolean" },
    apply: { type: "boolean" }
  } });
  if (Boolean(values.check) === Boolean(values.apply)) {
    throw new Error("Usage: node bin/upgrade-state.js --system-root=/absolute/state/path (--check | --apply). Stop the service before --apply.");
  }
  await runStateUpgrades({
    systemRoot: values["system-root"],
    apply: Boolean(values.apply),
    upgradeAssistantRouting,
    upgradeAssistantRoles,
    upgradeAssistantHelpers,
    upgradeCompletedDiscussionPlan,
    upgradeAssistantPlans,
    upgradeColleagueConversations,
    upgradeSessionConversations,
    upgradeColleagueConversationRuntime,
    upgradeColleagueConversationHistory,
    upgradeColleagueCodexCompletedPolicy,
    upgradeColleagueNativeInstructions,
    upgradeColleagueNativeContinuity,
    inspectConversationUndoRetirement,
    upgradeLearningPracticeHistory,
    upgradePlanProgress,
    upgradeAssistantWorkflow,
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
