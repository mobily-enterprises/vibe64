import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import codexLoginId from "./stateUpgrades/20260923-codex-login-id.js";
import routingV2 from "./stateUpgrades/20260923-routing-v2.js";
import nativeConversationLifecycle from "./stateUpgrades/20260925-native-conversation-lifecycle.js";
import assistantRoleNames from "./stateUpgrades/20260926-assistant-role-names.js";

import assistantHelper from "./stateUpgrades/20260927-assistant-helper.js";
import nativeProviderReadiness from "./stateUpgrades/20260927-native-provider-readiness.js";
import completedDiscussionPlan from "./stateUpgrades/20260928-completed-discussion-plan.js";
import planHistory from "./stateUpgrades/20260929-plan-history.js";
import autoImplementationContinuation from "./stateUpgrades/20260930-auto-implementation-continuation.js";
import colleagueConversation from "./stateUpgrades/20261002-colleague-conversation.js";
import sessionConversations from "./stateUpgrades/20261002-session-conversations.js";
import conversationNativeJournal from "./stateUpgrades/20261003-conversation-native-journal.js";
import conversationUndoRetirement from "./stateUpgrades/20261003-conversation-undo-retirement.js";
import trainingPreparation from "./stateUpgrades/20261006-training-preparation.js";
import personalAssistantPreferences from "./stateUpgrades/20261006-personal-assistant-preferences.js";
import routingFormatCompatibility from "./stateUpgrades/20261006-routing-format-compatibility.js";

import colleagueConversationHistory from "./stateUpgrades/20261006-colleague-conversation-history.js";

import trainingAssessments from "./stateUpgrades/20261006-training-assessments.js";
import trainingAttemptHistory from "./stateUpgrades/20261007-training-attempt-history.js";
import trainingQuestionAdmission from "./stateUpgrades/20261007-training-question-admission.js";
import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";
import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";
import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";
import planProgress from "./stateUpgrades/20261008-plan-progress.js";
import colleagueCodexCompletedPolicy from "./stateUpgrades/20261010-colleague-codex-completed-policy.js";
import colleagueNativeContinuity from "./stateUpgrades/20261009-colleague-native-continuity.js";
import colleagueNativeInstructions from "./stateUpgrades/20261010-colleague-native-instructions.js";

import assistantWorkflow from "./stateUpgrades/20261010-assistant-workflow.js";

// Published entries are immutable. Append new upgrades in order; never remove one.

const upgrades = [codexLoginId, routingV2, nativeConversationLifecycle, assistantRoleNames, assistantHelper, nativeProviderReadiness, completedDiscussionPlan, planHistory, autoImplementationContinuation, colleagueConversation, sessionConversations, conversationNativeJournal, conversationUndoRetirement, trainingPreparation, personalAssistantPreferences, routingFormatCompatibility, colleagueConversationHistory, trainingAssessments, trainingAttemptHistory, trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow];

async function readLedger(ledgerPath) {
  let source;
  try {
    source = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, applied: [] };
    throw error;
  }
  let ledger;
  try { ledger = JSON.parse(source); } catch {
    throw new Error("State upgrade ledger is not valid JSON; inspect it before retrying.");
  }
  if (ledger?.version !== 1 || !Array.isArray(ledger.applied) || ledger.applied.length > upgrades.length ||
      ledger.applied.some((entry, index) => entry?.id !== upgrades[index]?.id ||
        typeof entry?.completedAt !== "string" || !Number.isFinite(Date.parse(entry.completedAt)))) {
    throw new Error("State upgrade ledger has unsupported, unordered, or newer history; refusing to upgrade or downgrade.");
  }
  return ledger;
}

async function runStateUpgrades({ systemRoot, apply = false, upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers, upgradeCompletedDiscussionPlan, upgradeAssistantPlans, upgradeColleagueConversations, upgradeSessionConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, inspectConversationUndoRetirement, upgradeLearningPracticeHistory, upgradePlanProgress, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeContinuity, upgradeColleagueNativeInstructions, upgradeAssistantWorkflow,
  report = (level, message) => console.log(`[${level}] ${message}`) }) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) === path.parse(systemRoot).root) {
    throw new Error("State upgrades require an absolute, non-root Vibe64 system directory.");
  }
  const upgradeRoot = path.join(systemRoot, "upgrades");
  const ledgerPath = path.join(upgradeRoot, "applied.json");
  const lockPath = path.join(upgradeRoot, "apply.lock");
  let lock;
  if (apply) {
    await mkdir(upgradeRoot, { recursive: true, mode: 0o700 });
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error("State upgrade lock exists. Check for a running upgrade; remove a stale lock only after confirming it has stopped.");
    }
  }
  try {
    const ledger = await readLedger(ledgerPath);
    const pending = upgrades.slice(ledger.applied.length);
    report("info", `${pending.length} pending state upgrade(s).`);
    const run = (upgrade, write) => upgrade.run({
      systemRoot,
      apply: write,
      // The composition root supplies feature-owned migration operations.
      // Core must not depend back on Accounts or Runtime.
      upgradeAssistantRouting,
      upgradeAssistantRoles,
      upgradeAssistantHelpers,
      upgradeCompletedDiscussionPlan,
      upgradeAssistantPlans,
      upgradeColleagueConversations,
      upgradeSessionConversations,
      upgradeColleagueConversationRuntime,
      upgradeColleagueConversationHistory,
      inspectConversationUndoRetirement,
      upgradeLearningPracticeHistory,
      upgradePlanProgress,
      upgradeColleagueCodexCompletedPolicy,
      upgradeColleagueNativeInstructions,
      upgradeAssistantWorkflow,
      upgradeColleagueNativeContinuity,
      backupRoot: path.join(upgradeRoot, "backups", upgrade.id),
      report: (level, message) => report(level, `${upgrade.id}: ${message}`)
    }).catch(error => {
      throw new Error(`${upgrade.id}: ${error.message}`, { cause: error });
    });
    // Check all pending work before the first mutation. Apply re-reads each input.
    for (const upgrade of pending) await run(upgrade, false);
    if (!apply) return { pending: pending.map(upgrade => upgrade.id), applied: [] };
    const applied = [];
    for (const upgrade of pending) {
      await run(upgrade, true);
      ledger.applied.push({ id: upgrade.id, completedAt: new Date().toISOString() });
      const temporaryPath = `${ledgerPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        await rename(temporaryPath, ledgerPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      applied.push(upgrade.id);
      report("info", `${upgrade.id}: completed and recorded.`);
    }
    return { pending: [], applied };
  } finally {
    if (lock) {
      await lock.close();
      await rm(lockPath);
    }
  }
}

export { runStateUpgrades };
