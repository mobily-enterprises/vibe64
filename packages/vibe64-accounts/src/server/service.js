import {
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  githubCredentialContext,
  runVibe64Command,
  USER_CREDENTIAL_SCOPE
} from "@local/vibe64-execution/server";
import {
  ALL_CODEX_AUTH_MODES,
  API_KEY_AUTH_MODE,
  BROWSER_AUTH_MODE,
  createAccountsRuntime,
  DEVICE_AUTH_MODE,
  resolveVibe64AccountsRoot
} from "./accountsRuntime.js";
import { createAccountAccess } from "./accountAccess.js";
import { createAccountCredentials } from "./accountCredentials.js";
import { runDefaultHostCommand } from "./accountHostCommands.js";
import { blockedReason, hasAccountSelection } from "./accountRecords.js";
import { createAccountStatusReads } from "./accountStatusReads.js";
import {
  ACCOUNT_AUTH_NAMESPACE,
  authTerminalMetadata,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  codexApiKeyLoginCommandArgs,
  ghLoginCommandArgs,
  GITHUB_DEVICE_AUTH_URL,
  gitIdentitySaveCommandArgs,
  parseAuthOutput,
  REQUIRED_GITHUB_SCOPES,
  terminalArgsForAuth
} from "./authCommands.js";
import { createAuthSessionState, createAuthSessionViews } from "./authSessionViews.js";
import { createAuthTerminals } from "./authTerminals.js";
import { createCodexAccountStatus } from "./codexAccountStatus.js";
import { createCodexProviderKeys } from "./codexProviderKeys.js";
import { GITHUB_GIT_CREDENTIAL_HELPER } from "./githubAccountStatus.js";
import { createModelRouting } from "./modelRouting.js";

/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").PersonalAiProfileStore} PersonalAiProfileStore */
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
 * @param {PersonalAiProfileStore | null} dependencies.personalProfileStore
 * @param {TerminalsInspectAssistantRoutingConfiguration | null} dependencies.inspectRoutingConfiguration
 * @param {PublishAccountChanged} dependencies.publishAccountChanged
 * @param {PublishAuthSessionChanged} dependencies.publishAuthSessionChanged
 * @param {TerminalsReadClaudeAccountStatus | null} dependencies.readClaudeAccountStatus
 * @param {typeof runDefaultHostCommand} [dependencies.runHostToolCommand]
 * @param {typeof runVibe64Command} [dependencies.runAuthTerminalCommand]
 */
function createService({
  accountRuntime,
  env = process.env,
  invalidateAgentRuntimes,
  logger,
  personalProfileStore,
  inspectRoutingConfiguration,
  publishAccountChanged,
  publishAuthSessionChanged,
  // Claude conversations' own status read; Accounts shows what they use.
  readClaudeAccountStatus,
  runHostToolCommand = runDefaultHostCommand,
  runAuthTerminalCommand = runVibe64Command
}) {
  /** @type {AccountNotifications} */
  const notifications = Object.freeze({ invalidateAgentRuntimes, publishAccountChanged, publishAuthSessionChanged });
  const access = createAccountAccess({ accountRuntime, logger, notifications, runHostToolCommand });
  const codexStatus = createCodexAccountStatus({ access, env, notifications });
  const statusReads = createAccountStatusReads({
    access, accountRuntime, codexStatus, env, logger, personalProfileStore, readClaudeAccountStatus
  });
  const modelRouting = createModelRouting({ access, inspectRoutingConfiguration, notifications });
  const providerKeys = createCodexProviderKeys({ access, modelRouting, notifications });
  const authSessionState = createAuthSessionState();
  const authSessionViews = createAuthSessionViews({ access, notifications, state: authSessionState, statusReads });
  const authTerminals = createAuthTerminals({
    access, accountRuntime, authSessionViews, env, logger, modelRouting, notifications, runAuthTerminalCommand,
    state: authSessionState, statusReads
  });
  const credentials = createAccountCredentials({ access, authSessionViews, env, notifications, statusReads });

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
  ACCOUNT_AUTH_NAMESPACE,
  API_KEY_AUTH_MODE,
  APP_CREDENTIAL_SCOPE,
  ALL_CODEX_AUTH_MODES,
  blockedReason,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  codexApiKeyLoginCommandArgs,
  BROWSER_AUTH_MODE,
  DEVICE_AUTH_MODE,
  GITHUB_DEVICE_AUTH_URL,
  GITHUB_GIT_CREDENTIAL_HELPER,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  hasAccountSelection,
  USER_CREDENTIAL_SCOPE,
  parseAuthOutput,
  REQUIRED_GITHUB_SCOPES,
  authTerminalMetadata,
  createAccountsRuntime,
  createService,
  gitIdentitySaveCommandArgs,
  ghLoginCommandArgs,
  terminalArgsForAuth,
  githubCredentialContext,
  resolveVibe64AccountsRoot
};
