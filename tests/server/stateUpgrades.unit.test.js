import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BASELINE_LEDGER_EXISTS, BASELINE_STATE_WITHOUT_LEDGER, recordStateUpgradeBaseline, runStateUpgrades as runRegistryUpgrades } from "../../packages/vibe64-core/src/server/stateUpgrades.js";
import { upgradeSessionConversations, inspectConversationUndoRetirement } from "../../packages/vibe64-runtime/src/server/conversationStorageUpgrade.js";
import { upgradeColleagueConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeContinuity, upgradeColleagueNativeInstructions, repairColleagueRetiredOperation, upgradeColleagueHistoricalInteractiveContinuity } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";
import { upgradeAssistantHelpers } from "../../packages/vibe64-accounts/src/server/assistantHelperUpgrade.js";
import { upgradeAssistantPlans } from "../../packages/vibe64-terminals/src/server/assistantPlanUpgrade.js";
import { upgradeCompletedDiscussionPlan } from "../../packages/vibe64-terminals/src/server/completedDiscussionPlanUpgrade.js";
import { upgradeAssistantRoles } from "../../packages/vibe64-accounts/src/server/assistantRoleUpgrade.js";
import { upgradeAssistantRouting } from "../../packages/vibe64-accounts/src/server/assistantRoutingUpgrade.js";
import { upgradeIndependentProviderCredentials as clearProviderCredentials } from "../../packages/vibe64-accounts/src/server/providerCredentialsUpgrade.js";
import { readCodexLoginId } from "../../packages/vibe64-core/src/server/codexAuthState.js";
import { CodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { buildNodeBundle } from "../../tooling/release/server-build.mjs";
import { RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";

const exec = promisify(execFile);
const id = "20260923-codex-login-id";
const routingId = "20260923-routing-v2";
const trainingId = "20261006-training-preparation";
const assessmentsId = "20261006-training-assessments";
const attemptHistoryId = "20261007-training-attempt-history";
const questionAdmissionId = "20261007-training-question-admission";
const personalVoicePolicyId = "20261008-personal-voice-policy";
const learningPracticeSessionsId = "20261008-learning-practice-sessions";
const practiceHistoryId = "20261008-learning-practice-history";
const planProgressId = "20261008-plan-progress";
const independentCredentialsId = "20261009-independent-provider-credentials";
const retiredOperationId = "20261012-colleague-retired-operation-receipt";
const interactiveContinuityId = "20261012-colleague-interactive-continuity";
const continuityScopeId = "20261012-colleague-continuity-scope";
const conversationDraftIdentityId = "20261014-conversation-draft-identity";
const connectedProjectBindingsId = "20261015-connected-project-bindings";
const claudeRejectedInputId = "20261016-claude-rejected-input";
const workspaceResourceIdentityId = "20261016-workspace-resource-identity";
const goalContinuationIntentId = "20261016-goal-continuation-intent";
const claudeCommandMessagesId = "20261016-claude-command-messages";
const claudeBlockedGoalId = "20261017-claude-blocked-goal";
const claudePausedGoalId = "20261017-claude-paused-goal";
const learningSpaceResetId = "20261022-learning-space-reset";
const freeModelRetirementId = "20261022-free-model-retirement";
const teamSetupsId = "20261023-owner-team-ai-setups";
const retiredTourPreferenceId = "20261023-retired-tour-preference";
const retiredProjectBootstrapId = "20261025-retired-project-bootstrap";
const workspaceAssistantNameOnlyId = "20261025-workspace-assistant-name-only";
// Earlier registry fixtures have no Learning state; the real owners are
// exercised by the learning-space reset boundary case below and their own files.
const resetLearningForLearningSpace = async () => {};
const retireColleagueLearningWatches = async () => {};
// The free-model retirement owners have their own focused files.
const retireFreeModelRouting = async () => {};
const retireColleagueFreeModel = async () => {};
// So do the owner/team AI setups owners (teamSetupUpgrade.unit.test.js).
const upgradeTeamSetupSessions = async () => {};
const upgradeTeamSetupRouting = async () => {};
const runUpgrades = options => runRegistryUpgrades({ resetLearningForLearningSpace, retireColleagueLearningWatches,
  retireFreeModelRouting, retireColleagueFreeModel, upgradeTeamSetupSessions, upgradeTeamSetupRouting, ...options });
// Historical registry fixtures do not clear credentials; the real reset is
// exercised by its original companion and providerCredentialsUpgrade.unit.test.js.
const upgradeIndependentProviderCredentials = async () => {};
// Original prospective registry fixtures intentionally use opaque invalid
// Training records. They exercise their original boundaries, not the new
// historical owner. Real production validation is covered below and in the
// original Learner/Store files; production never skips these corrupt records.
const upgradeLearningPracticeHistory = async () => {};
// Earlier upgrade fixtures retain their original files; the new paired owner
// has separate registry and actual publisher cases, never a production bypass.
const upgradePlanProgress = async () => {};
// This prospective registry fixture does not convert saved workflows; the real
// backed-up Main/temporary/archive publisher is tested in assistantWorkflowUpgrade.
const upgradeAssistantWorkflow = async () => {};
const workflowId = "20261010-assistant-workflow";
const nativeContinuityId = "20261009-colleague-native-continuity";
const nativeInstructionsId = "20261010-colleague-native-instructions";
const codexCompletedPolicyId = "20261010-colleague-codex-completed-policy";
const upgradeClaudeRejectedInput = async () => {};
// Detailed message/backup behavior lives in claudeCommandUpgrade.unit.test.js.
const upgradeClaudeCommandMessages = async () => {};
const runStateUpgrades = options => runUpgrades({ upgradeClaudeCommandMessages, upgradeClaudeRejectedInput, upgradeColleagueHistoricalInteractiveContinuity, repairColleagueRetiredOperation, upgradeAssistantWorkflow, upgradeIndependentProviderCredentials, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeContinuity, upgradeColleagueNativeInstructions, ...options });
const personalPreferencesId = "20261006-personal-assistant-preferences";
const routingCompatibilityId = "20261006-routing-format-compatibility";
const upgradeIds = [id, routingId, "20260925-native-conversation-lifecycle", "20260926-assistant-role-names", "20260927-assistant-helper", "20260927-native-provider-readiness", "20260928-completed-discussion-plan", "20260929-plan-history", "20260930-auto-implementation-continuation", "20261002-colleague-conversation", "20261002-session-conversations", "20261003-conversation-native-journal", "20261003-conversation-undo-retirement", trainingId, personalPreferencesId, routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId];
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("Claude command upgrade requires its owner and records completion only after successful apply", async t => {
  const f = await fixture(t);
  const prior = { version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(claudeCommandMessagesId)).map(id => ({ id, completedAt: "2026-10-16T00:00:00.000Z" })) };
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify(prior));
  await assert.rejects(runUpgrades({ systemRoot: f.systemRoot, report() {} }), /Claude message repair owner is required/);
  const calls = [];
  const options = { systemRoot: f.systemRoot, report() {}, upgradeClaudeCommandMessages: async context => {
    calls.push(context.apply);
    assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", claudeCommandMessagesId));
  } };
  await runUpgrades(options);
  assert.deepEqual(JSON.parse(await readFile(f.ledgerPath)), prior);
  await assert.rejects(runUpgrades({ ...options, apply: true, upgradeClaudeCommandMessages: async () => { throw new Error("proof failed"); } }), /proof failed/);
  assert.deepEqual(JSON.parse(await readFile(f.ledgerPath)), prior);
  await runUpgrades({ ...options, apply: true });
  assert.ok(calls.includes(false));
  assert.equal(calls.at(-1), true);
  assert.equal(JSON.parse(await readFile(f.ledgerPath)).applied.at(-1).id, workspaceAssistantNameOnlyId);
});
const legacyMarker = { connected: true, updatedAt: "2026-09-23T03:15:44.821Z", version: 1 };
async function fixture(t, { codexPolicy = upgradeColleagueCodexCompletedPolicy, nativeContinuity = upgradeColleagueNativeContinuity, nativeInstructions = upgradeColleagueNativeInstructions, retiredOperation = repairColleagueRetiredOperation, interactiveContinuity = upgradeColleagueHistoricalInteractiveContinuity } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const markerPath = path.join(systemRoot, "auth/codex/status.json");
  const ledgerPath = path.join(systemRoot, "upgrades/applied.json");
  const messages = [];
  return {
    root, systemRoot, markerPath, ledgerPath, messages,
    async marker(value = legacyMarker) {
      await mkdir(path.dirname(markerPath), { recursive: true });
      await writeFile(markerPath, typeof value === "string" ? value : JSON.stringify(value));
    },
    run: (apply = false) => runStateUpgrades({ upgradeColleagueHistoricalInteractiveContinuity: interactiveContinuity, repairColleagueRetiredOperation: retiredOperation, upgradeColleagueCodexCompletedPolicy: codexPolicy, upgradeColleagueNativeContinuity: nativeContinuity, upgradeColleagueNativeInstructions: nativeInstructions, upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot, apply, upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers, upgradeCompletedDiscussionPlan, upgradeAssistantPlans, upgradeColleagueConversations, upgradeSessionConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, inspectConversationUndoRetirement, report: (level, message) => messages.push({ level, message }) })
  };
}

test("check is read-only, including on an installation that has never created state", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.run()).pending, upgradeIds);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  await f.marker();
  const original = await readFile(f.markerPath, "utf8");
  await f.run();
  assert.equal(await readFile(f.markerPath, "utf8"), original);
  await assert.rejects(stat(path.dirname(f.ledgerPath)), { code: "ENOENT" });
  assert.equal(f.messages.some(entry => entry.level === "warning"), true);
});

test("draft identity boundary records once without rewriting historical conversations", async t => {
  const f = await fixture(t);
  const conversation = path.join(f.systemRoot, "projects", "existing", "conversation.json");
  await mkdir(path.dirname(conversation), { recursive: true });
  const original = '{"conversationId":"chat","draft":"Keep this text"}\n';
  await writeFile(conversation, original);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(conversationDraftIdentityId)).map(id => ({ id, completedAt: "2026-10-14T00:00:00.000Z" })) }));
  assert.deepEqual((await f.run()).pending, [conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId]);
  assert.equal(await readFile(conversation, "utf8"), original);
  assert.deepEqual((await f.run(true)).applied, [conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId]);
  assert.deepEqual((await f.run(true)).applied, []);
  assert.equal(await readFile(conversation, "utf8"), original);
});

test("personal voice policy gate leaves old profiles untouched through check, interrupted apply, retry and older registry refusal", async t => {
  const f = await fixture(t);
  const profileRoot = path.join(f.systemRoot, "assistant-preferences/MTAwMA");
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  const profiles = ["colleague", "coding"].map(target => path.join(profileRoot, `${target}.json`));
  for (const filename of profiles) {
    await writeFile(filename, '{"schemaVersion":1,"settings":{"avatar":"merc","voice":"kitten_jasper"}}\n', { mode: 0o600 });
  }
  const originals = await Promise.all(profiles.map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(personalVoicePolicyId)).map(id => ({ id, completedAt: "2026-10-07T00:00:00.000Z" })) }), { mode: 0o600 });
  const before = await readFile(f.ledgerPath);
  const beforeMetadata = await stat(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.equal((await stat(f.ledgerPath)).ino, beforeMetadata.ino);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  let reports = 0;
  await assert.rejects(runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true, report: (_level, message) => {
    if (message.startsWith(`${personalVoicePolicyId}:`) && ++reports === 2) throw new Error("interrupted before voice policy ledger");
  } }), /interrupted before voice policy ledger/u);
  assert.deepEqual(await readFile(f.ledgerPath), before);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  assert.deepEqual(await f.run(true), { pending: [], applied: [personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  const applied = await readFile(f.ledgerPath);
  assert.deepEqual(JSON.parse(applied).applied.map(entry => entry.id), upgradeIds);
  assert.deepEqual(await f.run(), { pending: [], applied: [] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), applied);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", personalVoicePolicyId)), { code: "ENOENT" });

  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const importLine = 'import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";\n';
  const entry = ', personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(entry).length, 2);
  const olderSource = source.replace(importLine, "").replace('import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n', "").replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(entry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const appliedMetadata = await stat(f.ledgerPath);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }), /newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), applied);
    assert.equal((await stat(f.ledgerPath)).ino, appliedMetadata.ino);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
  for (const original of originals) {
    assert.deepEqual(await readFile(original.filename), original.bytes);
    const metadata = await stat(original.filename);
    assert.equal(metadata.mode, original.metadata.mode);
    assert.equal(metadata.ino, original.metadata.ino);
    assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
  }
});

test("apply backs up and upgrades the connection without changing credentials or auth transitions", async t => {
  const f = await fixture(t);
  await f.marker({ ...legacyMarker, extra: "preserved" });
  const original = await readFile(f.markerPath, "utf8");
  const nativeAuth = path.join(f.root, "auth.json");
  const transition = path.join(f.systemRoot, "auth/codex/auth-status.json");
  const credentials = '{"tokens":{"account_id":null,"access_token":"DO-NOT-LOG"}}';
  await writeFile(nativeAuth, credentials);
  await writeFile(transition, '{"status":"reconnect_required"}');
  assert.deepEqual((await f.run(true)).applied, upgradeIds);
  assert.ok(await readCodexLoginId(f.systemRoot));
  const { loginId, ...remaining } = JSON.parse(await readFile(f.markerPath, "utf8"));
  assert.equal(typeof loginId, "string");
  assert.deepEqual(remaining, JSON.parse(original));
  const backup = path.join(f.systemRoot, "upgrades/backups", id, "codex-status.json");
  assert.equal(await readFile(backup, "utf8"), original);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.equal((await stat(f.markerPath)).mode & 0o777, 0o600);
  assert.equal((await stat(f.ledgerPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(nativeAuth, "utf8"), credentials);
  assert.equal(await readFile(transition, "utf8"), '{"status":"reconnect_required"}');
  assert.equal(JSON.stringify(f.messages).includes("DO-NOT-LOG"), false);
  const ledger = JSON.parse(await readFile(f.ledgerPath, "utf8"));
  assert.equal(ledger.applied[0].id, id);
});

test("completed upgrades never run again, and interrupted ledger recording preserves the new identity", async t => {
  const f = await fixture(t);
  await f.marker();
  await f.run(true);
  const marker = await readFile(f.markerPath, "utf8");
  const ledger = await readFile(f.ledgerPath, "utf8");
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
  // A crash after the marker rename but before the ledger rename must be retryable.
  const interrupted = await fixture(t);
  await interrupted.marker(marker);
  await interrupted.run(true);
  assert.equal(await readFile(interrupted.markerPath, "utf8"), marker);
});

test("upgrading a legacy connection restores the AI controls identity lookup with a null native account ID", async t => {
  const f = await fixture(t);
  await f.marker();
  const toolHomeSource = path.join(f.root, "daemon");
  const authPath = path.join(toolHomeSource, ".codex/auth.json");
  const credentials = JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: null } });
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, credentials);
  const options = { systemRoot: f.systemRoot, toolHomeSource };
  const beforeUpgrade = new CodexAppServerAgentProvider(options);
  await assert.rejects(beforeUpgrade.currentRuntimeInfo(), { code: "vibe64_codex_login_identity_unavailable" });
  await f.run();
  assert.equal(await readCodexLoginId(f.systemRoot), "", "deployment preflight does not modify the marker");
  await f.run(true);
  const afterRestart = new CodexAppServerAgentProvider(options);
  const identity = (await afterRestart.currentRuntimeInfo()).accountIdentitySignature;
  assert.match(identity, /^sha256:[a-f0-9]{64}$/u);
  assert.equal((await afterRestart.currentRuntimeInfo()).accountIdentitySignature, identity);
  assert.equal(await readFile(authPath, "utf8"), credentials, "native account_id remains null and credentials are untouched");
});

test("fresh and disconnected installations preserve login state and record the ordered upgrades", async t => {
  for (const disconnected of [false, true]) {
    const f = await fixture(t);
    if (disconnected) await f.marker({ ...legacyMarker, connected: false });
    await f.run(true);
    assert.equal(await readCodexLoginId(f.systemRoot), "");
    assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied.length, upgradeIds.length);
  }
  // Explicit setup must record real no-ops before current session creation.
  // A missing ledger is not permission to mark already-seeded state current.
  const preferences = JSON.stringify({ mode: "senior", review: false, workflowEngineId: "opencode" });
  for (const initializedBeforeSeed of [true, false]) {
    const f = await fixture(t);
    if (initializedBeforeSeed) await f.run(true);
    const store = createVibe64SessionStore({ projectContextRoot: f.root,
      projectRuntimeRoot: path.join(f.systemRoot, "projects/example") });
    await store.createSession({ runtimeKind: "genesis", sessionId: "seeded" });
    await store.writeMetadataValue("seeded", "assistant_routing", preferences);
    if (initializedBeforeSeed) {
      const ledger = await readFile(f.ledgerPath, "utf8");
      assert.deepEqual(await f.run(true), { pending: [], applied: [] });
      assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
    } else {
      assert.deepEqual((await f.run()).pending, upgradeIds);
      await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
      assert.deepEqual((await f.run(true)).applied, upgradeIds);
      assert.deepEqual(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied.map(entry => entry.id), upgradeIds);
    }
    assert.equal(await store.readMetadataValue("seeded", "assistant_routing"), preferences);
  }
});

test("malformed or unsupported metadata blocks upgrades without replacing it or recording success", async t => {
  for (const marker of ['{"secret":"DO-NOT-LOG",', {}, { ...legacyMarker, version: 2 }, { ...legacyMarker, loginId: null }]) {
    const f = await fixture(t);
    await f.marker(marker);
    const original = await readFile(f.markerPath, "utf8");
    await assert.rejects(f.run(true), error => error.message.includes(id) && !error.message.includes("DO-NOT-LOG"));
    assert.equal(await readFile(f.markerPath, "utf8"), original);
    await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
});

test("unsupported ledger histories prevent state writes", async t => {
  for (const ledger of ["{", { version: 2, applied: [] }, { version: 1, applied: [{ id: "future", completedAt: new Date().toISOString() }] },
    { version: 1, applied: [{ id, completedAt: "invalid" }] },
    { version: 1, applied: [{ id, completedAt: new Date().toISOString() }, { completedAt: new Date().toISOString() }] }]) {
    const f = await fixture(t);
    await f.marker();
    await mkdir(path.dirname(f.ledgerPath));
    await writeFile(f.ledgerPath, typeof ledger === "string" ? ledger : JSON.stringify(ledger));
    await assert.rejects(f.run(true), /ledger/);
    assert.equal(await readCodexLoginId(f.systemRoot), "");
  }
});

test("an existing apply lock is never stolen or removed", async t => {
  const f = await fixture(t);
  await f.marker();
  const lockPath = path.join(f.systemRoot, "upgrades/apply.lock");
  await mkdir(path.dirname(lockPath));
  await writeFile(lockPath, "other process");
  await assert.rejects(f.run(true), /lock exists/);
  assert.equal(await readFile(lockPath, "utf8"), "other process");
  assert.equal(await readCodexLoginId(f.systemRoot), "");
});

test("conflicting backups block repair instead of silently replacing the recovery copy", async t => {
  const f = await fixture(t);
  await f.marker();
  const backup = path.join(f.systemRoot, "upgrades/backups", id, "codex-status.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "earlier state");
  await assert.rejects(f.run(true), /saved upgrade backup/);
  assert.equal(await readFile(backup, "utf8"), "earlier state");
  assert.equal(await readCodexLoginId(f.systemRoot), "");
});

test("the packaged standalone CLI checks, applies and reports failure without source dependencies", async t => {
  const f = await fixture(t);
  await f.marker();
  const routingPath = path.join(f.systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(routingPath), { recursive: true });
  await writeFile(routingPath, JSON.stringify({ schemaVersion: 1, revision: 4, orchestrators: {} }));
  const store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.systemRoot, "projects/example") });
  await store.createSession({ runtimeKind: "genesis", sessionId: "archived" });
  await store.writeMetadataValue("archived", "assistant_selection", JSON.stringify({ schema: "vibe64.assistant-selection.v1",
    engineId: "opencode", agentId: "build", modelProviderId: "opencode", modelId: "big-pickle", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` }));
  await store.writeStatus("archived", "archived");
  await store.publishSessionArchive("archived");
  const archivePath = path.join(store.paths().archivedSessionsRoot, "archived.tar.gz");
  const originalArchive = await readFile(archivePath);
  const entry = "bin/upgrade-state.js";
  assert.ok(RUNTIME_ENTRIES.includes(entry));
  const outfile = path.join(f.root, "release/upgrade-state.mjs");
  await buildNodeBundle({ appRoot: repoRoot, entryPoint: path.join(repoRoot, entry), outfile });
  const args = [outfile, `--system-root=${f.systemRoot}`];
  await exec(process.execPath, [...args, "--check", "--repair-colleague-retired-operation"], { cwd: f.root });
  await exec(process.execPath, [...args, "--apply", "--repair-colleague-retired-operation"], { cwd: f.root });
  await exec(process.execPath, [...args, "--check", "--repair-colleague-interactive-continuity"], { cwd: f.root });
  await exec(process.execPath, [...args, "--apply", "--repair-colleague-interactive-continuity"], { cwd: f.root });
  await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
  assert.equal(await readCodexLoginId(f.systemRoot), "");
  await exec(process.execPath, [...args, "--check"], { cwd: f.root });
  assert.equal(await readCodexLoginId(f.systemRoot), "");
  assert.equal(JSON.parse(await readFile(routingPath, "utf8")).schemaVersion, 1);
  assert.deepEqual(await readFile(archivePath), originalArchive);
  await exec(process.execPath, [...args, "--apply"], { cwd: f.root });
  assert.ok(await readCodexLoginId(f.systemRoot));
  const routing = JSON.parse(await readFile(routingPath, "utf8"));
  assert.equal(routing.schemaVersion, 5);
  // Routing V2 assigned the then-included free model; 20261022 retires it, so
  // every role is unset and the next use recommends from connected AI.
  assert.deepEqual([routing.owner, routing.nonOwner], [{ colleague: { follows: "senior" }, fix: { follows: "junior" }, explain: { follows: "quickHelper" } }, {}]);
  assert.equal(JSON.parse(await store.readMetadataValue("archived", "assistant_routing")).workflowEngineId, undefined);
  await assert.rejects(exec(process.execPath, args), error => error.code === 1 && error.stderr.includes("Usage:"));
  await assert.rejects(exec(process.execPath, [...args, "--baseline"]), error => error.code === 1 && error.stderr.includes("ledger already exists"));
  await assert.rejects(exec(process.execPath, [...args, "--baseline", "--check"]), error => error.code === 1 && error.stderr.includes("Usage:"));
  await writeFile(f.ledgerPath, "{invalid");
  await assert.rejects(exec(process.execPath, [...args, "--apply"]), error => error.code === 1 && error.stderr.includes("ERROR:"));
  const freshArgs = [outfile, `--system-root=${path.join(f.root, "fresh-state")}`];
  assert.match((await exec(process.execPath, [...freshArgs, "--baseline"], { cwd: f.root })).stdout, new RegExp(`Recorded ${upgradeIds.length} state upgrade`));
  assert.match((await exec(process.execPath, [...freshArgs, "--check"], { cwd: f.root })).stdout, /\b0 pending state upgrade\(s\)\./);
});

test("a baseline records every known upgrade for a fresh state root, privately and once", async t => {
  const f = await fixture(t);
  // Host provisioning prepares empty private directories before any state.
  await mkdir(path.join(f.systemRoot, "attachments"), { recursive: true });
  await mkdir(path.join(f.systemRoot, "users"), { recursive: true });
  assert.deepEqual((await recordStateUpgradeBaseline({ systemRoot: f.systemRoot, report: (level, message) => f.messages.push({ level, message }) })).recorded, upgradeIds);
  const ledger = JSON.parse(await readFile(f.ledgerPath, "utf8"));
  assert.deepEqual(ledger.applied.map(entry => entry.id), upgradeIds);
  assert.equal(ledger.version, 1);
  assert.equal((await stat(f.ledgerPath)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(f.ledgerPath))).mode & 0o777, 0o700);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  assert.deepEqual((await f.run()).pending, []);
  const recorded = await readFile(f.ledgerPath, "utf8");
  await assert.rejects(recordStateUpgradeBaseline({ systemRoot: f.systemRoot, report() {} }), { code: BASELINE_LEDGER_EXISTS });
  assert.equal(await readFile(f.ledgerPath, "utf8"), recorded);
  // A root that does not exist yet is fresh as well.
  const missing = path.join(f.root, "missing/state");
  await recordStateUpgradeBaseline({ systemRoot: missing, report() {} });
  assert.equal(JSON.parse(await readFile(path.join(missing, "upgrades/applied.json"), "utf8")).applied.length, upgradeIds.length);
  await assert.rejects(recordStateUpgradeBaseline({ systemRoot: "relative/state", report() {} }), /absolute, non-root/);
});

test("a baseline refuses existing state without a ledger, and the upgrade check explains that case", async t => {
  const f = await fixture(t);
  await f.marker('{"secret":"DO-NOT-LOG",');
  await assert.rejects(recordStateUpgradeBaseline({ systemRoot: f.systemRoot, report() {} }),
    error => error.code === BASELINE_STATE_WITHOUT_LEDGER && /state without a state upgrade ledger/u.test(error.message));
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades")), { code: "ENOENT" });
  await assert.rejects(f.run(), error => error.message.includes(id) && error.message.includes("no state upgrade ledger") &&
    !error.message.includes("DO-NOT-LOG"));
  // With history present the hint is not added.
  await mkdir(path.dirname(f.ledgerPath));
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1, applied: [] }));
  await assert.rejects(f.run(), error => error.message.includes(id) && !error.message.includes("no state upgrade ledger"));
  // An existing lock is never taken over.
  const g = await fixture(t);
  await mkdir(path.join(g.systemRoot, "upgrades"), { recursive: true });
  await writeFile(path.join(g.systemRoot, "upgrades/apply.lock"), "other process");
  await assert.rejects(recordStateUpgradeBaseline({ systemRoot: g.systemRoot, report() {} }), { code: BASELINE_STATE_WITHOUT_LEDGER });
  assert.equal(await readFile(path.join(g.systemRoot, "upgrades/apply.lock"), "utf8"), "other process");
});

test("routing preflight failure blocks earlier identity writes as well", async t => {
  const f = await fixture(t);
  await f.marker();
  const routingPath = path.join(f.systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(routingPath), { recursive: true });
  await writeFile(routingPath, "broken");
  await assert.rejects(f.run(true), /Model routing is invalid/u);
  assert.equal(await readCodexLoginId(f.systemRoot), "");
  await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
});

test("a crash after routing publication but before its ledger entry resumes the same upgrade", async t => {
  const f = await fixture(t);
  await f.marker();
  const routingPath = path.join(f.systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(routingPath), { recursive: true });
  const original = JSON.stringify({ schemaVersion: 1, revision: 4, orchestrators: {} });
  await writeFile(routingPath, original);
  await assert.rejects(runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true, upgradeAssistantRoles, upgradeAssistantHelpers, upgradeCompletedDiscussionPlan, upgradeAssistantPlans, upgradeColleagueConversations, upgradeSessionConversations, upgradeColleagueConversationRuntime, upgradeColleagueConversationHistory, inspectConversationUndoRetirement, report: () => {},
    upgradeAssistantRouting: (context) => upgradeAssistantRouting({ ...context, report: (_level, message) => {
      if (message.startsWith("Published state:")) throw new Error("lost before ledger commit");
    } })
  }), /lost before ledger commit/u);
  assert.deepEqual(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied.map((entry) => entry.id), [id]);
  const published = await readFile(routingPath, "utf8");
  assert.deepEqual((await f.run(true)).applied, upgradeIds.slice(1));
  assert.equal(JSON.parse(await readFile(routingPath, "utf8")).schemaVersion, 4);
  assert.equal(JSON.parse(await readFile(routingPath, "utf8")).revision, JSON.parse(published).revision);
  assert.equal(await readFile(path.join(f.systemRoot, "upgrades/backups", routingId, "before/ai-connections/routing.json"), "utf8"), original);
  assert.equal(JSON.parse(published).revision, 5);
});

test("training compatibility boundary checks and records only the ledger while preserving historical absence and reserved bytes", async t => {
  for (const existingRecords of [false, true]) {
    const f = await fixture(t);
    const priorLedger = { version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(trainingId)).map(id => ({ id, completedAt: "2026-10-03T00:00:00.000Z" })) };
    await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
    await writeFile(f.ledgerPath, `${JSON.stringify(priorLedger)}\n`, { mode: 0o600 });
    const applicationPaths = [];
    if (existingRecords) {
      const projectPath = path.join(f.systemRoot, "projects/ordinary/project.json");
      await mkdir(path.dirname(projectPath), { recursive: true });
      await writeFile(projectPath, '{"repository":{"mode":"managed-git","defaultBranch":"main"}}\n', { mode: 0o640 });
      const userRoot = path.join(f.systemRoot, "training/users/NDI");
      await mkdir(userRoot, { recursive: true, mode: 0o700 });
      const attempt = {
        attemptId: "12345678-1234-4234-8234-123456789abc",
        requestIds: ["start-1"],
        createdAt: "2026-10-03T00:00:00.000Z",
        projectSlug: "training-12345678123442348234123456789abc",
        preparation: { phase: "reserved" },
        pin: {
          course: { courseId: "intro-course", release: "0.1.0" },
          topic: { schemaVersion: 1, topicId: "intro-topic", release: "0.1.0", repository: "example/learn-intro", commit: "a".repeat(40), topicHash: "b".repeat(64) },
          lesson: { code: "INTRO-01", hash: "c".repeat(64) }
        }
      };
      const progressPath = path.join(userRoot, "progress.json");
      const activePath = path.join(userRoot, "active-lesson.json");
      await writeFile(progressPath, `${JSON.stringify({ schemaVersion: 1, learnerId: "42", revision: 1, activeAttemptId: attempt.attemptId, attempts: [attempt] })}\n`, { mode: 0o600 });
      await writeFile(activePath, `${JSON.stringify({ schemaVersion: 1, learnerId: "42", progressRevision: 1, attemptId: attempt.attemptId, pin: attempt.pin, projectSlug: attempt.projectSlug, preparation: attempt.preparation })}\n`, { mode: 0o600 });
      applicationPaths.push(projectPath, progressPath, activePath);
    }
    const originals = await Promise.all(applicationPaths.map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
    const ledgerBeforeCheck = await readFile(f.ledgerPath);
    assert.deepEqual(await f.run(), { pending: [trainingId, personalPreferencesId, routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBeforeCheck);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
    assert.equal(f.messages.some(entry => entry.message.startsWith(`${trainingId}:`) && entry.message.includes("no backup is required")), true);
    let boundaryReports = 0;
    await assert.rejects(runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true, upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers, upgradeColleagueConversationHistory, report: (_level, message) => {
      if (message.startsWith(`${trainingId}:`) && ++boundaryReports === 2) {
        throw new Error("Fixture interruption before boundary ledger publication");
      }
    } }), /interruption before boundary ledger publication/u);
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBeforeCheck);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
    assert.deepEqual(await f.run(true), { pending: [], applied: [trainingId, personalPreferencesId, routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
    const appliedLedger = await readFile(f.ledgerPath);
    assert.deepEqual(JSON.parse(appliedLedger).applied.map(entry => entry.id), upgradeIds);
    assert.deepEqual(await f.run(), { pending: [], applied: [] });
    assert.deepEqual(await f.run(true), { pending: [], applied: [] });
    assert.deepEqual(await readFile(f.ledgerPath), appliedLedger);
    for (const original of originals) {
      assert.deepEqual(await readFile(original.filename), original.bytes);
      const metadata = await stat(original.filename);
      assert.equal(metadata.mode, original.metadata.mode);
      assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
      assert.equal(metadata.ino, original.metadata.ino);
    }
    if (!existingRecords) await assert.rejects(stat(path.join(f.systemRoot, "training")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", trainingId)), { code: "ENOENT" });
  }
});

test("the pre-training registry rejects the newer boundary ledger without changing application state", async t => {
  const f = await fixture(t);
  await f.run(true);
  await f.marker({ ...legacyMarker, connected: false });
  const applicationBefore = await readFile(f.markerPath);
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const currentSource = await readFile(runnerUrl, "utf8");
  const boundaryImport = 'import trainingPreparation from "./stateUpgrades/20261006-training-preparation.js";\n';
  const boundaryRegistryEntry = ', trainingPreparation, personalAssistantPreferences, routingFormatCompatibility, colleagueConversationHistory, trainingAssessments, trainingAttemptHistory, trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(currentSource.split(boundaryImport).length, 2);
  assert.equal(currentSource.split(boundaryRegistryEntry).length, 2);
  // Keep the original runner logic and owners; only emulate its prior registry.
  // This proves registry-version refusal, not a deployed older release artifact.
  const olderSource = currentSource.replace(boundaryImport, "")
    .replace('import personalAssistantPreferences from "./stateUpgrades/20261006-personal-assistant-preferences.js";\n', "")
    .replace('import routingFormatCompatibility from "./stateUpgrades/20261006-routing-format-compatibility.js";\n', "")
    .replace('import colleagueConversationHistory from "./stateUpgrades/20261006-colleague-conversation-history.js";\n', "")
    .replace('import trainingAssessments from "./stateUpgrades/20261006-training-assessments.js";\n', "")
    .replace('import trainingQuestionAdmission from "./stateUpgrades/20261007-training-question-admission.js";\n', "")
    .replace('import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";\n', "")
    .replace('import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n', "")
    .replace('import trainingAttemptHistory from "./stateUpgrades/20261007-training-attempt-history.js";\n', "")
    .replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(boundaryRegistryEntry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const ledgerBefore = await readFile(f.ledgerPath);
  const ledgerMetadata = await stat(f.ledgerPath);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }),
      /unsupported, unordered, or newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
    assert.deepEqual(await readFile(f.markerPath), applicationBefore);
    assert.equal((await stat(f.ledgerPath)).ino, ledgerMetadata.ino);
    assert.equal((await stat(f.ledgerPath)).mtimeMs, ledgerMetadata.mtimeMs);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
  assert.deepEqual(await f.run(), { pending: [], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
});


test("personal assistant boundary preserves all legacy and private bytes while check/apply/interrupted retry only changes the ledger", async t => {
  const f = await fixture(t);
  const priorLedger = { version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(personalPreferencesId)).map(id => ({ id, completedAt: "2026-10-06T00:00:00.000Z" })) };
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify(priorLedger), { mode: 0o600 });
  const legacyPath = path.join(f.systemRoot, "assistant-settings.json");
  const personalPath = path.join(f.systemRoot, "assistant-preferences/MTAwMA/colleague.json");
  await mkdir(path.dirname(personalPath), { recursive: true, mode: 0o700 });
  await writeFile(legacyPath, '{"colleagueName":"Ada","avatar":"yu","voice":"current"}\n', { mode: 0o600 });
  await writeFile(personalPath, '{"schemaVersion":1,"settings":{"avatar":"merc","voice":"kitten_jasper"}}\n', { mode: 0o600 });
  const originals = await Promise.all([legacyPath, personalPath].map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
  const ledgerBefore = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [personalPreferencesId, routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  let reports = 0;
  await assert.rejects(runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true, upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers, upgradeColleagueConversationHistory, report: (_level, message) => {
    if (message.startsWith(`${personalPreferencesId}:`) && ++reports === 2) throw new Error("interrupted before personal boundary ledger");
  } }), /interrupted before personal boundary ledger/u);
  assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  assert.deepEqual(await f.run(true), { pending: [], applied: [personalPreferencesId, routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  const applied = await readFile(f.ledgerPath);
  assert.deepEqual(JSON.parse(applied).applied.map(entry => entry.id), upgradeIds);
  assert.deepEqual(await f.run(), { pending: [], applied: [] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), applied);
  // The personal boundary changes no file; only the later name-only upgrade
  // trims the workspace settings to the shared Colleague name.
  for (const original of originals.filter(({ filename }) => filename !== legacyPath)) {
    assert.deepEqual(await readFile(original.filename), original.bytes);
    const metadata = await stat(original.filename);
    assert.equal(metadata.mode, original.metadata.mode);
    assert.equal(metadata.ino, original.metadata.ino);
    assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
  }
  assert.deepEqual(JSON.parse(await readFile(legacyPath, "utf8")), { colleagueName: "Ada" });
  assert.deepEqual(await readFile(path.join(f.systemRoot, "upgrades/backups", workspaceAssistantNameOnlyId, "before/assistant-settings.json")),
    originals.find(({ filename }) => filename === legacyPath).bytes);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", personalPreferencesId)), { code: "ENOENT" });
  await assert.rejects(stat(path.join(f.systemRoot, "assistant-preferences/MTAwMA/coding.json")), { code: "ENOENT" });
});

test("the previous original registry refuses the personal preference boundary ledger without touching saved state", async t => {
  const f = await fixture(t);
  await f.run(true);
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const currentSource = await readFile(runnerUrl, "utf8");
  const boundaryImport = 'import personalAssistantPreferences from "./stateUpgrades/20261006-personal-assistant-preferences.js";\n';
  const boundaryEntry = ', personalAssistantPreferences, routingFormatCompatibility, colleagueConversationHistory, trainingAssessments, trainingAttemptHistory, trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(currentSource.split(boundaryImport).length, 2);
  assert.equal(currentSource.split(boundaryEntry).length, 2);
  // Only the new import/registry entry changes: original runner logic stays intact.
  const olderSource = currentSource.replace(boundaryImport, "")
    .replace('import routingFormatCompatibility from "./stateUpgrades/20261006-routing-format-compatibility.js";\n', "")
    .replace('import colleagueConversationHistory from "./stateUpgrades/20261006-colleague-conversation-history.js";\n', "")
    .replace('import trainingAssessments from "./stateUpgrades/20261006-training-assessments.js";\n', "")
    .replace('import trainingQuestionAdmission from "./stateUpgrades/20261007-training-question-admission.js";\n', "")
    .replace('import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";\n', "")
    .replace('import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n', "")
    .replace('import trainingAttemptHistory from "./stateUpgrades/20261007-training-attempt-history.js";\n', "")
    .replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(boundaryEntry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const legacyPath = path.join(f.systemRoot, "assistant-settings.json");
  await writeFile(legacyPath, "retained unreadable legacy evidence", { mode: 0o600 });
  const ledgerBefore = await readFile(f.ledgerPath);
  const before = await stat(legacyPath);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }), /unsupported, unordered, or newer history/u);
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
    assert.equal(await readFile(legacyPath, "utf8"), "retained unreadable legacy evidence");
    assert.equal((await stat(legacyPath)).ino, before.ino);
    assert.equal((await stat(legacyPath)).mtimeMs, before.mtimeMs);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
  await assert.rejects(stat(path.join(f.systemRoot, "assistant-preferences")), { code: "ENOENT" });
});

test("routing compatibility boundary validates current native evidence without rewriting it and refuses corrupt current tags", async t => {
  for (const mode of ["senior", "junior", "auto", "custom"]) {
    const f = await fixture(t);
    const selected = { schema: "vibe64.assistant-selection.v1", engineId: "opencode", agentId: "build",
      modelProviderId: "opencode", modelId: "big-pickle", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "explicit" };
    const config = { schemaVersion: 4, revision: 1, orchestrators: { opencode: { senior: selected, junior: selected, helper: selected } } };
    const configPath = path.join(f.systemRoot, "ai-connections/routing.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
    const store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.systemRoot, "projects/current") });
    await store.createSession({ runtimeKind: "genesis", sessionId: "current" });
    const request = { schemaVersion: 4, mode, resolvedMode: mode === "auto" ? "junior" : mode,
      status: mode === "senior" ? "done" : "uncertain", workflowEngineId: "opencode",
      assignments: { [mode === "auto" ? "junior" : mode]: selected }, configuration: { revision: 1, orchestrators: config.orchestrators },
      messageId: "retained", attemptedMessageId: "retained", threadId: "native", turnId: "native-turn",
      submittedBy: { username: "member" }, input: { message: "My exact authored words" } };
    await store.writeMetadataValue("current", "assistant_routing_request", JSON.stringify(request, null, 2));
    await store.writeMetadataValue("current", "assistant_routing", JSON.stringify({ mode, workflowEngineId: "opencode", review: false,
      ...(mode === "custom" ? { override: selected } : {}) }));
    const files = [configPath, path.join(store.paths("current").metadataRoot, "assistant_routing_request"),
      path.join(store.paths("current").metadataRoot, "assistant_routing")];
    const before = await Promise.all(files.map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
    await mkdir(path.dirname(f.ledgerPath), { recursive: true });
    const prior = { version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(routingCompatibilityId)).map(id => ({ id, completedAt: "2026-10-06T00:00:00.000Z" })) };
    await writeFile(f.ledgerPath, JSON.stringify(prior));
    const ledgerBefore = await readFile(f.ledgerPath);
    assert.deepEqual(await f.run(), { pending: [routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
    let validations = 0;
    await assert.rejects(runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true,
      upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers, upgradeColleagueConversationHistory,
      report: (_level, message) => {
        if (message.startsWith(`${routingCompatibilityId}:`) && ++validations === 8) throw new Error("interrupted validation before ledger");
      } }), /interrupted validation before ledger/u);
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
    assert.deepEqual(await f.run(true), { pending: [], applied: [routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
    for (const original of before) {
      assert.deepEqual(await readFile(original.filename), original.bytes);
      const metadata = await stat(original.filename);
      assert.equal(metadata.ino, original.metadata.ino);
      assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
    }
    assert.equal(JSON.parse(await store.readMetadataValue("current", "assistant_routing_request")).admissionRequired, undefined);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", routingCompatibilityId)), { code: "ENOENT" });
    assert.deepEqual(await f.run(true), { pending: [], applied: [] });
    await writeFile(f.ledgerPath, JSON.stringify(prior));
    await store.writeMetadataValue("current", "assistant_routing_request", JSON.stringify({ ...request, assignments: { plan: selected } }));
    const corrupt = await store.readMetadataValue("current", "assistant_routing_request");
    await assert.rejects(f.run(true), error => error.message.startsWith(`${routingCompatibilityId}:`));
    assert.equal(await store.readMetadataValue("current", "assistant_routing_request"), corrupt);
    assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
  }
});


test("registered Colleague history boundary retains original runtime identity and backs up the complete record", async t => {
  const f = await fixture(t);
  const file = path.join(f.systemRoot, "colleague", "NDI", "conversation.json");
  const original = { schemaVersion: 2, scopeId: "colleague_existing", status: "ready", error: "", assistantSelection: null,
    conversationLog: [{ turnId: "saved-turn", messages: [{ role: "user", text: "Exact retained history", messageId: "saved-message" }] }],
    watches: [], observations: [], extra: { preserved: true } };
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(original);
  await writeFile(file, bytes);
  await f.run(false);
  assert.equal(await readFile(file, "utf8"), bytes);
  await f.run(true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { ...original, schemaVersion: 3, runtimeId: "NDI", previousConversations: [] });
  const backup = path.join(f.systemRoot, "upgrades/backups/20261006-colleague-conversation-history/NDI/conversation.json");
  assert.equal(await readFile(backup, "utf8"), bytes);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied[upgradeIds.indexOf("20261006-colleague-conversation-history")].id, "20261006-colleague-conversation-history");
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
});

test("prospective assessment boundary leaves old reservations untouched and older registry refuses its ledger", async t => {
  const f = await fixture(t);
  const progress = path.join(f.systemRoot, "training/users/NDI/progress.json");
  const active = path.join(f.systemRoot, "training/users/NDI/active-lesson.json");
  await mkdir(path.dirname(progress), { recursive: true });
  await writeFile(progress, '{"schemaVersion":1,"untouched":"existing reservation"}\n', { mode: 0o600 });
  await writeFile(active, '{"schemaVersion":1,"untouched":"derived reservation"}\n', { mode: 0o600 });
  const files = await Promise.all([progress, active].map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(assessmentsId)).map(id => ({ id, completedAt: "2026-10-06T00:00:00.000Z" })) }));
  const ledgerBefore = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
  assert.deepEqual(await f.run(true), { pending: [], applied: [assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  for (const original of files) {
    assert.deepEqual(await readFile(original.filename), original.bytes);
    const metadata = await stat(original.filename);
    assert.equal(metadata.ino, original.metadata.ino);
    assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
    assert.equal(metadata.mode, original.metadata.mode);
  }
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", assessmentsId)), { code: "ENOENT" });
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const importLine = 'import trainingAssessments from "./stateUpgrades/20261006-training-assessments.js";\n';
  const entry = ', trainingAssessments, trainingAttemptHistory, trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(entry).length, 2);
  const olderSource = source.replace(importLine, "")
    .replace('import trainingQuestionAdmission from "./stateUpgrades/20261007-training-question-admission.js";\n', "")
    .replace('import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";\n', "")
    .replace('import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n', "")
    .replace('import trainingAttemptHistory from "./stateUpgrades/20261007-training-attempt-history.js";\n', "").replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(entry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const ledger = await readFile(f.ledgerPath);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }), /newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), ledger);
    assert.deepEqual(await readFile(progress), files[0].bytes);
    assert.deepEqual(await readFile(active), files[1].bytes);
  }
});

test("prospective attempt-history boundary preserves learner bytes and the prior registry refuses its completed ledger", async t => {
  const f = await fixture(t);
  const progress = path.join(f.systemRoot, "training/users/NDI/progress.json");
  const active = path.join(f.systemRoot, "training/users/NDI/active-lesson.json");
  await mkdir(path.dirname(progress), { recursive: true });
  // No-op means even evidence requiring owner inspection must remain untouched.
  await writeFile(progress, '{"schemaVersion":1,"untouched":"original single reservation"}\n', { mode: 0o600 });
  await writeFile(active, '{"schemaVersion":1,"untouched":"original active summary"}\n', { mode: 0o600 });
  const files = await Promise.all([progress, active].map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(attemptHistoryId)).map(id => ({ id, completedAt: "2026-10-07T00:00:00.000Z" })) }));
  const ledgerBefore = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), ledgerBefore);
  assert.deepEqual(await f.run(true), { pending: [], applied: [attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).applied[upgradeIds.indexOf(attemptHistoryId)].id, attemptHistoryId);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", attemptHistoryId)), { code: "ENOENT" });
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const importLine = 'import trainingAttemptHistory from "./stateUpgrades/20261007-training-attempt-history.js";\n';
  const entry = ', trainingAttemptHistory, trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(entry).length, 2);
  // Only the exact new import and entry change. This proves registry-version
  // refusal, not behavior of a deployed older executable.
  const olderSource = source.replace(importLine, "")
    .replace('import trainingQuestionAdmission from "./stateUpgrades/20261007-training-question-admission.js";\n', "")
    .replace('import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";\n', "")
    .replace('import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n', "").replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(entry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const ledger = await readFile(f.ledgerPath);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }), /newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), ledger);
  }
  for (const original of files) {
    assert.deepEqual(await readFile(original.filename), original.bytes);
    const metadata = await stat(original.filename);
    assert.equal(metadata.ino, original.metadata.ino);
    assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
    assert.equal(metadata.mode, original.metadata.mode);
  }
});


test("prospective question-admission boundary preserves learner and native history while only recording the ledger", async t => {
  // These original opaque bytes exercise only the prospective question boundary.
  // Keep them and every byte/inode assertion; the real Codex and native continuity
  // owners reject this shape and are proved separately in the original upgrade file.
  const codexPolicy = async () => {};
  const nativeContinuity = async () => {};
  const nativeInstructions = async () => {};
  const interactiveContinuity = async () => {};
  const retiredOperation = async () => {}; // This prospective boundary retains its intentionally opaque historical bytes.
  const f = await fixture(t, { codexPolicy, nativeContinuity, nativeInstructions, retiredOperation, interactiveContinuity });
  const progress = path.join(f.systemRoot, "training/users/NDI/progress.json");
  const nativeHistory = path.join(f.systemRoot, "colleague/NDI/conversation.json");
  await mkdir(path.dirname(progress), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(nativeHistory), { recursive: true, mode: 0o700 });
  // The boundary does not validate, grade or invent provenance for these old bytes.
  await writeFile(progress, '{"schemaVersion":1,"learning":{"resume":{"pendingQuestion":{"id":"old-question","assessmentId":"preview-purpose","text":"My original question"}}}}\n', { mode: 0o600 });
  await writeFile(nativeHistory, '{"schemaVersion":3,"conversationLog":[{"turnId":"old-turn","messages":[{"role":"user","text":"My original answer","messageId":"old-answer"},{"role":"assistant","text":"My original reply","outputId":"saved-output"}],"metadata":{"runtime":{"status":"complete"}}}]}\n', { mode: 0o600 });
  const originals = await Promise.all([progress, nativeHistory].map(async filename => ({ filename, bytes: await readFile(filename), metadata: await stat(filename) })));
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(questionAdmissionId)).map(id => ({ id, completedAt: "2026-10-07T00:00:00.000Z" })) }), { mode: 0o600 });
  const before = await readFile(f.ledgerPath);
  const beforeMetadata = await stat(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.equal((await stat(f.ledgerPath)).ino, beforeMetadata.ino);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  let reports = 0;
  await assert.rejects(runStateUpgrades({ upgradeColleagueHistoricalInteractiveContinuity: interactiveContinuity, repairColleagueRetiredOperation: retiredOperation, upgradeColleagueCodexCompletedPolicy: codexPolicy, upgradeColleagueNativeContinuity: nativeContinuity, upgradeColleagueNativeInstructions: nativeInstructions, upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true, report: (_level, message) => {
    if (message.startsWith(`${questionAdmissionId}:`) && ++reports === 2) throw new Error("interrupted before question boundary ledger");
  } }), /interrupted before question boundary ledger/u);
  assert.deepEqual(await readFile(f.ledgerPath), before);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  assert.deepEqual(await f.run(true), { pending: [], applied: [questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  const applied = await readFile(f.ledgerPath);
  assert.deepEqual(JSON.parse(applied).applied.map(entry => entry.id), upgradeIds);
  assert.deepEqual(await f.run(), { pending: [], applied: [] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), applied);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", questionAdmissionId)), { code: "ENOENT" });

  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const importLine = 'import trainingQuestionAdmission from "./stateUpgrades/20261007-training-question-admission.js";\n';
  const entry = ', trainingQuestionAdmission, personalVoicePolicy, learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(entry).length, 2);
  // Remove only this prospective entry; preserve the original runner and owners.
  // This proves registry-version refusal, not a deployed older executable.
  const olderSource = source.replace(importLine, "")
    .replace('import personalVoicePolicy from "./stateUpgrades/20261008-personal-voice-policy.js";\n', "")
    .replace('import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n', "").replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(entry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const appliedMetadata = await stat(f.ledgerPath);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeColleagueHistoricalInteractiveContinuity: interactiveContinuity, repairColleagueRetiredOperation: retiredOperation, upgradeColleagueCodexCompletedPolicy: codexPolicy, upgradeColleagueNativeContinuity: nativeContinuity, upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }), /newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), applied);
    assert.equal((await stat(f.ledgerPath)).ino, appliedMetadata.ino);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
  for (const original of originals) {
    assert.deepEqual(await readFile(original.filename), original.bytes);
    const metadata = await stat(original.filename);
    assert.equal(metadata.mode, original.metadata.mode);
    assert.equal(metadata.ino, original.metadata.ino);
    assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
  }
});

test("Learning practice session boundary preserves existing records through check, interrupted apply, retry and prior registry refusal", async t => {
  const f = await fixture(t);
  const records = [
    ["projects/working/sessions/active/working/meta/label", "Existing Working\n"],
    ["projects/lesson/sessions/active/lesson/meta/learning_session", JSON.stringify({ schemaVersion: 1, learnerId: "42", attemptId: "existing-attempt", pin: { lesson: "old-pin" }, noExercise: true, conversationId: "lesson" })],
    ["training/users/42/progress.json", '{"schemaVersion":1,"retained":"unchanged"}\n']
  ];
  const originals = [];
  for (const [relative, bytes] of records) {
    const filename = path.join(f.systemRoot, relative);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, bytes, { mode: 0o600 });
    originals.push({ filename, bytes: await readFile(filename), metadata: await stat(filename) });
  }
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(learningPracticeSessionsId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) }), { mode: 0o600 });
  const priorLedger = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), priorLedger);
  let reports = 0;
  await assert.rejects(runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply: true, report: (_level, message) => {
    if (message.startsWith(`${learningPracticeSessionsId}:`) && ++reports === 2) throw new Error("interrupted before practice binding ledger");
  } }), /interrupted before practice binding ledger/u);
  assert.deepEqual(await readFile(f.ledgerPath), priorLedger);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  assert.deepEqual(await f.run(true), { pending: [], applied: [learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  const appliedLedger = await readFile(f.ledgerPath);
  assert.deepEqual(JSON.parse(appliedLedger).applied.map(entry => entry.id), upgradeIds);
  assert.deepEqual(await f.run(), { pending: [], applied: [] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), appliedLedger);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", learningPracticeSessionsId)), { code: "ENOENT" });
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const importLine = 'import learningPracticeSessions from "./stateUpgrades/20261008-learning-practice-sessions.js";\n';
  const entry = ', learningPracticeSessions, learningPracticeHistory, planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(entry).length, 2);
  const olderSource = source.replace(importLine, "").replace('import learningPracticeHistory from "./stateUpgrades/20261008-learning-practice-history.js";\n', "").replace(entry, "];")
    .replace('import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n', "")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ upgradeLearningPracticeHistory, upgradePlanProgress, upgradeAssistantWorkflow, systemRoot: f.systemRoot, apply, report: () => {} }), /newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), appliedLedger);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
  for (const original of originals) {
    assert.deepEqual(await readFile(original.filename), original.bytes);
    const metadata = await stat(original.filename);
    assert.equal(metadata.mode, original.metadata.mode);
    assert.equal(metadata.ino, original.metadata.ino);
    assert.equal(metadata.mtimeMs, original.metadata.mtimeMs);
  }
});

test("historical practice registry requires its real typed owner and runs check before apply without changing published boundaries", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(practiceHistoryId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) }), { mode: 0o600 });
  const before = await readFile(f.ledgerPath);
  await assert.rejects(runStateUpgrades({ systemRoot: f.systemRoot, report() {} }), /Training practice history upgrade owner is required/u);
  assert.deepEqual(await readFile(f.ledgerPath), before);
  const calls = [];
  const delegate = async context => {
    calls.push(context.apply);
    assert.equal(context.systemRoot, f.systemRoot);
    assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", practiceHistoryId));
  };
  assert.deepEqual(await runStateUpgrades({ systemRoot: f.systemRoot, apply: true,
    upgradeLearningPracticeHistory: delegate, upgradePlanProgress, report() {} }), { pending: [], applied: [practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(calls, [false, true]);
  assert.equal(JSON.parse(await readFile(f.ledgerPath)).applied[upgradeIds.indexOf(practiceHistoryId)].id, practiceHistoryId);
  const oldGate = await readFile(new URL("../../packages/vibe64-core/src/server/stateUpgrades/20261008-learning-practice-sessions.js", import.meta.url), "utf8");
  assert.equal(oldGate.includes("no application file is read or converted"), true);
});

test("real historical practice delegate retains a fresh installation and refuses malformed progress without recording completion", async t => {
  const { upgradeLearningPracticeHistory: realOwner } = await import("../../packages/vibe64-training/src/server/practiceHistoryUpgrade.js");
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(practiceHistoryId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) }), { mode: 0o600 });
  const result = await runStateUpgrades({ systemRoot: f.systemRoot, apply: false,
    upgradeLearningPracticeHistory: realOwner, upgradePlanProgress, report() {} });
  assert.deepEqual(result, { pending: [practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", practiceHistoryId)), { code: "ENOENT" });
  const progress = path.join(f.systemRoot, "training/users/NDI/progress.json");
  await mkdir(path.dirname(progress), { recursive: true, mode: 0o700 });
  await writeFile(progress, '{"schemaVersion":1,"retained":"not-valid-progress"}\n', { mode: 0o600 });
  const ledger = await readFile(f.ledgerPath);
  const saved = await readFile(progress);
  await assert.rejects(runStateUpgrades({ systemRoot: f.systemRoot, apply: true,
    upgradeLearningPracticeHistory: realOwner, upgradePlanProgress, report() {} }));
  assert.deepEqual(await readFile(progress), saved);
  assert.deepEqual(await readFile(f.ledgerPath), ledger);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", practiceHistoryId)), { code: "ENOENT" });
});


test("paired Plan/Progress registry requires its typed owner, preserves the ledger on interruption and rejects prior registries", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true, mode: 0o700 });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(planProgressId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) }), { mode: 0o600 });
  const before = await readFile(f.ledgerPath);
  await assert.rejects(runStateUpgrades({ systemRoot: f.systemRoot, report() {} }), /paired plan owner is required/u);
  assert.deepEqual(await readFile(f.ledgerPath), before);
  const calls = [];
  let interrupt = true;
  const owner = async context => {
    calls.push(context.apply);
    assert.equal(context.systemRoot, f.systemRoot);
    assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", planProgressId));
    if (context.apply && interrupt) throw new Error("interrupted paired owner publication");
  };
  const options = { systemRoot: f.systemRoot, upgradePlanProgress: owner, report() {} };
  assert.deepEqual(await runStateUpgrades(options), { pending: [planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.deepEqual(calls, [false]);
  calls.length = 0;
  await assert.rejects(runStateUpgrades({ ...options, apply: true }), /interrupted paired owner publication/u);
  assert.deepEqual(calls, [false, true]);
  assert.deepEqual(await readFile(f.ledgerPath), before);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  interrupt = false;
  calls.length = 0;
  assert.deepEqual(await runStateUpgrades({ ...options, apply: true }), { pending: [], applied: [planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(calls, [false, true]);
  const applied = await readFile(f.ledgerPath);
  assert.deepEqual(JSON.parse(applied).applied.map(entry => entry.id), upgradeIds);
  assert.deepEqual(await runStateUpgrades({ ...options, apply: true }), { pending: [], applied: [] });
  assert.deepEqual(calls, [false, true], "The completed boundary does not call its owner again");
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const importLine = 'import planProgress from "./stateUpgrades/20261008-plan-progress.js";\n';
  const entry = ', planProgress, colleagueCodexCompletedPolicy, colleagueNativeContinuity, colleagueNativeInstructions, assistantWorkflow, independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];';
  assert.equal(source.split(importLine).length, 2);
  assert.equal(source.split(entry).length, 2);
  const olderSource = source.replace(importLine, "").replace(entry, "];")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  for (const apply of [false, true]) {
    await assert.rejects(older.runStateUpgrades({ ...options, apply }), /newer history; refusing to upgrade or downgrade/u);
    assert.deepEqual(await readFile(f.ledgerPath), applied);
    await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  }
});

test("Codex tool-policy registry checks its original owner before writing and retains the published ledger prefix", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(codexCompletedPolicyId)).map(id => ({ id, completedAt: "2026-10-10T00:00:00.000Z" })) }));
  const original = await readFile(f.ledgerPath);
  await assert.rejects(runUpgrades({ systemRoot: f.systemRoot, report() {} }), /tool-policy owner is required/);
  assert.deepEqual(await readFile(f.ledgerPath), original);
  const calls = [];
  const options = { systemRoot: f.systemRoot, report() {}, upgradeClaudeCommandMessages, upgradeClaudeRejectedInput, upgradeColleagueHistoricalInteractiveContinuity, repairColleagueRetiredOperation, upgradeAssistantWorkflow, upgradeIndependentProviderCredentials, upgradeColleagueNativeContinuity, upgradeColleagueNativeInstructions, upgradeColleagueCodexCompletedPolicy: async context => {
    assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", codexCompletedPolicyId));
    calls.push(context.apply);
    await upgradeColleagueCodexCompletedPolicy(context);
  } };
  assert.deepEqual(await runUpgrades(options), { pending: [codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), original);
  assert.deepEqual(await runUpgrades({ ...options, apply: true }), { pending: [], applied: [codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(calls, [false, false, true]);
  const ledger = JSON.parse(await readFile(f.ledgerPath, "utf8"));
  assert.deepEqual(ledger.applied.slice(0, upgradeIds.indexOf(codexCompletedPolicyId)), JSON.parse(original).applied);
  assert.equal(ledger.applied[upgradeIds.indexOf(codexCompletedPolicyId)].id, codexCompletedPolicyId);
  await runUpgrades({ ...options, apply: true });
  assert.deepEqual(calls, [false, false, true]);
});

test("native continuity registry requires its original owner, checks before publication and records only confirmed completion", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(nativeContinuityId)).map(id => ({ id, completedAt: "2026-10-09T00:00:00.000Z" })) }));
  const previous = await readFile(f.ledgerPath);
  await assert.rejects(runUpgrades({ systemRoot: f.systemRoot, report() {} }), /native-continuity owner is required/);
  assert.deepEqual(await readFile(f.ledgerPath), previous);
  const calls = [];
  let fail = true;
  const owner = async context => {
    assert.equal(context.systemRoot, f.systemRoot);
    assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades", "backups", nativeContinuityId));
    calls.push(context.apply);
    if (context.apply && fail) throw new Error("native evidence changed");
  };
  const options = { systemRoot: f.systemRoot, upgradeClaudeCommandMessages, upgradeClaudeRejectedInput, upgradeColleagueHistoricalInteractiveContinuity, repairColleagueRetiredOperation, upgradeAssistantWorkflow, upgradeIndependentProviderCredentials, upgradeColleagueNativeContinuity: owner, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeInstructions, report() {} };
  assert.deepEqual(await runUpgrades(options), { pending: [nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  await assert.rejects(runUpgrades({ ...options, apply: true }), /native evidence changed/);
  assert.deepEqual(await readFile(f.ledgerPath), previous);
  assert.deepEqual(calls, [false, false, true]);
  fail = false;
  assert.deepEqual(await runUpgrades({ ...options, apply: true }), { pending: [], applied: [nativeContinuityId, nativeInstructionsId, workflowId, independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(calls, [false, false, true, false, true]);
  assert.deepEqual(await runUpgrades({ ...options, apply: true }), { pending: [], applied: [] });
  assert.deepEqual(calls, [false, false, true, false, true]);
});

test("independent credential registry requires the real owner, checks before clearing and records only completed publication", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(independentCredentialsId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) }));
  const previousLedger = await readFile(f.ledgerPath);
  const publishedUpgradeIds = [id, routingId, "20260925-native-conversation-lifecycle", "20260926-assistant-role-names", "20260927-assistant-helper", "20260927-native-provider-readiness", "20260928-completed-discussion-plan", "20260929-plan-history", "20260930-auto-implementation-continuation", "20261002-colleague-conversation", "20261002-session-conversations", "20261003-conversation-native-journal", "20261003-conversation-undo-retirement", trainingId, personalPreferencesId, routingCompatibilityId, "20261006-colleague-conversation-history", assessmentsId, attemptHistoryId, questionAdmissionId, personalVoicePolicyId, learningPracticeSessionsId, practiceHistoryId, planProgressId, codexCompletedPolicyId, nativeContinuityId, nativeInstructionsId, workflowId];
  assert.deepEqual(upgradeIds.slice(0, upgradeIds.indexOf(independentCredentialsId)), publishedUpgradeIds);
  assert.deepEqual(JSON.parse(previousLedger).applied.map(entry => entry.id), publishedUpgradeIds);
  assert.equal(JSON.parse(previousLedger).applied.at(-2).id, nativeInstructionsId);
  assert.equal(JSON.parse(previousLedger).applied.at(-1).id, workflowId);
  assert.equal(upgradeIds.indexOf(codexCompletedPolicyId) < upgradeIds.indexOf(nativeContinuityId), true);
  assert.deepEqual(upgradeIds.slice(upgradeIds.indexOf(workflowId)), [workflowId,
    independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId,
    conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId,
    workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId]);
  const connectionPath = path.join(f.systemRoot, "ai-connections", "claude", "deepseek", "connection.json");
  await mkdir(path.dirname(connectionPath), { recursive: true });
  const saved = JSON.stringify({ apiKey: "registered-fixture" });
  await writeFile(connectionPath, saved);
  await assert.rejects(runStateUpgrades({ systemRoot: f.systemRoot, upgradeIndependentProviderCredentials: undefined, report() {} }), /independent provider credential owner is required/);
  assert.deepEqual(await readFile(f.ledgerPath), previousLedger);
  let interrupt = true;
  const owner = context => clearProviderCredentials({ ...context, home: path.join(f.root, "home"),
    env: { VIBE64_AGENT_RUNTIME_DIR: path.join(f.root, "native") }, report(level, message) {
      if (context.apply && interrupt && message.startsWith("Published state:")) throw new Error("credential publication interrupted");
    } });
  const options = { systemRoot: f.systemRoot, upgradeIndependentProviderCredentials: owner, report() {} };
  assert.deepEqual(await runStateUpgrades(options), { pending: [independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.equal(await readFile(connectionPath, "utf8"), saved);
  await assert.rejects(runStateUpgrades({ ...options, apply: true }), /credential publication interrupted/);
  assert.deepEqual(await readFile(f.ledgerPath), previousLedger);
  interrupt = false;
  assert.deepEqual(await runStateUpgrades({ ...options, apply: true }), { pending: [], applied: [independentCredentialsId, retiredOperationId, interactiveContinuityId, continuityScopeId, conversationDraftIdentityId, connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  await assert.rejects(stat(connectionPath), { code: "ENOENT" });
  const applied = await readFile(f.ledgerPath);
  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const olderSource = source.replace('import independentProviderCredentials from "./stateUpgrades/20261009-independent-provider-credentials.js";\n', "")
    .replace(', independentProviderCredentials, colleagueRetiredOperation, colleagueInteractiveContinuity, colleagueContinuityScope, conversationDraftIdentity, connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];', '];')
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  await assert.rejects(older.runStateUpgrades({ ...options, apply: true }), /newer history; refusing to upgrade or downgrade/);
  assert.deepEqual(await readFile(f.ledgerPath), applied);
});


test("explicit retired-operation bootstrap bypasses earlier checks, retains ledger and uses its separate locked backup", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  const ledger = JSON.stringify({ version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(nativeContinuityId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) });
  await writeFile(f.ledgerPath, ledger);
  const calls = [];
  const options = { systemRoot: f.systemRoot, repairRetiredOperation: true, report() {},
    upgradeColleagueNativeContinuity: async () => { throw new Error("original continuity remains blocked"); },
    repairColleagueRetiredOperation: async context => {
      calls.push({ apply: context.apply, backupRoot: context.backupRoot });
      if (context.apply) assert.ok(await stat(path.join(f.systemRoot, "upgrades/apply.lock")));
      assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
    } };
  await runUpgrades(options);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  const result = await runUpgrades({ ...options, apply: true });
  assert.deepEqual(result.applied, []);
  assert.deepEqual(calls, [false, true].map(apply => ({ apply, backupRoot: path.join(f.systemRoot, "upgrades/backups", retiredOperationId, "before-continuity-bootstrap") })));
  assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  await assert.rejects(runUpgrades({ ...options, repairRetiredOperation: false }), /original continuity remains blocked/);
  await writeFile(path.join(f.systemRoot, "upgrades/apply.lock"), "other upgrade");
  await assert.rejects(runUpgrades({ ...options, apply: true }), /lock exists/);
  assert.equal(calls.length, 2);
  assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
});

test("explicit retired-operation bootstrap refuses missing owner and invalid ledger without publication", async t => {
  const f = await fixture(t);
  await assert.rejects(runUpgrades({ systemRoot: f.systemRoot, repairRetiredOperation: true, apply: true, report() {} }), /repair owner is required/);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
  await assert.rejects(stat(f.ledgerPath), { code: "ENOENT" });
  await writeFile(f.ledgerPath, "invalid");
  let called = false;
  await assert.rejects(runUpgrades({ systemRoot: f.systemRoot, repairRetiredOperation: true, apply: true, report() {},
    repairColleagueRetiredOperation: async () => { called = true; } }), /ledger is not valid JSON/);
  assert.equal(called, false);
  assert.equal(await readFile(f.ledgerPath, "utf8"), "invalid");
});


test("original interactive bootstrap selects only its qualified owner and rejects combined repairs without ledger changes", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  const ledger = JSON.stringify({ version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(nativeContinuityId)).map(id => ({ id, completedAt: "2026-10-08T00:00:00.000Z" })) });
  await writeFile(f.ledgerPath, ledger);
  const calls = [];
  const options = { systemRoot: f.systemRoot, repairInteractiveContinuity: true, report() {},
    upgradeColleagueNativeContinuity: async () => { throw new Error("strict predecessor remains mandatory"); },
    repairColleagueRetiredOperation: async () => { throw new Error("wrong repair owner"); },
    upgradeColleagueHistoricalInteractiveContinuity: async context => {
      calls.push(context.apply);
      assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", interactiveContinuityId, "before-continuity-bootstrap"));
      if (context.apply) assert.ok(await stat(path.join(f.systemRoot, "upgrades/apply.lock")));
    } };
  await runUpgrades(options); await runUpgrades({ ...options, apply: true });
  assert.deepEqual(calls, [false, true]);
  assert.equal(await readFile(f.ledgerPath, "utf8"), ledger);
  await assert.rejects(runUpgrades({ ...options, apply: true, repairRetiredOperation: true }), /one explicit Colleague repair/);
  assert.deepEqual(calls, [false, true]);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/apply.lock")), { code: "ENOENT" });
});


test("connected project boundary preserves existing source bindings and records no inferred contributions", async t => {
  const f = await fixture(t);
  const sessionPath = path.join(f.systemRoot, "projects", "existing", "sessions", "working", "metadata.json");
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const original = '{"base_commit":"original","source_path":"keep-owned-source"}\n';
  await writeFile(sessionPath, original);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(connectedProjectBindingsId)).map(id => ({ id, completedAt: "2026-10-14T00:00:00.000Z" })) }));
  const before = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.equal(await readFile(sessionPath, "utf8"), original);
  assert.deepEqual(await f.run(true), { pending: [], applied: [connectedProjectBindingsId, claudeRejectedInputId, workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(sessionPath, "utf8"), original);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", connectedProjectBindingsId)), { code: "ENOENT" });

  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const olderSource = source
    .replace('import connectedProjectBindings from "./stateUpgrades/20261015-connected-project-bindings.js";\n', "")
    .replace(', connectedProjectBindings, claudeRejectedInput, workspaceResourceIdentity, goalContinuationIntent, claudeCommandMessages, claudePausedGoal, claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];', '];')
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  await assert.rejects(older.runStateUpgrades({ systemRoot: f.systemRoot, report() {} }), /newer history/u);
});


test("workspace resource identity boundary leaves historical setup unchanged and retries safely", async t => {
  const f = await fixture(t);
  const sessionPath = path.join(f.systemRoot, "projects", "existing", "sessions", "working", "metadata.json");
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const original = '{"workspace_setup":{"status":"succeeded","recipeHash":"original"}}\n';
  await writeFile(sessionPath, original);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(workspaceResourceIdentityId)).map(id => ({ id, completedAt: "2026-10-16T00:00:00.000Z" })) }));
  const before = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.equal(await readFile(sessionPath, "utf8"), original);
  assert.deepEqual(await f.run(true), { pending: [], applied: [workspaceResourceIdentityId, goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(sessionPath, "utf8"), original);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", workspaceResourceIdentityId)), { code: "ENOENT" });
});


test("goal continuation intent boundary never infers historical pause or actor and retries safely", async t => {
  const f = await fixture(t);
  const sessionPath = path.join(f.systemRoot, "projects", "existing", "sessions", "working", "metadata.json");
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const original = '{"assistant_routing_goal":{"status":"paused","objective":"Retain this goal"}}\n';
  await writeFile(sessionPath, original);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(goalContinuationIntentId)).map(id => ({ id, completedAt: "2026-10-16T00:00:00.000Z" })) }));
  const before = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.equal(await readFile(sessionPath, "utf8"), original);
  assert.deepEqual(await f.run(true), { pending: [], applied: [goalContinuationIntentId, claudeCommandMessagesId, claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(sessionPath, "utf8"), original);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", goalContinuationIntentId)), { code: "ENOENT" });
});


test("Claude paused goal boundary preserves historical conversation bytes and retries safely", async t => {
  const f = await fixture(t);
  const conversationPath = path.join(f.systemRoot, "projects", "existing", "conversation.json");
  await mkdir(path.dirname(conversationPath), { recursive: true });
  const original = '{"sent":true,"state":"interrupted"}\n';
  await writeFile(conversationPath, original);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(claudePausedGoalId)).map(id => ({ id, completedAt: "2026-10-17T00:00:00.000Z" })) }));
  const before = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.deepEqual(await f.run(true), { pending: [], applied: [claudePausedGoalId, claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(conversationPath, "utf8"), original);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", claudePausedGoalId)), { code: "ENOENT" });
});

test("Claude blocked goal boundary preserves historical conversation bytes and retries safely", async t => {
  const f = await fixture(t);
  const conversationPath = path.join(f.systemRoot, "projects", "existing", "conversation.json");
  await mkdir(path.dirname(conversationPath), { recursive: true });
  const original = '{"sent":true,"state":"interrupted"}\n';
  await writeFile(conversationPath, original);
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify({ version: 1,
    applied: upgradeIds.slice(0, upgradeIds.indexOf(claudeBlockedGoalId)).map(id => ({ id, completedAt: "2026-10-17T00:00:00.000Z" })) }));
  const before = await readFile(f.ledgerPath);
  assert.deepEqual(await f.run(), { pending: [claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(await readFile(f.ledgerPath), before);
  assert.deepEqual(await f.run(true), { pending: [], applied: [claudeBlockedGoalId, learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(await f.run(true), { pending: [], applied: [] });
  assert.equal(await readFile(conversationPath, "utf8"), original);
  await assert.rejects(stat(path.join(f.systemRoot, "upgrades/backups", claudeBlockedGoalId)), { code: "ENOENT" });
});

test("learning-space reset boundary requires both owners, passes the projects root, gives each its own backup root and records only after apply", async t => {
  const f = await fixture(t);
  const prior = { version: 1, applied: upgradeIds.slice(0, upgradeIds.indexOf(learningSpaceResetId)).map(id => ({ id, completedAt: "2026-10-22T00:00:00.000Z" })) };
  await mkdir(path.dirname(f.ledgerPath), { recursive: true });
  await writeFile(f.ledgerPath, JSON.stringify(prior));
  await assert.rejects(runRegistryUpgrades({ systemRoot: f.systemRoot, report() {}, resetLearningForLearningSpace }),
    /Training learning-space reset and Colleague watch owners are required/u);
  const calls = [];
  const projectsRoot = path.join(f.root, "projects");
  const backupRoot = path.join(f.systemRoot, "upgrades/backups", learningSpaceResetId);
  const options = { systemRoot: f.systemRoot, projectsRoot, report() {},
    resetLearningForLearningSpace: async context => {
      calls.push(["training", context.apply]);
      assert.equal(context.projectsRoot, projectsRoot);
      assert.equal(context.backupRoot, path.join(backupRoot, "training"));
    },
    retireColleagueLearningWatches: async context => {
      calls.push(["colleague", context.apply]);
      assert.equal(context.backupRoot, path.join(backupRoot, "colleague"));
    },
    retireFreeModelRouting: async context => {
      calls.push(["free-routing", context.apply]);
      assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", freeModelRetirementId, "routing"));
    },
    retireColleagueFreeModel: async context => {
      calls.push(["free-colleague", context.apply]);
      assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", freeModelRetirementId, "colleague"));
    },
    upgradeTeamSetupSessions: async context => {
      calls.push(["team-sessions", context.apply]);
      assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", teamSetupsId, "sessions"));
    },
    upgradeTeamSetupRouting: async context => {
      calls.push(["team-routing", context.apply]);
      assert.equal(context.backupRoot, path.join(f.systemRoot, "upgrades/backups", teamSetupsId, "routing"));
    } };
  assert.deepEqual(await runRegistryUpgrades(options), { pending: [learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId], applied: [] });
  assert.deepEqual(JSON.parse(await readFile(f.ledgerPath)), prior);
  await assert.rejects(runRegistryUpgrades({ ...options, apply: true, retireColleagueLearningWatches: async () => { throw new Error("watch retirement failed"); } }),
    /watch retirement failed/u);
  assert.deepEqual(JSON.parse(await readFile(f.ledgerPath)), prior);
  calls.length = 0;
  assert.deepEqual(await runRegistryUpgrades({ ...options, apply: true }), { pending: [], applied: [learningSpaceResetId, freeModelRetirementId, teamSetupsId, retiredTourPreferenceId, retiredProjectBootstrapId, workspaceAssistantNameOnlyId] });
  assert.deepEqual(calls, [["training", false], ["colleague", false], ["free-routing", false], ["free-colleague", false],
    ["team-sessions", false], ["team-routing", false],
    ["training", true], ["colleague", true], ["free-routing", true], ["free-colleague", true], ["team-sessions", true], ["team-routing", true]]);

  const runnerUrl = new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  const olderSource = source.replace('import learningSpaceReset from "./stateUpgrades/20261022-learning-space-reset.js";\n', "")
    .replace(", claudeBlockedGoal, learningSpaceReset, freeModelRetirement, ownerTeamAiSetups, retiredTourPreference, retiredProjectBootstrap, workspaceAssistantNameOnly];", ", claudeBlockedGoal];")
    .replace(/from "(\.\/[^"\n]+)"/gu, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, runnerUrl).href)}`);
  const older = await import(`data:text/javascript,${encodeURIComponent(olderSource)}`);
  const applied = await readFile(f.ledgerPath);
  await assert.rejects(older.runStateUpgrades({ systemRoot: f.systemRoot, report() {} }), /newer history; refusing to upgrade or downgrade/u);
  assert.deepEqual(await readFile(f.ledgerPath), applied);
});
