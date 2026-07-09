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
  actorHomeEnv,
  currentActorUser,
  currentProcessIdentity,
  normalizeActorUser,
  resolvedActorUser
} from "./actor/userIdentity.js";
export {
  DEFAULT_EXEC_HELPER_PATH,
  EXEC_HELPER_PAYLOAD_SCHEMA,
  EXEC_HELPER_PAYLOAD_SCHEMA_VERSION,
  VIBE64_EXEC_HELPER_PATH_ENV,
  helperPayload,
  normalizedHelperPayload,
  runHelperCommand
} from "./engines/helperClient.js";
export {
  REPAIR_OPERATION,
  absoluteUniquePaths,
  hostedManagedSourcePermissionsRequired,
  managedSourcePermissionPaths,
  repairManagedSourcePermissions
} from "./managedSourcePermissions.js";
export {
  runVibe64Command
} from "./runVibe64Command.js";
export {
  resolveCommandEnv
} from "./env/resolveCommandEnv.js";
export {
  GITHUB_SSH_TO_HTTPS_GIT_CONFIG,
  absoluteUniqueGitPaths,
  applyGitConfigEntriesToEnv,
  applyGitSafeDirectoriesToEnv,
  gitSafeDirectoryArgs,
  gitSafeDirectoryEntries,
  githubCredentialHelperGitEnv,
  githubGitNonInteractiveEnv,
  githubHttpsGitTransportEnv,
  githubSshToHttpsGitEnv
} from "./env/gitConfigEnv.js";
export {
  githubGitAuthScript
} from "./env/githubGitAuthShell.js";
export {
  DATABASE_ENV_ALIASES,
  DATABASE_ENV_NAMES,
  databaseEnv
} from "./env/databaseEnv.js";
export {
  POLICY_OWNED_CALLER_ENV_NAMES,
  RESERVED_CALLER_ENV_NAMES,
  commandCallerEnv,
  rejectCallerEnvPolicy
} from "./env/callerEnv.js";
export {
  NPM_CONFIG_PREFIX_ENV,
  npmConfigPrefix,
  npmToolBinDirs,
  npmToolEnv
} from "./env/npmToolEnv.js";
export {
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV,
  fallbackGitIdentity,
  gitIdentityEnv,
  gitIdentityReadiness,
  resolveGitIdentity,
  sanitizeEmailLabel
} from "./env/gitIdentityEnv.js";
export {
  shellQuote,
  stableHash
} from "./shellText.js";
export {
  DEFAULT_PLAYWRIGHT_CACHE_NAME,
  DEFAULT_VIBE64_SHARED_CACHE_ROOT,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV,
  resolvePlaywrightBrowsersPath,
  resolveVibe64SharedCacheRoot,
  sharedToolEnv,
  sharedToolEnvShellExportLines
} from "./env/sharedToolEnv.js";
export {
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  VIBE64_RUNTIME_PACK_ROOT_ENV,
  runtimePackBinPaths,
  runtimePackRoot
} from "./runtime/runtimePacks.js";
export {
  isValidPlaywrightBrowserLaunchOutput,
  PLAYWRIGHT_CHROMIUM_SYSTEM_PACKAGES,
  playwrightBrowserInstallCommandArgs,
  playwrightBrowserInstallScript,
  playwrightBrowserLaunchCheckScript,
  playwrightBrowserLaunchCommandArgs,
  playwrightExecutableCheckScript,
  summarizePlaywrightBrowserLaunchOutput,
  playwrightSystemDependencyInstallScript,
  playwrightRuntimeEnv
} from "./runtime/browserRuntime.js";
