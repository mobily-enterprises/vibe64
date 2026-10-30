import { lstat, mkdir, open, readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "./atomicFile.js";
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

import independentProviderCredentials from "./stateUpgrades/20261009-independent-provider-credentials.js";
import colleagueNativeContinuity from "./stateUpgrades/20261009-colleague-native-continuity.js";
import colleagueCodexCompletedPolicy from "./stateUpgrades/20261010-colleague-codex-completed-policy.js";
import colleagueNativeInstructions from "./stateUpgrades/20261010-colleague-native-instructions.js";

import assistantWorkflow from "./stateUpgrades/20261010-assistant-workflow.js";
import colleagueRetiredOperation from "./stateUpgrades/20261012-colleague-retired-operation-receipt.js";
import colleagueInteractiveContinuity from "./stateUpgrades/20261012-colleague-interactive-continuity.js";
import colleagueContinuityScope from "./stateUpgrades/20261012-colleague-continuity-scope.js";
import conversationDraftIdentity from "./stateUpgrades/20261014-conversation-draft-identity.js";
import connectedProjectBindings from "./stateUpgrades/20261015-connected-project-bindings.js";

import claudeRejectedInput from "./stateUpgrades/20261016-claude-rejected-input.js";
import workspaceResourceIdentity from "./stateUpgrades/20261016-workspace-resource-identity.js";
import goalContinuationIntent from "./stateUpgrades/20261016-goal-continuation-intent.js";
import claudeCommandMessages from "./stateUpgrades/20261016-claude-command-messages.js";

// Published entries are immutable. Append new upgrades in order; never remove one.

import claudePausedGoal from "./stateUpgrades/20261017-claude-paused-goal.js";

import claudeBlockedGoal from "./stateUpgrades/20261017-claude-blocked-goal.js";

import learningSpaceReset from "./stateUpgrades/20261022-learning-space-reset.js";

import freeModelRetirement from "./stateUpgrades/20261022-free-model-retirement.js";

import ownerTeamAiSetups from "./stateUpgrades/20261023-owner-team-ai-setups.js";
import retiredTourPreference from "./stateUpgrades/20261023-retired-tour-preference.js";
import retiredProjectBootstrap from "./stateUpgrades/20261025-retired-project-bootstrap.js";
import workspaceAssistantNameOnly from "./stateUpgrades/20261025-workspace-assistant-name-only.js";
import codexUnusedCaches from "./stateUpgrades/20261029-codex-unused-caches.js";
import clonedDefaultBranch from "./stateUpgrades/20261030-cloned-default-branch.js";

const upgrades = [codexLoginId, routingV2, nativeConversationLifecycle, assistantRoleNames, assistantHelper, nativeProviderReadiness, completedDiscussionPlan, planHistory, autoImplementationContinuation, colleagueConversation, sessionConversations, conversationNativeJournal, conversationUndoRetirement, trainingPreparation, personalAssistantPreferences, routingFormatCompatibility, colleagueConversationHistory, trainingAssessments, trainingAttemptHistory, trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly, codexUnusedCaches, clonedDefaultBranch];

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

function requireSystemRoot(systemRoot) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) === path.parse(systemRoot).root) {
    throw new Error("State upgrades require an absolute, non-root Vibe64 system directory.");
  }
}

// One apply.lock excludes ordinary upgrades, explicit repairs, baselines and
// backup retention. busy() answers for a held lock; without it, that is an error.
async function withUpgradeLock(upgradeRoot, operation, { busy = null } = {}) {
  const lockPath = path.join(upgradeRoot, "apply.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (busy) return busy();
    throw new Error("State upgrade lock exists. Check for a running upgrade; remove a stale lock only after confirming it has stopped.");
  }
  try {
    return await operation(lockPath);
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

function writeLedger(ledgerPath, ledger) {
  return writeJsonFileAtomic(ledgerPath, ledger, { fileMode: 0o600 });
}

function ledgerExists(ledgerPath) {
  return lstat(ledgerPath).then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

// Any non-directory entry (file, link, socket) is existing state; a tree of
// empty directories, as host provisioning prepares, is still fresh.
async function containsState(directory, ignoredPath) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entryPath === ignoredPath) continue;
    if (!entry.isDirectory() || await containsState(entryPath, ignoredPath)) return true;
  }
  return false;
}

const BASELINE_LEDGER_EXISTS = "state_upgrade_ledger_exists";
const BASELINE_STATE_WITHOUT_LEDGER = "state_upgrade_state_without_ledger";

// A brand-new installation is created in the current format, so it records
// every upgrade this release knows as complete without running them. Only an
// empty state root qualifies: replaying history against current data fails,
// and recording history over unknown older data would skip needed upgrades.
async function recordStateUpgradeBaseline({ systemRoot, report = (level, message) => console.log(`[${level}] ${message}`) } = {}) {
  requireSystemRoot(systemRoot);
  const upgradeRoot = path.join(systemRoot, "upgrades");
  const ledgerPath = path.join(upgradeRoot, "applied.json");
  const refuseUnlessFresh = async ignoredPath => {
    if (await ledgerExists(ledgerPath)) {
      throw Object.assign(new Error("State upgrade ledger already exists; a baseline is only for a new installation. Use --check/--apply."),
        { code: BASELINE_LEDGER_EXISTS });
    }
    if (await containsState(systemRoot, ignoredPath)) {
      throw Object.assign(new Error(`Vibe64 state without a state upgrade ledger in ${systemRoot}: inspect it before recording history. ` +
        "Its data may already be current, so replaying every upgrade may fail; a baseline would skip upgrades it may still need."),
      { code: BASELINE_STATE_WITHOUT_LEDGER });
    }
  };
  await refuseUnlessFresh();
  await mkdir(upgradeRoot, { recursive: true, mode: 0o700 });
  return withUpgradeLock(upgradeRoot, async lockPath => {
    await refuseUnlessFresh(lockPath);
    const completedAt = new Date().toISOString();
    await writeLedger(ledgerPath, { version: 1, applied: upgrades.map(upgrade => ({ id: upgrade.id, completedAt })) });
    report("info", `Recorded ${upgrades.length} state upgrade(s) as the baseline of a new installation.`);
    return { recorded: upgrades.map(upgrade => upgrade.id) };
  });
}

// The composition root supplies the feature-owned migration operations
// (upgradeAssistantRouting, upgradeLearningPracticeHistory, ...) as the other
// options; each upgrade reads the ones it needs. Core must not depend back on
// Accounts or Runtime.
async function runStateUpgrades({ systemRoot, projectsRoot, managedSourceRoot, apply = false,
  repairRetiredOperation = false, repairInteractiveContinuity = false,
  report = (level, message) => console.log(`[${level}] ${message}`), ...operations }) {
  requireSystemRoot(systemRoot);
  const upgradeRoot = path.join(systemRoot, "upgrades");
  const ledgerPath = path.join(upgradeRoot, "applied.json");
  const upgradeState = async () => {
    // Missing history normally means a legacy installation that predates the
    // ledger. State created by a current release without its baseline is not
    // one, and replaying old upgrades against it fails; say so with the error.
    const ledgerMissingHint = await ledgerExists(ledgerPath) ? "" :
      " This installation has no state upgrade ledger. If a release that already included these upgrades created its state " +
      "(for example, provisioning that skipped the baseline), its data is current: inspect it and record that history " +
      "deliberately as docs/state-upgrades.md describes instead of replaying the upgrades.";
    const ledger = await readLedger(ledgerPath);
    const pending = upgrades.slice(ledger.applied.length);
    report("info", `${pending.length} pending state upgrade(s).`);
    const run = (upgrade, write, backupSuffix = "") => upgrade.run({
      ...operations,
      systemRoot,
      projectsRoot,
      managedSourceRoot,
      apply: write,
      backupRoot: path.join(upgradeRoot, "backups", upgrade.id, backupSuffix),
      report: (level, message) => report(level, `${upgrade.id}: ${message}`)
    }).catch(error => {
      throw new Error(`${upgrade.id}: ${error.message}${ledgerMissingHint}`, { cause: error });
    });
    if (repairRetiredOperation || repairInteractiveContinuity) {
      if (repairRetiredOperation && repairInteractiveContinuity) throw new Error("Choose one explicit Colleague repair at a time.");
      report("warning", "Explicit Colleague repair only; the ordered upgrade ledger is unchanged. Stop all writers before apply, then run ordinary candidate check/apply.");
      await run(repairInteractiveContinuity ? colleagueInteractiveContinuity : colleagueRetiredOperation, apply, "before-continuity-bootstrap");
      return { pending: pending.map(upgrade => upgrade.id), applied: [] };
    }
    // Check all pending work before the first mutation. Apply re-reads each input.
    for (const upgrade of pending) await run(upgrade, false);
    if (!apply) return { pending: pending.map(upgrade => upgrade.id), applied: [] };
    const applied = [];
    for (const upgrade of pending) {
      await run(upgrade, true);
      ledger.applied.push({ id: upgrade.id, completedAt: new Date().toISOString() });
      await writeLedger(ledgerPath, ledger);
      applied.push(upgrade.id);
      report("info", `${upgrade.id}: completed and recorded.`);
    }
    return { pending: [], applied };
  };
  if (!apply) return upgradeState();
  await mkdir(upgradeRoot, { recursive: true, mode: 0o700 });
  return withUpgradeLock(upgradeRoot, upgradeState);
}

// Retention belongs to the registry, not the immutable historical scripts.
// Only a known, completed upgrade's regular backup tree is eligible. The same
// apply.lock excludes ordinary upgrades and explicit repair invocations.
async function maintainStateUpgradeBackups({ systemRoot, dryRun = false, now = Date.now(), signal } = {}) {
  if (!path.isAbsolute(systemRoot || "") || path.resolve(systemRoot) === path.parse(systemRoot).root) {
    throw new Error("Backup retention requires an absolute, non-root Vibe64 system directory.");
  }
  const result = { status: "success", reclaimedBytes: 0, eligibleBytes: 0, retainedBytes: 0, issues: [] };
  const upgradeRoot = path.join(systemRoot, "upgrades");
  const root = path.join(upgradeRoot, "backups");
  try {
    if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) {
      return { ...result, status: "partial", issues: [{ code: "upgrade_backup_path_unverified" }] };
    }
  } catch (error) { if (error.code === "ENOENT") return result; throw error; }
  const busy = () => ({ ...result, status: "busy", issues: [{ code: "upgrade_backup_busy" }] });
  const maintain = async () => {
    const ledger = await readLedger(path.join(upgradeRoot, "applied.json"));
    const completed = new Map(ledger.applied.map(entry => [entry.id, Date.parse(entry.completedAt)]));
    const cutoff = Number(now) - 14 * 86400000;
    if (!Number.isFinite(cutoff)) throw new Error("Invalid backup maintenance time.");
    for (const name of await readdir(root)) {
      signal?.throwIfAborted();
      const target = path.join(root, name);
      const completedAt = completed.get(name);
      if (completedAt === undefined) {
        result.issues.push({ code: "upgrade_backup_completion_unverified" });
        continue;
      }
      let bytes = 0, newest = completedAt, entries = 0;
      const identities = [];
      async function inspect(file) {
        signal?.throwIfAborted();
        if (++entries > 100_000) throw new Error("upgrade_backup_scan_limit");
        const info = await lstat(file);
        if (info.uid !== process.getuid() || info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) ||
            (info.isFile() && info.nlink !== 1)) throw new Error("upgrade_backup_path_unverified");
        if (await realpath(file) !== file) throw new Error("upgrade_backup_path_unverified");
        newest = Math.max(newest, info.mtimeMs, info.ctimeMs);
        identities.push([file, info]);
        if (info.isFile()) bytes += info.blocks * 512;
        else for (const child of await readdir(file)) await inspect(path.join(file, child));
      }
      try {
        await inspect(target);
        if (newest > cutoff) { result.retainedBytes += bytes; continue; }
        for (const [file, original] of identities) {
          signal?.throwIfAborted();
          const current = await lstat(file);
          if (current.ino !== original.ino || current.dev !== original.dev || current.mtimeMs !== original.mtimeMs ||
              current.ctimeMs !== original.ctimeMs) throw new Error("upgrade_backup_changed");
        }
        result.eligibleBytes += bytes;
        if (dryRun) result.retainedBytes += bytes;
        else { await rm(target, { recursive: true }); result.reclaimedBytes += bytes; }
      } catch (error) {
        signal?.throwIfAborted();
        result.retainedBytes += bytes;
        result.issues.push({ code: error.message.startsWith("upgrade_backup_") ? error.message : "upgrade_backup_inspection_failed" });
      }
    }
    if (result.issues.length) result.status = "partial";
    return result;
  };
  if (!dryRun) return withUpgradeLock(upgradeRoot, maintain, { busy });
  // A dry run only reports: it never takes the lock, but respects one held.
  try { await lstat(path.join(upgradeRoot, "apply.lock")); return busy(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return maintain();
}

export { BASELINE_LEDGER_EXISTS, BASELINE_STATE_WITHOUT_LEDGER, maintainStateUpgradeBackups, recordStateUpgradeBaseline, runStateUpgrades };
