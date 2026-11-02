export {
  assertSafeOsUsername,
  currentOsUser,
  listOsUsers,
  normalizeOsUsername,
  osUserEligibility,
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
  githubCredentialContext,
  normalizeGithubAccountMode,
  resolveGithubHomeForStoredActor
} from "./credentialHomes.js";
export {
  currentActorUser,
  homeEnvForUser
} from "./actor/userIdentity.js";
export {
  helperOperationForRequest,
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
  stopVibe64RestoredService,
  vibe64CapacityRejectedResult,
  vibe64ManagedExecutionProvider,
  vibe64ManagedExecutionRequired
} from "./managedExecution.js";
export {
  checkpointRefRoot,
  checkpointRefs,
  createGitTurnCheckpoint,
  createGitTurnCheckpointAsOneJob,
  writeGitWorktreeTree
} from "./gitTurnCheckpoint.js";
export {
  resolveCommandEnv
} from "./env/resolveCommandEnv.js";
export {
  isolatedProcessEnv
} from "./env/isolatedProcessEnv.js";
export {
  githubGitAuthScript
} from "./env/githubGitAuthShell.js";
export {
  commandCallerEnv,
  rejectCallerEnvPolicy
} from "./env/callerEnv.js";
export {
  NPM_CONFIG_PREFIX_ENV
} from "./env/npmToolEnv.js";
export {
  GIT_IDENTITY_COMMANDS,
  isFallbackGitIdentityEmail
} from "./env/gitIdentityEnv.js";
export {
  gitFailureError
} from "./gitFailure.js";
export {
  shellQuote,
  stableHash
} from "./shellText.js";
export {
  GITHUB_MIRROR_REFRESH_SCRIPT,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  githubMirrorRefreshInvocation
} from "./repositoryStorage.js";
export {
  envRecord,
  normalizeText,
  recordValue,
  timestampMs,
  uniqueStrings
} from "./normalize.js";
export {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV
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
  runtimePackBinPaths,
  runtimePackPolicyBinPaths,
  runtimePackRoot
} from "./runtime/runtimePacks.js";
export {
  isValidPlaywrightBrowserLaunchOutput,
  isValidPlaywrightRuntimeOutput,
  playwrightBrowserLaunchCommandArgs,
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
  localToolInstall,
  thisComputerToolFamily
} from "./runtime/localTools.js";
export { checkLocalTools } from "./runtime/localToolCheck.js";
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
