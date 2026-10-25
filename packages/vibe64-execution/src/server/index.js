export {
  NON_LOGIN_SHELLS,
  assertSafeOsUsername,
  currentOsUser,
  listOsUsers,
  normalizeOsUsername,
  osUserEligibility,
  parsePasswdLine,
  resolveOsUser
} from "./osUserIdentity.js";
export {
  appCredentialContext,
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_CREDENTIAL_SCOPE,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  codexCredentialContext,
  composeGithubTerminalHome,
  credentialHomeRequiredError,
  githubCredentialContext,
  logGithubCredentialHomeResolution,
  normalizeGithubAccountMode,
  resolveGithubHomeForActor,
  resolveGithubHomeForStoredActor
} from "./credentialHomes.js";
export {
  currentActorUser,
  homeEnvForUser
} from "./actor/userIdentity.js";
export {
  EXEC_HELPER_PAYLOAD_SCHEMA_VERSION,
  helperOperationForRequest,
  helperPayload,
  normalizedHelperPayload,
  runHelperCommand
} from "./engines/helperClient.js";
export {
  tryAcquireExclusiveFileLock
} from "./engines/fileLock.js";
export {
  runVibe64Command
} from "./runVibe64Command.js";
export {
  runCaptureCommand
} from "./engines/capture.js";
export {
  VIBE64_MANAGED_EXECUTION_REQUIRED_ENV,
  finishVibe64Workflow,
  installVibe64ManagedExecutionProvider,
  inspectVibe64Service,
  setVibe64WorkflowPhase,
  startVibe64Workflow,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  vibe64CapacityRejectedResult,
  vibe64ManagedExecutionProvider,
  vibe64ManagedExecutionRequired
} from "./managedExecution.js";
export {
  VIBE64_EXECUTION_KINDS,
  VIBE64_EXECUTION_LIFECYCLES,
  normalizeExecutionDescriptor
} from "./request.js";
export {
  checkpointRefRoot,
  checkpointRefs,
  createGitTurnCheckpoint,
  writeGitWorktreeTree
} from "./gitTurnCheckpoint.js";
export {
  resolveCommandEnv
} from "./env/resolveCommandEnv.js";
export {
  ISOLATED_PROCESS_BASE_ENV_NAMES,
  isolatedProcessEnv
} from "./env/isolatedProcessEnv.js";
export {
  GITHUB_SSH_TO_HTTPS_GIT_CONFIG,
  absoluteUniqueGitPaths,
  applyGitConfigEntriesToEnv,
  applyGitSafeDirectoriesToEnv,
  gitSafeDirectoryEntries,
  githubCredentialHelperGitEnv,
  githubGitNonInteractiveEnv,
  githubHttpsGitTransportEnv
} from "./env/gitConfigEnv.js";
export {
  githubGitAuthScript
} from "./env/githubGitAuthShell.js";
export {
  VIBE64_GIT_AUTH_TOKEN_ENV
} from "./env/gitEnv.js";
export {
  DATABASE_ENV_NAMES,
  databaseEnv
} from "./env/databaseEnv.js";
export {
  RESERVED_CALLER_ENV_NAMES,
  commandCallerEnv,
  rejectCallerEnvPolicy
} from "./env/callerEnv.js";
export {
  NPM_CONFIG_PREFIX_ENV,
  npmToolBinDirs,
  npmToolEnv
} from "./env/npmToolEnv.js";
export {
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV,
  GIT_IDENTITY_COMMANDS,
  gitIdentityEnv,
  isFallbackGitIdentityEmail,
  resolveGitIdentity
} from "./env/gitIdentityEnv.js";
export {
  gitFailureError,
  gitInstallCommand
} from "./gitFailure.js";
export {
  shellQuote,
  stableHash
} from "./shellText.js";
export {
  CANONICAL_REPOSITORY_BACKUP_NAME,
  CANONICAL_REPOSITORY_PUSH_OPTION,
  GITHUB_MIRROR_REFRESH_SCRIPT,
  canonicalRepositoryBackupPath,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  githubMirrorRefreshInvocation
} from "./repositoryStorage.js";
export {
  envRecord,
  normalizeText,
  recordValue,
  uniqueStrings
} from "./normalize.js";
export {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD_ENV,
  VIBE64_PLAYWRIGHT_VERSION_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  resolveManagedPlaywrightVersion,
  sharedToolEnv
} from "./env/sharedToolEnv.js";
export {
  configureVibe64Host,
  vibe64Host,
  vibe64ProcessUmask,
  vibe64SharedModes
} from "./hostProfile.js";
export {
  RUNTIME_PACKS,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  managedCommandRuntimeEntries,
  runtimePackBinPaths,
  runtimePackGuardBinPaths,
  runtimePackPolicyBinPaths,
  runtimePackRoot
} from "./runtime/runtimePacks.js";
export {
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  playwrightBrowserLaunchCheckScript,
  playwrightBrowserLaunchCommandArgs,
  playwrightRuntimeVersionCheckScript,
  playwrightRuntimeVersionCommandArgs,
  summarizePlaywrightBrowserLaunchOutput,
  summarizePlaywrightRuntimeOutput
} from "./runtime/browserRuntime.js";
export {
  agentPlaywrightCommandSource
} from "./runtime/agentPlaywrightCommandSource.js";
export {
  agentPreviewBrowserWorkerSource
} from "./runtime/agentPreviewBrowserWorkerSource.js";
export {
  computerPlaywrightModulePath
} from "./runtime/computerPlaywright.js";
export {
  AGENT_PREVIEW_USAGE,
  agentPreviewWrapperSource
} from "./runtime/agentPreviewWrapperSource.js";
export {
  agentEnvWrapperSource
} from "./runtime/agentEnvWrapperSource.js";
export { createVibe64ConversationExecution } from "./conversationExecution.js";
export {
  CHECKED_ON,
  LOCAL_TOOLS,
  SUDO_NOTE,
  localToolFamily,
  localToolGuideUrl,
  localToolIds,
  localToolInstall
} from "./runtime/localTools.js";
export { checkLocalTools, thisComputerToolFamily } from "./runtime/localToolCheck.js";
export {
  OPERATOR_CLIS,
  operatorCliCommand,
  operatorCliInstall,
  operatorCliProblem,
  operatorCliStartFailed,
  resolveOperatorCli
} from "./runtime/operatorCli.js";
export {
  processGroupHasLiveMember,
  processStartIdentityPlatform,
  readProcessStart
} from "./runtime/processStart.js";
export { LOCAL_PLAYWRIGHT_MESSAGE } from "./runtime/agentPlaywrightCommandSource.js";
