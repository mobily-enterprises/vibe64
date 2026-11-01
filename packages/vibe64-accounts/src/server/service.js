import { runVibe64Command } from "@local/vibe64-execution/server";
import { createAccountAccess } from "./accountAccess.js";
import { createAccountCredentials } from "./accountCredentials.js";
import { runDefaultHostCommand } from "./accountHostCommands.js";
import { createAccountStatusReads } from "./accountStatusReads.js";
import { createAuthSessionState, createAuthSessionViews } from "./authSessionViews.js";
import { createAuthTerminals } from "./authTerminals.js";
import { createCodexAccountStatus } from "./codexAccountStatus.js";
import { createCodexProviderKeys } from "./codexProviderKeys.js";
import { createModelRouting } from "./modelRouting.js";

/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").PersonalProfile} PersonalProfile */
/** @typedef {import("./types.js").PublishAccountChanged} PublishAccountChanged */
/** @typedef {ReturnType<typeof import("./accountRealtimeEvents.js").createVibe64AccountAuthSessionChangedPublisher>} PublishAuthSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").TerminalsReadClaudeAccountStatus} TerminalsReadClaudeAccountStatus */
/** @typedef {import("./types.js").TerminalsInspectAssistantRoutingConfiguration} TerminalsInspectAssistantRoutingConfiguration */
/**
 * How the service tells the rest of Vibe64 that an account changed: pages hear
 * account and sign-in session events, and agents drop what they cached.
 * @typedef {object} AccountNotifications
 * @property {TerminalsService["invalidateAgentRuntimes"]} invalidateAgentRuntimes
 * @property {PublishAccountChanged} publishAccountChanged
 * @property {PublishAuthSessionChanged} publishAuthSessionChanged
 */

/**
 * accountRuntime (from createAccountsRuntime) owns roots, credential homes
 * and the AI management policy; the service owns login sessions and status reads.
 * @param {object} dependencies
 * @param {AccountsRuntime} dependencies.accountRuntime
 * @param {RuntimeEnv} [dependencies.env]
 * @param {TerminalsService["invalidateAgentRuntimes"]} dependencies.invalidateAgentRuntimes
 * @param {RuntimeLogger} dependencies.logger
 * @param {PersonalProfile} dependencies.personalProfile
 * @param {TerminalsInspectAssistantRoutingConfiguration} dependencies.inspectRoutingConfiguration
 * @param {PublishAccountChanged} dependencies.publishAccountChanged
 * @param {PublishAuthSessionChanged} dependencies.publishAuthSessionChanged
 * @param {TerminalsReadClaudeAccountStatus} dependencies.readClaudeAccountStatus
 * @param {typeof runDefaultHostCommand} [dependencies.runHostToolCommand]
 * @param {typeof runVibe64Command} [dependencies.runAuthTerminalCommand]
 */
function createService({
  accountRuntime,
  env = process.env,
  invalidateAgentRuntimes,
  logger,
  personalProfile,
  inspectRoutingConfiguration,
  publishAccountChanged,
  publishAuthSessionChanged,
  // Claude conversations' own status read; Accounts shows what they use.
  readClaudeAccountStatus,
  runHostToolCommand = runDefaultHostCommand,
  runAuthTerminalCommand = runVibe64Command
}) {
  /** @type {AccountNotifications} */
  const notifications = Object.freeze({
    invalidateAgentRuntimes,
    publishAccountChanged,
    publishAuthSessionChanged
  });
  const access = createAccountAccess({
    accountRuntime,
    logger,
    notifications,
    runHostToolCommand
  });
  const codexStatus = createCodexAccountStatus({
    access,
    env,
    notifications
  });
  const statusReads = createAccountStatusReads({
    access,
    accountRuntime,
    codexStatus,
    env,
    logger,
    personalProfile,
    readClaudeAccountStatus
  });
  const modelRouting = createModelRouting({
    access,
    inspectRoutingConfiguration,
    notifications
  });
  const providerKeys = createCodexProviderKeys({
    access,
    modelRouting,
    notifications
  });
  const authSessionState = createAuthSessionState();
  const authSessionViews = createAuthSessionViews({
    access,
    notifications,
    state: authSessionState,
    statusReads
  });
  const authTerminals = createAuthTerminals({
    access,
    accountRuntime,
    authSessionViews,
    env,
    logger,
    modelRouting,
    notifications,
    runAuthTerminalCommand,
    state: authSessionState,
    statusReads
  });
  const credentials = createAccountCredentials({
    access,
    authSessionViews,
    env,
    notifications,
    statusReads
  });

  return Object.freeze({
    initializeModelRouting: modelRouting.initializeModelRouting,
    readModelRouting: modelRouting.readModelRouting,
    previewModelRouting: modelRouting.previewModelRouting,
    saveModelRouting: modelRouting.saveModelRouting,
    getStatus: statusReads.getStatus,
    getClaudeStatus: statusReads.getClaudeStatus,
    getCodexStatus: statusReads.getCodexStatus,
    recordGithubAuthInvalid: credentials.recordGithubAuthInvalid,
    startAuth: authTerminals.startAuth,
    saveGitIdentity: credentials.saveGitIdentity,
    readCodexProviders: providerKeys.readCodexProviders,
    saveCodexProvider: providerKeys.saveCodexProvider,
    removeCodexProvider: providerKeys.removeCodexProvider,
    savePersonalAiProfile: statusReads.savePersonalAiProfile,
    readAuthSession: authSessionViews.readAuthSession,
    logout: credentials.logout,
    cancelAuthSession: authSessionViews.cancelAuthSession,
    subscribeAuthTerminal: authSessionViews.subscribeAuthTerminal,
    writeAuthTerminal: authSessionViews.writeAuthTerminal,
    resizeAuthTerminal: authSessionViews.resizeAuthTerminal
  });
}

export {
  createService
};
