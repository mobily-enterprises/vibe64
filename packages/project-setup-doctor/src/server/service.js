import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readFile,
  readdir
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  readTerminalSession,
  startTerminalSession,
  updateTerminalSessionMetadata
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  closeOwnedTerminalSession,
  readOwnedTerminalSession,
  writeOwnedTerminalSession
} from "@local/studio-terminal-core/server/terminalAccess";
import {
  createRepositoryReadyStatusCache
} from "@local/setup-doctor-core/server/doctorStatusCache";
import {
  listDoctorPluginChecks,
  runDoctorCheck,
  startDoctorPluginTerminal
} from "@local/setup-doctor-core/server/doctorPlugins";
import {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
} from "@local/setup-doctor-core/server/githubRemote";
import {
  linkedGitMetadataMountSource
} from "@local/studio-terminal-core/server/gitToolchainMounts";
import {
  runDoctorGit
} from "@local/setup-doctor-core/server/doctorToolchainCommands";
import {
  blockedDoctorCheck as blockedCheck,
  doctorCheckPassed as checkPassed,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck,
  pendingDoctorCheck as pendingCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  ADD_VIBE64_GITIGNORE_RULES_ACTION_ID,
  GIT_IDENTITY_ACTION_ID,
  VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS,
  CREATE_GIT_CHECKPOINT_ACTION_ID,
  MIRROR_REMOTE_BRANCH_ACTION_ID,
  PUSH_GIT_CHECKPOINT_ACTION_ID,
  addVibe64GitignoreRulesRepair,
  ghRepoCreateRepair,
  ghRepoCreateScript,
  gitCheckpointRepair,
  gitCheckpointScript,
  gitIdentityRepair,
  gitInitRepair,
  githubBranchRefApiPath,
  hostWritableWorkspaceDockerArgs,
  linkGithubRemoteRepair,
  localGitCheckpointRepair,
  mirrorRemoteBranchRepair,
  readGitIdentity,
  readGithubRepository,
  readRemoteBranchShaWithGh,
  startAddVibe64GitignoreRulesTerminal as startSharedAddVibe64GitignoreRulesTerminal,
  startGhCreateRepoTerminal as startSharedGhCreateRepoTerminal,
  startGitIdentityTerminal as startSharedGitIdentityTerminal,
  startGitCheckpointTerminal as startSharedGitCheckpointTerminal,
  startGitInitTerminal as startSharedGitInitTerminal,
  startLinkGithubRemoteTerminal as startSharedLinkGithubRemoteTerminal,
  startLocalGitCheckpointTerminal as startSharedLocalGitCheckpointTerminal,
  startMirrorRemoteBranchTerminal as startSharedMirrorRemoteBranchTerminal
} from "@local/setup-doctor-core/server/setupDoctorGit";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  composeGithubTerminalHome,
  githubCredentialContext,
  normalizeGithubAccountMode
} from "@local/studio-terminal-core/server/credentialHomes";
import {
  terminalOwnerFromGithubToolHome,
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  normalizeRepositoryMode,
  normalizeWorkflowRepositoryProfile,
  workflowRepositoryProfileForMode
} from "@local/vibe64-core/server/projectRepository";

const TERMINAL_NAMESPACE = "project-setup-doctor";
const AUTOMATIC_REPAIR_MAX_ATTEMPTS = 12;
const AUTOMATIC_REPAIR_TIMEOUT_MS = 30 * 60 * 1000;
const AUTOMATIC_REPAIR_POLL_MS = 250;
const REPAIRABLE_STATUSES = Object.freeze(["blocked", "fail", "hard-stop"]);
const SOURCE_BOOTSTRAP_ENTRIES = new Set([
  ".gitignore",
  ".vibe64"
]);
const PROJECT_BOOTSTRAP_REPOSITORY_SOURCES = new Set([
  "github-created"
]);
const SEED_APPLICATION_WORKFLOW_DEFINITION_ID = "seed_application";
const PROJECT_SETUP_REPOSITORY_PROFILE_GITHUB = WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;
const PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL = WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE;
const REMOTE_MIRROR_ALLOWED_BOOTSTRAP_ENTRIES = new Set([
  ".gitignore",
  ".vibe64"
]);
const READY_CACHE_NON_PROJECT_ENTRIES = new Set([
  ".git",
  "node_modules"
]);
const execFileAsync = promisify(execFile);

function normalizeProjectSetupRepositoryProfile(value = "") {
  const profile = normalizeWorkflowRepositoryProfile(value);
  if (profile === WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR) {
    return PROJECT_SETUP_REPOSITORY_PROFILE_GITHUB;
  }
  if (
    profile === WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT ||
    profile === WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
  ) {
    return PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL;
  }
  return "";
}

function projectSetupRepositoryProfileForInput(input = {}) {
  const profile = normalizeProjectSetupRepositoryProfile(
    input.repositorySetupProfile ||
    input.workflowRepositoryProfile ||
    input.workflow_repository_profile
  );
  if (profile) {
    return profile;
  }
  const modeProfile = workflowRepositoryProfileForMode(
    normalizeRepositoryMode(input.repositoryMode || input.repository_mode || input.repository?.mode)
  );
  return normalizeProjectSetupRepositoryProfile(modeProfile);
}

function projectSetupRepositoryProfileForProject(project = {}) {
  const explicitProfile = projectSetupRepositoryProfileForInput(project);
  if (explicitProfile) {
    return explicitProfile;
  }
  if (project?.githubRepository || project?.repository?.github) {
    return PROJECT_SETUP_REPOSITORY_PROFILE_GITHUB;
  }
  return PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL;
}

function projectSetupUsesGithub(contextOrProfile = {}) {
  const profile = typeof contextOrProfile === "string"
    ? contextOrProfile
    : contextOrProfile?.repositorySetupProfile;
  return normalizeProjectSetupRepositoryProfile(profile) === PROJECT_SETUP_REPOSITORY_PROFILE_GITHUB;
}

function projectSetupCacheScope({
  githubProvider = null,
  repositorySetupProfile = PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL
} = {}) {
  if (projectSetupUsesGithub(repositorySetupProfile)) {
    return githubProvider?.userKey ? `github:${githubProvider.userKey}` : "github:unknown";
  }
  return `repository:${PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL}`;
}

function appendPendingChecks(stages, checks, startIndex) {
  return [
    ...stages,
    ...checks.slice(startIndex).map(pendingCheck)
  ];
}

function assertUniqueCheckIds(checks) {
  const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new Error(`Duplicate Project Setup check id: ${check.id}`);
    }
    seen.add(check.id);
  }
}

function refreshRequested(input = {}) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
}

function projectSetupCacheConfigKey(config = {}) {
  return stableJson({
    adapterId: config?.adapter?.id || "",
    projectType: config?.projectType || "",
    values: config?.values || {}
  });
}

function finalizeStatus({
  context,
  stages,
  targetRoot
}) {
  const currentStage = stages.find((item) => item.required !== false && item.status !== "pass") || null;
  const readiness = context.readiness || null;
  const ready = readiness?.ready === false
    ? false
    : stages.every((item) => item.required === false || item.status === "pass");

  return {
    currentStageId: currentStage?.id || "",
    hardStop: stages.some((item) => item.status === "hard-stop"),
    ok: true,
    ...(readiness ? { readiness } : {}),
    ready,
    stages,
    targetRoot,
    updatedAt: new Date().toISOString(),
    summary: {
      nonGitEntries: context.nonGitEntries || [],
      originUrl: context.originUrl || "",
      projectSetupCacheConfigKey: context.projectSetupCacheConfigKey || "",
      remoteDefaultBranch: context.remoteDefaultBranch || ""
    }
  };
}

function repairsForStage(stage = {}) {
  return [
    stage.repair,
    ...(Array.isArray(stage.repairs) ? stage.repairs : [])
  ].filter(Boolean);
}

function terminalRepairActionIds(status = {}) {
  return new Set((Array.isArray(status.stages) ? status.stages : [])
    .flatMap(repairsForStage)
    .filter((repair) => repair.kind === "terminal" && repair.actionId)
    .map((repair) => repair.actionId));
}

function stableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value || {});
  }
  const ordered = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    ordered[key] = value[key];
  }
  return JSON.stringify(ordered);
}

function hasProjectEntryForReadyCache(entries = []) {
  return entries.some((entry) => !READY_CACHE_NON_PROJECT_ENTRIES.has(entry));
}

async function readTextFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function pathIsReadable(filePath = "") {
  if (!filePath) {
    return false;
  }
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function runGitCache(gitDir = "", args = []) {
  const result = await execFileAsync("git", [
    `--git-dir=${path.resolve(gitDir)}`,
    ...args
  ], {
    maxBuffer: 16 * 1024 * 1024
  });
  return String(result.stdout || "").trim();
}

function normalizeSetupText(value = "") {
  return String(value || "").trim();
}

function projectUsesBootstrapRepository(project = {}) {
  const source = normalizeSetupText(project.githubRepository?.source || project.repository?.source);
  if (normalizeRepositoryMode(project.repositoryMode || project.repository?.mode) === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    return true;
  }
  return PROJECT_BOOTSTRAP_REPOSITORY_SOURCES.has(source);
}

function projectRepositoryDefaultBranch(project = {}) {
  return normalizeSetupText(
    project.repository?.defaultBranch ||
    project.githubRepository?.defaultBranch ||
    project.repository?.github?.defaultBranch
  );
}

async function gitCacheRefIsMissing(gitDir = "", ref = "") {
  const normalizedRef = normalizeSetupText(ref);
  if (!normalizedRef) {
    return true;
  }
  if (normalizedRef === "HEAD") {
    const head = normalizeSetupText(await readTextFile(path.join(gitDir, "HEAD")));
    const refMatch = head.match(/^ref:\s*(.+?)\s*$/iu);
    if (refMatch?.[1]) {
      return !normalizeSetupText(await readGitRefSha(gitDir, refMatch[1].trim()));
    }
    return !head;
  }
  return !normalizeSetupText(await readGitRefSha(gitDir, normalizedRef));
}

async function sortedDirectoryNames(root = "") {
  try {
    return (await readdir(root, {
      withFileTypes: true
    }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function readSeedSessionBootstrapState(projectRuntimeRoot = "") {
  const activeSessionsRoot = path.join(projectRuntimeRoot, "sessions", "active");
  const sessionIds = await sortedDirectoryNames(activeSessionsRoot);
  for (const sessionId of sessionIds) {
    const sessionRoot = path.join(activeSessionsRoot, sessionId);
    const metadataRoot = path.join(sessionRoot, "metadata");
    const workflowDefinition = normalizeSetupText(
      await readTextFile(path.join(metadataRoot, "workflow_definition"))
    );
    if (workflowDefinition !== SEED_APPLICATION_WORKFLOW_DEFINITION_ID) {
      continue;
    }
    const status = normalizeSetupText(await readTextFile(path.join(sessionRoot, "status"))) || "active";
    const currentStep = normalizeSetupText(await readTextFile(path.join(sessionRoot, "current_step")));
    return {
      currentStep,
      sessionId,
      status
    };
  }
  return null;
}

function seedBootstrapReadiness(seedSession = null) {
  if (!seedSession) {
    return {
      label: "Seed required",
      progressText: "Project shell is ready. Start a seed session to create the first committed project baseline.",
      ready: false,
      reason: "seed_required",
      state: "waiting",
      title: "Seed required"
    };
  }
  const blocked = seedSession.status === "blocked";
  return {
    label: blocked ? "Seed needs attention" : "Seed in progress",
    progressText: blocked
      ? `Project shell is ready. Seed session ${seedSession.sessionId} needs attention before it can create the first committed project baseline.`
      : `Project shell is ready. Seed session ${seedSession.sessionId} is creating the first committed project baseline.`,
    ready: false,
    reason: blocked ? "seed_needs_attention" : "seed_in_progress",
    seedSessionId: seedSession.sessionId,
    seedSessionStatus: seedSession.status,
    seedSessionStep: seedSession.currentStep,
    state: "waiting",
    title: blocked ? "Seed needs attention" : "Seed in progress"
  };
}

async function gitDirectoryForTargetRoot(targetRoot) {
  const markerPath = path.join(targetRoot, ".git");
  let markerStat = null;
  try {
    markerStat = await lstat(markerPath);
  } catch {
    return "";
  }
  if (markerStat.isDirectory()) {
    return markerPath;
  }
  if (!markerStat.isFile()) {
    return "";
  }
  const marker = await readTextFile(markerPath);
  const match = marker.match(/^gitdir:\s*(.+?)\s*$/imu);
  return match?.[1] ? path.resolve(targetRoot, match[1].trim()) : "";
}

async function gitCommonDirectory(gitDir) {
  const commonDir = (await readTextFile(path.join(gitDir, "commondir"))).trim();
  return commonDir ? path.resolve(gitDir, commonDir) : gitDir;
}

function packedRefSha(packedRefsText = "", refName = "") {
  for (const line of packedRefsText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) {
      continue;
    }
    const [sha, name] = trimmed.split(/\s+/u);
    if (name === refName && sha) {
      return sha;
    }
  }
  return "";
}

async function readGitRefSha(gitDir, refName) {
  const commonDir = await gitCommonDirectory(gitDir);
  for (const root of [gitDir, commonDir]) {
    const refText = (await readTextFile(path.join(root, refName))).trim();
    if (refText) {
      return refText;
    }
  }
  return packedRefSha(await readTextFile(path.join(commonDir, "packed-refs")), refName);
}

async function readProjectGitHeadShaFromFiles(targetRoot) {
  const gitDir = await gitDirectoryForTargetRoot(targetRoot);
  if (!gitDir) {
    return "";
  }
  const head = (await readTextFile(path.join(gitDir, "HEAD"))).trim();
  const refMatch = head.match(/^ref:\s*(.+?)\s*$/iu);
  return refMatch?.[1] ? readGitRefSha(gitDir, refMatch[1].trim()) : head;
}

function originUrlFromGitConfig(configText = "") {
  let inOriginSection = false;
  for (const line of configText.split(/\r?\n/u)) {
    if (/^\s*\[remote\s+"origin"\]\s*$/iu.test(line)) {
      inOriginSection = true;
      continue;
    }
    if (/^\s*\[/u.test(line)) {
      inOriginSection = false;
      continue;
    }
    if (inOriginSection) {
      const match = line.match(/^\s*url\s*=\s*(.*?)\s*$/iu);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }
  return "";
}

async function readProjectGitOriginRemoteFromFiles(targetRoot) {
  const gitDir = await gitDirectoryForTargetRoot(targetRoot);
  if (!gitDir) {
    return "";
  }
  const commonDir = await gitCommonDirectory(gitDir);
  return originUrlFromGitConfig(await readTextFile(path.join(commonDir, "config")));
}

async function readToolchainGit(targetRoot, args = [], {
  timeout = 15_000
} = {}) {
  return runDoctorGit(targetRoot, args, {
    timeout
  });
}

function gitProbeResult({
  exitCode = 1,
  output = ""
} = {}) {
  const normalizedOutput = String(output || "").trim();
  return {
    exitCode,
    ok: exitCode === 0,
    output: normalizedOutput,
    stderr: exitCode === 0 ? "" : normalizedOutput,
    stdout: exitCode === 0 ? normalizedOutput : ""
  };
}

function gitConfigIsBare(configText = "") {
  let inCoreSection = false;
  for (const line of String(configText || "").split(/\r?\n/u)) {
    if (/^\s*\[core\]\s*$/iu.test(line)) {
      inCoreSection = true;
      continue;
    }
    if (/^\s*\[/u.test(line)) {
      inCoreSection = false;
      continue;
    }
    if (inCoreSection && /^\s*bare\s*=\s*true\s*$/iu.test(line)) {
      return true;
    }
  }
  return false;
}

async function readProjectGitRepositoryShape(targetRoot) {
  const gitDir = await gitDirectoryForTargetRoot(targetRoot);
  if (!gitDir) {
    const failure = gitProbeResult({
      output: "No Git metadata directory."
    });
    return {
      bare: failure,
      branch: failure,
      inside: failure
    };
  }
  const head = (await readTextFile(path.join(gitDir, "HEAD"))).trim();
  if (!head) {
    const failure = gitProbeResult({
      output: "Missing Git HEAD."
    });
    return {
      bare: failure,
      branch: failure,
      inside: failure
    };
  }
  const commonDir = await gitCommonDirectory(gitDir);
  const branchMatch = head.match(/^ref:\s*refs\/heads\/(.+?)\s*$/iu);
  return {
    bare: gitProbeResult({
      exitCode: 0,
      output: gitConfigIsBare(await readTextFile(path.join(commonDir, "config"))) ? "true" : "false"
    }),
    branch: gitProbeResult({
      exitCode: 0,
      output: branchMatch?.[1] || ""
    }),
    inside: gitProbeResult({
      exitCode: 0,
      output: "true"
    })
  };
}

async function readProjectGitLocalHead(targetRoot) {
  return readToolchainGit(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
}

async function readProjectGitOriginRemote(targetRoot) {
  return readToolchainGit(targetRoot, ["remote", "get-url", "origin"]);
}

async function readProjectGitStatus(targetRoot) {
  return readToolchainGit(targetRoot, ["status", "--porcelain=v1"], {
    timeout: 15_000
  });
}

async function projectRemoteHeadIsAncestorOfLocalHead(targetRoot, remoteSha) {
  const result = await readToolchainGit(targetRoot, ["merge-base", "--is-ancestor", remoteSha, "HEAD"], {
    timeout: 15_000
  });
  return result.ok;
}

async function readProjectRemoteBranchShaWithGit(targetRoot, branch) {
  const result = await readToolchainGit(targetRoot, ["ls-remote", "origin", `refs/heads/${branch}`], {
    timeout: 20_000
  });
  return {
    ...result,
    sha: result.stdout.split(/\s+/u)[0] || ""
  };
}

async function readProjectRemoteDefaultBranchSha(targetRoot, branch, context = {}, {
  readGitBranchSha = readProjectRemoteBranchShaWithGit,
  readGithubBranchSha = readRemoteBranchShaWithGh
} = {}) {
  let originUrl = String(context?.originUrl || "").trim();
  if (!originUrl) {
    const origin = await readProjectGitOriginRemote(targetRoot);
    originUrl = origin.ok ? String(origin.stdout || "").trim() : "";
  }
  if (!isGithubRemoteUrl(originUrl)) {
    return readGitBranchSha(targetRoot, branch);
  }

  const githubProvider = await requireGithubProvider(context);
  if (!githubProvider.ok) {
    return githubProvider;
  }
  return readGithubBranchSha(targetRoot, repoSlugFromRemoteUrl(originUrl), branch, {
    ...githubToolHomeOptions(githubProvider)
  });
}

function automaticRepairInputs(repair = {}) {
  const inputs = repair.input && typeof repair.input === "object" && !Array.isArray(repair.input)
    ? { ...repair.input }
    : {};
  for (const field of Array.isArray(repair.fields) ? repair.fields : []) {
    const value = String(field.defaultValue || "").trim();
    if (field.required && !value) {
      return null;
    }
    inputs[field.id] = value;
  }
  return inputs;
}

function automaticRepairKey(stage = {}, repair = {}, inputs = {}) {
  return [
    stage.id || "",
    stage.status || "",
    stage.observed || "",
    repair.actionId || "",
    repair.commandPreview || "",
    stableJson(inputs)
  ].join("\n---\n");
}

function automaticRepairCandidate(stage = {}, repair = {}, attemptedKeys = new Set()) {
  if (!REPAIRABLE_STATUSES.includes(stage.status) ||
    repair.autoRun !== true ||
    repair.kind !== "terminal" ||
    !repair.actionId) {
    return null;
  }
  const inputs = automaticRepairInputs(repair);
  if (inputs === null) {
    return null;
  }
  const key = automaticRepairKey(stage, repair, inputs);
  if (attemptedKeys.has(key)) {
    return null;
  }
  return {
    inputs,
    key,
    repair,
    stage
  };
}

function findAutomaticRepairCandidate(status = {}, attemptedKeys = new Set()) {
  for (const stage of Array.isArray(status.stages) ? status.stages : []) {
    if (!REPAIRABLE_STATUSES.includes(stage?.status)) {
      continue;
    }
    for (const repair of repairsForStage(stage)) {
      const candidate = automaticRepairCandidate(stage, repair, attemptedKeys);
      if (candidate) {
        return candidate;
      }
    }
  }
  return null;
}

function findAttemptedAutomaticRepairCandidate(status = {}, attemptedKeys = new Set()) {
  for (const stage of Array.isArray(status.stages) ? status.stages : []) {
    if (!REPAIRABLE_STATUSES.includes(stage?.status)) {
      continue;
    }
    for (const repair of repairsForStage(stage)) {
      const inputs = automaticRepairInputs(repair);
      if (inputs === null ||
        repair.autoRun !== true ||
        repair.kind !== "terminal" ||
        !repair.actionId) {
        continue;
      }
      const key = automaticRepairKey(stage, repair, inputs);
      if (attemptedKeys.has(key)) {
        return {
          inputs,
          key,
          repair,
          stage
        };
      }
    }
  }
  return null;
}

function tailText(text = "", limit = 4000) {
  const value = String(text || "").trim();
  if (value.length <= limit) {
    return value;
  }
  return value.slice(value.length - limit);
}

function repairResultFailure(result = {}) {
  if (!result || result.ok === false) {
    return result?.error || "Terminal repair did not start.";
  }
  if (result.closeError) {
    return result.closeError;
  }
  if (Number.isInteger(result.exitCode) && result.exitCode !== 0) {
    return `Exit code ${result.exitCode}.`;
  }
  return "";
}

function annotateAutomaticRepairStatus(status = {}, candidate = {}, message = "") {
  const stageId = candidate.stage?.id || "";
  return {
    ...status,
    stages: (Array.isArray(status.stages) ? status.stages : []).map((stage) => {
      if (stage.id !== stageId) {
        return stage;
      }
      return {
        ...stage,
        observed: [
          stage.observed,
          String(message || "").trim()
        ].filter(Boolean).join("\n\n")
      };
    }),
    updatedAt: new Date().toISOString()
  };
}

function automaticRepairFailureStatus(status, candidate, result = {}) {
  const label = candidate.repair?.label || candidate.repair?.actionId || "automatic repair";
  const failure = repairResultFailure(result);
  const output = tailText(result.output || result.stderr || result.stdout || "");
  return annotateAutomaticRepairStatus(status, candidate, [
    `Automatic repair failed: ${label}`,
    failure,
    output
  ].filter(Boolean).join("\n"));
}

function automaticRepairStillBlockedStatus(status, candidate) {
  const label = candidate.repair?.label || candidate.repair?.actionId || "automatic repair";
  return annotateAutomaticRepairStatus(
    status,
    candidate,
    `Automatic repair completed but this stage is still blocked: ${label}`
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function projectGitInitRepair(targetRoot) {
  return gitInitRepair(targetRoot, {
    extraArgs: hostWritableWorkspaceDockerArgs()
  });
}

async function ensureGithubCredentialHome(githubProvider = {}) {
  return githubProvider;
}

async function requireGithubProvider(context = {}) {
  const githubProvider = await ensureGithubCredentialHome(context.githubProvider || null);
  return githubProvider?.ok ? githubProvider : {
    code: githubProvider?.code || "vibe64_github_user_required",
    error: githubProvider?.error || "Authenticate GitHub for this local Vibe64 editor before running GitHub project setup.",
    ok: false
  };
}

function githubProviderBlockedCheck({
  expected = "",
  id = "",
  label = "",
  observed = ""
} = {}) {
  return blockedCheck({
    id,
    label,
    expected,
    observed,
    explanation: "Project setup needs GitHub CLI credentials for repository access and commit publishing. Use the local setup terminal to authenticate GitHub for this editor."
  });
}

function githubToolHomeOptions(providerOrContext = {}) {
  const provider = providerOrContext.githubProvider?.ok
    ? providerOrContext.githubProvider
    : providerOrContext;
  return {
    githubToolHomeSource: provider?.ok ? provider.githubToolHomeSource || provider.toolHomeSource || "" : "",
    toolHomeSource: provider?.ok ? provider.toolHomeSource || "" : ""
  };
}

function projectSetupTerminalOwnerMetadata({
  actionId = "",
  githubProvider = null
} = {}) {
  if (!githubProvider?.ok) {
    return null;
  }
  return {
    ...terminalOwnerMetadata(terminalOwnerFromGithubToolHome({
      accountMode: githubProvider.accountMode || GITHUB_ACCOUNT_MODE_LOCAL,
      credentialScope: githubProvider.credentialScope || "",
      ownerUserKey: githubProvider.userKey || "",
      githubToolHomeSource: githubProvider.githubToolHomeSource || "",
      toolHomeSource: githubProvider.githubToolHomeSource || githubProvider.toolHomeSource || ""
    })),
    projectSetupActionId: String(actionId || ""),
    terminalKind: TERMINAL_NAMESPACE
  };
}

function recordProjectSetupTerminalOwner(terminal = {}, metadata = null) {
  if (!terminal?.ok || !terminal.id || !metadata) {
    return terminal;
  }
  return updateTerminalSessionMetadata(terminal.id, metadata, {
    namespace: TERMINAL_NAMESPACE
  });
}

function missingVibe64GitignorePatterns(gitignoreText = "") {
  const lines = new Set(String(gitignoreText || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean));
  return VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.filter((pattern) => !lines.has(pattern));
}

function nonBootstrapRemoteMirrorEntries(context = {}) {
  return (Array.isArray(context.nonGitEntries) ? context.nonGitEntries : [])
    .filter((entry) => !REMOTE_MIRROR_ALLOWED_BOOTSTRAP_ENTRIES.has(entry));
}

async function projectSetupReadyCacheApplies(status = {}, {
  readConfig = null,
  targetRoot
} = {}) {
  if (status?.ready !== true) {
    return true;
  }

  const cachedConfigKey = String(status?.summary?.projectSetupCacheConfigKey || "");
  if (!cachedConfigKey) {
    return false;
  }

  const entries = await listMeaningfulEntries(targetRoot);
  if (!hasProjectEntryForReadyCache(entries)) {
    return false;
  }

  const localHead = await readProjectGitHeadShaFromFiles(targetRoot);
  if (!localHead) {
    return false;
  }

  const cachedOriginUrl = String(status?.summary?.originUrl || "").trim();
  if (!cachedOriginUrl) {
    return false;
  }

  const origin = await readProjectGitOriginRemoteFromFiles(targetRoot);
  if (origin !== cachedOriginUrl) {
    return false;
  }

  let config = {};
  try {
    config = typeof readConfig === "function" ? await readConfig() : {};
  } catch {
    return false;
  }
  return cachedConfigKey === projectSetupCacheConfigKey(config);
}

async function readReusableProjectSetupStatus(cache, {
  readConfig = null,
  targetRoot
} = {}) {
  const cachedStatus = await cache.read();
  if (!cachedStatus) {
    return null;
  }
  if (await projectSetupReadyCacheApplies(cachedStatus, {
    readConfig,
    targetRoot
  })) {
    return cachedStatus;
  }
  await cache.remember(null);
  return null;
}

async function pluginTerminalActionIsAvailable({
  actionId = "",
  setupRuntime = {},
  studioRoot = "",
  targetRoot = ""
} = {}) {
  const status = await inspectProjectSetup({
    config: setupRuntime.config,
    configEnvironment: setupRuntime.configEnvironment,
    setupPlugins: setupRuntime.setupPlugins,
    studioRoot,
    targetRoot
  });
  return terminalRepairActionIds(status).has(actionId);
}

async function listMeaningfulEntries(targetRoot) {
  const ignored = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
  const entries = await readdir(targetRoot, {
    withFileTypes: true
  });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !ignored.has(name))
    .sort((left, right) => left.localeCompare(right));
}


async function checkDirectory(targetRoot, context) {
  try {
    await access(targetRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory exists and is readable/writable.",
      observed: String(error?.message || error),
      explanation: "Studio cannot operate until the target directory is reachable."
    });
  }

  const entries = await listMeaningfulEntries(targetRoot);
  const nonGitEntries = entries.filter((entry) => {
    return entry !== ".git" && !SOURCE_BOOTSTRAP_ENTRIES.has(entry);
  });
  context.entries = entries;
  context.nonGitEntries = nonGitEntries;
  context.sourceBootstrapEntries = entries.filter((entry) => SOURCE_BOOTSTRAP_ENTRIES.has(entry));

  let gitStat = null;
  try {
    gitStat = await lstat(path.join(targetRoot, ".git"));
  } catch {
    gitStat = null;
  }

  if (!gitStat && nonGitEntries.length) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "A directory without .git is empty.",
      observed: `No .git directory, but files exist:\n${formatList(nonGitEntries)}`,
      explanation: "Studio will not initialize Git over existing files because it cannot know their ownership."
    });
  }

  if (!gitStat) {
    context.directoryMode = "empty-no-git";
    return passCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git repository.",
      observed: context.sourceBootstrapEntries.length
        ? `No project files yet. Source bootstrap files exist:\n${formatList(context.sourceBootstrapEntries)}`
        : "Empty directory with no .git.",
      explanation: "Studio can safely initialize this directory because only source-owned bootstrap files are present."
    });
  }

  if (!gitStat.isDirectory() && linkedGitMetadataMountSource(targetRoot)) {
    context.directoryMode = "git-repo";
    return passCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git work tree.",
      observed: ".git file points to linked Git metadata.",
      explanation: "Studio can continue with Git safety checks."
    });
  }

  if (!gitStat.isDirectory()) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: ".git is a directory or a valid linked worktree metadata file.",
      observed: ".git is not a directory.",
      explanation: "Studio could not resolve the .git file to existing Git metadata."
    });
  }

  context.directoryMode = "git-repo";
  return passCheck({
    id: "directory",
    label: "Directory admissibility",
    expected: "Target directory is empty or already a Git repository.",
    observed: ".git directory exists.",
    explanation: "Studio can continue with Git safety checks."
  });
}

async function checkGitReady(targetRoot, context) {
  if (context.directoryMode === "empty-no-git") {
    return blockedCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "A non-bare Git repository exists with a named branch.",
      observed: "No .git directory.",
      explanation: "Initialize Git before Studio creates or links a remote repository.",
      repair: projectGitInitRepair(targetRoot)
    });
  }

  const {
    bare,
    branch,
    inside
  } = await readProjectGitRepositoryShape(targetRoot);
  if (!inside.ok || inside.stdout !== "true") {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Target root is inside a Git work tree.",
      observed: inside.output,
      explanation: "The .git directory exists, but Git does not recognize the target as a normal work tree."
    });
  }

  if (bare.stdout === "true") {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository is a non-bare work tree.",
      observed: "Bare repository.",
      explanation: "Studio only operates inside normal working trees."
    });
  }

  if (!branch.stdout) {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository has a named branch.",
      observed: "Detached or unborn branch with no branch name.",
      explanation: "Create or switch to a named branch before Studio continues."
    });
  }

  context.branch = branch.stdout;
  return passCheck({
    id: "git-ready",
    label: "Git ready",
    expected: "A non-bare Git repository exists with a named branch.",
    observed: `Branch: ${branch.stdout}`,
    explanation: "Git has the minimum local shape Studio needs."
  });
}

async function checkVibe64Gitignore(targetRoot) {
  if (!VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.length) {
    return passCheck({
      id: "vibe64-gitignore",
      label: "Vibe64 ignore rules",
      expected: "No source-local Vibe64 runtime ignore rules are required.",
      observed: "Vibe64 runtime state is stored outside the source tree.",
      explanation: "The project source tree only contains source-owned Vibe64 config, so setup does not need repository-local ignore rules."
    });
  }

  let gitignoreText = "";
  try {
    gitignoreText = await readFile(path.join(targetRoot, ".gitignore"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return hardStopCheck({
        id: "vibe64-gitignore",
        label: "Vibe64 ignore rules",
        expected: "Target .gitignore can be read before checkpointing.",
        observed: String(error?.message || error),
        explanation: "Studio cannot prove local runtime state is excluded from Git until .gitignore is readable."
      });
    }
  }

  const missingPatterns = missingVibe64GitignorePatterns(gitignoreText);
  if (missingPatterns.length) {
    return blockedCheck({
      id: "vibe64-gitignore",
      label: "Vibe64 ignore rules",
      expected: "Target .gitignore excludes Vibe64 session and runtime state.",
      observed: `Missing .gitignore entries:\n${formatList(missingPatterns)}`,
      explanation: "Add these ignore rules before checkpointing so Studio-owned volatile state is not committed.",
      repair: addVibe64GitignoreRulesRepair()
    });
  }

  return passCheck({
    id: "vibe64-gitignore",
    label: "Vibe64 ignore rules",
    expected: "Target .gitignore excludes Vibe64 session and runtime state.",
    observed: "Required Vibe64 local-state entries are present in .gitignore.",
    explanation: "Studio session and runtime files are protected from broad Git add operations."
  });
}

async function checkRemoteReady(targetRoot, context) {
  const result = await readProjectGitOriginRemote(targetRoot);
  if (!result.ok || !result.stdout) {
    return blockedCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin points at an accessible GitHub repository.",
      observed: result.output || "origin is missing.",
      explanation: "Create or link a GitHub repository before target-specific setup begins.",
      repairs: [
        ghRepoCreateRepair(targetRoot, {
          ...githubToolHomeOptions(context)
        }),
        linkGithubRemoteRepair()
      ]
    });
  }

  if (!isGithubRemoteUrl(result.stdout)) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin is a GitHub remote.",
      observed: result.stdout,
      explanation: "Studio relies on gh for issues and PRs, so the primary remote must be GitHub."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(result.stdout);
  const githubProvider = await requireGithubProvider(context);
  if (!githubProvider.ok) {
    return githubProviderBlockedCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "The active Vibe64 user's GitHub identity can inspect origin.",
      observed: githubProvider.error
    });
  }
  const repoResult = await readGithubRepository(targetRoot, result.stdout, {
    ...githubToolHomeOptions(githubProvider)
  });

  if (!repoResult.ok) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "GitHub remote is accessible through gh.",
      observed: repoResult.output,
      explanation: "Studio cannot continue unless gh can inspect the target repository."
    });
  }

  context.originUrl = result.stdout;
  context.remoteDefaultBranch = repoResult.repoInfo?.defaultBranchRef?.name || "";
  return passCheck({
    id: "remote-ready",
    label: "Remote ready",
    expected: "origin points at an accessible GitHub repository.",
    observed: [
      repoResult.repoInfo?.nameWithOwner || repoSlug,
      repoResult.repoInfo?.url || result.stdout,
      context.remoteDefaultBranch ? `default: ${context.remoteDefaultBranch}` : "remote has no default branch yet"
    ].join("\n"),
    explanation: "gh can inspect the repository Studio will use for issues and PRs."
  });
}

async function checkRemoteSync(targetRoot, context, {
  readRemoteBranchSha = readProjectRemoteDefaultBranchSha
} = {}) {
  const localHead = await readProjectGitLocalHead(targetRoot);
  const hasLocalHead = localHead.ok && Boolean(localHead.stdout);
  const remoteBranch = context.remoteDefaultBranch;

  if (!remoteBranch) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: hasLocalHead
        ? `Local HEAD: ${localHead.stdout}\nRemote has no default branch.`
        : "No local commits and remote has no default branch.",
      explanation: hasLocalHead
        ? "The remote is empty, so there is no remote history to reconcile."
        : "This is a fresh repository pair."
    });
  }

  const remoteHead = await readRemoteBranchSha(targetRoot, remoteBranch, context);
  const remoteSha = remoteHead.sha;

  if (!remoteHead.ok) {
    if (remoteHead.code === "vibe64_github_user_required") {
      return githubProviderBlockedCheck({
        id: "remote-sync",
        label: "Remote/local sync",
        expected: "The active Vibe64 user's GitHub identity can inspect the remote default branch.",
        observed: remoteHead.error
      });
    }
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote default branch SHA can be read.",
      observed: remoteHead.output,
      explanation: "Studio cannot prove local and remote histories agree."
    });
  }

  if (!remoteSha) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: hasLocalHead
        ? `Local HEAD: ${localHead.stdout}\nRemote default branch ${remoteBranch} has no commit ref.`
        : `Remote default branch is named ${remoteBranch}, but refs/heads/${remoteBranch} has no commits; local has no commits.`,
      explanation: hasLocalHead
        ? "The remote default branch has no commit ref yet. The later Git checkpoint stage will publish the local HEAD."
        : "This is a fresh repository pair. GitHub may report a default branch name before the remote branch has any commits."
    });
  }

  if (!hasLocalHead) {
    const unsafeLocalEntries = nonBootstrapRemoteMirrorEntries(context);
    if (!unsafeLocalEntries.length) {
      return blockedCheck({
        id: "remote-sync",
        label: "Remote/local sync",
        expected: "Remote content is mirrored locally before Studio writes project files.",
        observed: `Remote default branch exists: ${remoteBranch} (${remoteSha}); local has no commits and only setup bootstrap files.`,
        explanation: "Mirror the existing remote branch into this bootstrap-only target before running adapter setup.",
        repair: mirrorRemoteBranchRepair(remoteBranch)
      });
    }

    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote content is mirrored locally before Studio writes files.",
      observed: [
        `Remote default branch exists: ${remoteBranch} (${remoteSha}); local has no commits.`,
        `Local files prevent automatic mirroring:\n${formatList(unsafeLocalEntries)}`
      ].join("\n"),
      explanation: "Clone the existing repository into this target directory. Studio will not overlay remote files into an empty local repo."
    });
  }

  if (remoteSha !== localHead.stdout && await projectRemoteHeadIsAncestorOfLocalHead(targetRoot, remoteSha)) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local HEAD contains origin default branch HEAD.",
      observed: `Local HEAD: ${localHead.stdout}\norigin/${remoteBranch}: ${remoteSha}`,
      explanation: "Local history includes the remote default branch and is ahead. The later Git checkpoint stage will require publishing the local HEAD."
    });
  }

  if (remoteSha !== localHead.stdout) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local HEAD equals or contains origin default branch HEAD.",
      observed: `Local HEAD: ${localHead.stdout}\norigin/${remoteBranch}: ${remoteSha}`,
      explanation: "Studio hard-stops on divergent histories. Pull, clone, or reconcile manually before continuing."
    });
  }

  return passCheck({
    id: "remote-sync",
    label: "Remote/local sync",
    expected: "Local HEAD equals origin default branch HEAD.",
    observed: `HEAD ${localHead.stdout} matches origin/${remoteBranch}.`,
    explanation: "Local and remote histories are aligned."
  });
}

async function checkGitCheckpoint(targetRoot, context) {
  if (!projectSetupUsesGithub(context)) {
    return checkLocalGitCheckpoint(targetRoot, context);
  }
  return checkGithubGitCheckpoint(targetRoot, context);
}

async function checkLocalGitCheckpoint(targetRoot) {
  const status = await readProjectGitStatus(targetRoot);

  if (!status.ok) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Git working tree status can be read.",
      observed: status.output,
      explanation: "Studio cannot create a setup checkpoint until Git status is readable."
    });
  }

  const localHead = await readProjectGitLocalHead(targetRoot);
  if (!localHead.ok || !localHead.stdout) {
    const observed = [
      localHead.output || "No local commits exist.",
      status.stdout ? `Working tree:\n${status.stdout.split(/\r?\n/u).slice(0, 40).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A local setup checkpoint commit exists.",
      observed,
      explanation: "Create the first local setup checkpoint commit before Studio continues.",
      repair: localGitCheckpointRepair()
    });
  }

  return passCheck({
    id: "git-checkpoint",
    label: "Git checkpoint",
    expected: "A local checkpoint commit exists.",
    observed: [
      `HEAD ${localHead.stdout}`,
      status.stdout ? `Uncommitted work is present:\n${status.stdout.split(/\r?\n/u).slice(0, 40).join("\n")}` : "Working tree is clean."
    ].join("\n"),
    explanation: "The target has a local baseline commit. Uncommitted work can remain for normal development and later Studio sessions."
  });
}

async function checkGithubGitCheckpoint(targetRoot, context) {
  const status = await readProjectGitStatus(targetRoot);

  if (!status.ok) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Git working tree status can be read.",
      observed: status.output,
      explanation: "Studio cannot create a setup checkpoint until Git status is readable."
    });
  }

  const localHead = await readProjectGitLocalHead(targetRoot);
  if (!localHead.ok || !localHead.stdout) {
    const observed = [
      localHead.output || "No local commits exist.",
      status.stdout ? `Working tree:\n${status.stdout.split(/\r?\n/u).slice(0, 40).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A setup checkpoint commit exists and is pushed to origin.",
      observed,
      explanation: "Create the first setup checkpoint commit and push it before Studio continues.",
      repair: gitCheckpointRepair()
    });
  }

  const branchResult = context?.branch
    ? { ok: true, stdout: context.branch }
    : await readProjectGitRepositoryShape(targetRoot).then((shape) => shape.branch);
  const branch = String(branchResult.stdout || "").trim();
  if (!branchResult.ok || !branch) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A named branch is available for pushing the setup checkpoint.",
      observed: branchResult.output || "No current branch.",
      explanation: "Studio cannot push a baseline from a detached or unnamed branch."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(context?.originUrl || "");
  if (!repoSlug) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "origin is a GitHub remote that can be checked through gh.",
      observed: context?.originUrl || "origin URL is unavailable.",
      explanation: "Studio cannot prove the setup checkpoint was published without the GitHub repository identity."
    });
  }

  const githubProvider = await requireGithubProvider(context);
  if (!githubProvider.ok) {
    return githubProviderBlockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "The active Vibe64 user's GitHub identity can verify the published checkpoint.",
      observed: githubProvider.error
    });
  }
  const remoteHead = await readRemoteBranchShaWithGh(targetRoot, repoSlug, branch, {
    ...githubToolHomeOptions(githubProvider)
  });
  const remoteSha = remoteHead.sha;
  if (!remoteHead.ok || !remoteSha) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD is present on origin/${branch}.`,
      observed: remoteHead.output || `origin/${branch} is missing.`,
      explanation: "The setup checkpoint exists locally but has not been published to the GitHub remote yet.",
      repair: gitCheckpointRepair({
        includeInitialCommit: false
      })
    });
  }

  if (remoteSha !== localHead.stdout) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD matches origin/${branch}.`,
      observed: `Local HEAD: ${localHead.stdout}\norigin/${branch}: ${remoteSha}`,
      explanation: "Push the setup checkpoint to origin. If Git rejects the push, reconcile the remote branch manually before continuing.",
      repair: gitCheckpointRepair({
        includeInitialCommit: false
      })
    });
  }

  return passCheck({
    id: "git-checkpoint",
    label: "Git checkpoint",
    expected: "A checkpoint commit exists and is pushed to origin.",
    observed: [
      `HEAD ${localHead.stdout} matches origin/${branch}.`,
      status.stdout ? `Uncommitted work is present:\n${status.stdout.split(/\r?\n/u).slice(0, 40).join("\n")}` : "Working tree is clean."
    ].join("\n"),
    explanation: "The target has a published baseline commit. Uncommitted work can remain for normal development and later Studio sessions."
  });
}

async function checkGitIdentity(targetRoot, context) {
  let gitOptions = {};
  if (projectSetupUsesGithub(context)) {
    const githubProvider = await requireGithubProvider(context);
    if (!githubProvider.ok) {
      return githubProviderBlockedCheck({
        id: "git-identity",
        label: "Git identity",
        expected: "Git user.name and user.email are configured for local setup work.",
        observed: githubProvider.error
      });
    }
    gitOptions = githubToolHomeOptions(githubProvider);
  }

  const {
    emailResult,
    nameResult
  } = await readGitIdentity(targetRoot, gitOptions);
  if (!nameResult.ok || !nameResult.stdout || !emailResult.ok || !emailResult.stdout) {
    return blockedCheck({
      id: "git-identity",
      label: "Git identity",
      expected: "Git user.name and user.email are configured for local setup work.",
      observed: [nameResult.output, emailResult.output].filter(Boolean).join("\n") || "Git identity is incomplete.",
      explanation: "Configure Git identity for this local editor before continuing.",
      repair: gitIdentityRepair()
    });
  }

  return passCheck({
    id: "git-identity",
    label: "Git identity",
    expected: "Git user.name and user.email are configured for local setup work.",
    observed: `${nameResult.stdout} <${emailResult.stdout}>`,
    explanation: "Setup commits will use the configured Git identity."
  });
}

function readyStage() {
  return passCheck({
    id: "ready",
    label: "Ready",
    expected: "The target project is ready for Studio workflows.",
    observed: "All setup stages passed.",
    explanation: "Studio can now inspect and operate on this app."
  });
}

function genericSetupChecks(targetRoot, context) {
  const githubSetup = projectSetupUsesGithub(context);
  const checks = [
    {
      expected: "Target directory is empty or already a Git repository.",
      id: "directory",
      label: "Directory admissibility",
      run: () => checkDirectory(targetRoot, context)
    },
    {
      expected: "Git repository exists, is non-bare, and has a named branch.",
      id: "git-ready",
      label: "Git ready",
      run: () => checkGitReady(targetRoot, context)
    },
    ...(VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.length ? [{
      expected: "Target .gitignore excludes Vibe64 session and runtime state.",
      id: "vibe64-gitignore",
      label: "Vibe64 ignore rules",
      run: () => checkVibe64Gitignore(targetRoot)
    }] : []),
    ...(githubSetup ? [{
      expected: "origin points at an accessible GitHub repository.",
      id: "remote-ready",
      label: "Remote ready",
      run: () => checkRemoteReady(targetRoot, context)
    },
    {
      expected: "Local HEAD and the remote default branch are not divergent.",
      id: "remote-sync",
      label: "Remote/local sync",
      run: () => checkRemoteSync(targetRoot, context)
    }] : [])
  ];
  return checks;
}

function finalSetupChecks(targetRoot, context) {
  const githubSetup = projectSetupUsesGithub(context);
  return [
    {
      expected: "Git user.name and user.email are configured for the active Vibe64 user.",
      id: "git-identity",
      label: "Git identity",
      run: () => checkGitIdentity(targetRoot, context)
    },
    {
      expected: githubSetup
        ? "A checkpoint commit exists and is pushed to origin."
        : "A local checkpoint commit exists.",
      id: "git-checkpoint",
      label: "Git checkpoint",
      run: () => checkGitCheckpoint(targetRoot, context)
    },
    {
      expected: "The target project is ready for Studio workflows.",
      id: "ready",
      label: "Ready",
      run: readyStage
    }
  ];
}

async function setupCheckChain({
  context,
  setupPlugins = [],
  targetRoot
}) {
  const checks = [
    ...genericSetupChecks(targetRoot, context),
    ...await listDoctorPluginChecks({
      context,
      plugins: setupPlugins
    }),
    ...finalSetupChecks(targetRoot, context)
  ];
  assertUniqueCheckIds(checks);
  return checks;
}

async function runCoreSetupChecksOnce({
  config = {},
  configEnvironment = {},
  emit = null,
  githubProvider = null,
  repositoryMode = "",
  repositorySetupProfile = "",
  setupPlugins = [],
  studioRoot = "",
  targetRoot,
  workflowRepositoryProfile = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const resolvedRepositorySetupProfile = projectSetupRepositoryProfileForInput({
    repositoryMode,
    repositorySetupProfile,
    workflowRepositoryProfile
  }) || PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL;
  const context = {
    config,
    configEnvironment,
    githubProvider,
    projectSetupCacheConfigKey: projectSetupCacheConfigKey(config),
    repositorySetupProfile: resolvedRepositorySetupProfile,
    studioRoot,
    targetRoot: resolvedTargetRoot
  };
  const checks = await setupCheckChain({
    context,
    setupPlugins,
    targetRoot: resolvedTargetRoot
  });
  const stages = [];

  for (let index = 0; index < checks.length; index += 1) {
    const result = await runDoctorCheck({
      check: checks[index],
      context,
      emit
    });
    stages.push(result);
    if (!checkPassed(result)) {
      return finalizeStatus({
        context,
        stages: appendPendingChecks(stages, checks, index + 1),
        targetRoot: resolvedTargetRoot
      });
    }
  }

  return finalizeStatus({
    context,
    stages,
    targetRoot: resolvedTargetRoot
  });
}

async function waitForProjectSetupTerminalExit(sessionId, {
  timeoutMs = AUTOMATIC_REPAIR_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const session = readTerminalSession(sessionId, {
      namespace: TERMINAL_NAMESPACE
    });
    if (session?.ok === false || session?.status === "exited") {
      return session;
    }
    if (Date.now() >= deadline) {
      return {
        ...session,
        error: `Automatic repair timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        ok: false
      };
    }
    await delay(AUTOMATIC_REPAIR_POLL_MS);
  }
}

async function startProjectSetupTerminalAction({
  actionId,
  inputs = {},
  setupRuntime = {},
  studioRoot = "",
  targetRoot
} = {}) {
  const repositorySetupProfile = normalizeProjectSetupRepositoryProfile(setupRuntime.repositorySetupProfile) ||
    PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL;
  const githubSetup = projectSetupUsesGithub(repositorySetupProfile);
  const githubProvider = githubSetup
    ? await ensureGithubCredentialHome(setupRuntime.githubProvider || null)
    : null;
  const githubHomes = githubToolHomeOptions(githubProvider || null);
  const githubTerminalError = () => ({
    error: githubProvider?.error || "Authenticate GitHub for this local Vibe64 editor before starting this project setup terminal.",
    ok: false
  });
  if (actionId === "terminal-git-init") {
    return startGitInitTerminal(targetRoot, setupRuntime.configEnvironment);
  }
  if (actionId === "terminal-gh-create-repo") {
    if (!githubSetup) {
      return {
        error: "GitHub repository creation is not available for local-source project setup.",
        ok: false
      };
    }
    if (!githubProvider?.ok) {
      return githubTerminalError();
    }
    return startGhCreateRepoTerminal(
      targetRoot,
      setupRuntime.configEnvironment,
      githubHomes.toolHomeSource,
      githubHomes.githubToolHomeSource
    );
  }
  if (actionId === "terminal-link-github-remote") {
    if (!githubSetup) {
      return {
        error: "GitHub remote linking is not available for local-source project setup.",
        ok: false
      };
    }
    return startLinkRemoteTerminal(targetRoot, inputs, setupRuntime.configEnvironment);
  }
  if (actionId === GIT_IDENTITY_ACTION_ID) {
    if (githubSetup && !githubProvider?.ok) {
      return githubTerminalError();
    }
    return startGitIdentityTerminal(
      targetRoot,
      inputs,
      setupRuntime.configEnvironment,
      githubHomes.toolHomeSource,
      githubHomes.githubToolHomeSource
    );
  }
  if (actionId === ADD_VIBE64_GITIGNORE_RULES_ACTION_ID) {
    if (!VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.length) {
      return {
        error: "No source-local Vibe64 ignore rules are required for this project.",
        ok: false
      };
    }
    return startVibe64GitignoreTerminal(targetRoot, setupRuntime.configEnvironment);
  }
  if (actionId === MIRROR_REMOTE_BRANCH_ACTION_ID) {
    if (!githubSetup) {
      return {
        error: "Remote branch mirroring is not available for local-source project setup.",
        ok: false
      };
    }
    if (!githubProvider?.ok) {
      return githubTerminalError();
    }
    return startMirrorRemoteBranchTerminal(
      targetRoot,
      inputs,
      setupRuntime.configEnvironment,
      githubHomes.toolHomeSource,
      githubHomes.githubToolHomeSource
    );
  }
  if (actionId === CREATE_GIT_CHECKPOINT_ACTION_ID) {
    if (!githubSetup) {
      return startLocalGitCheckpointTerminal(targetRoot, inputs, setupRuntime.configEnvironment, {
        allowCreate: true
      });
    }
    if (!githubProvider?.ok) {
      return githubTerminalError();
    }
    return startGitCheckpointTerminal(targetRoot, inputs, setupRuntime.configEnvironment, githubHomes.toolHomeSource, {
      allowCreate: true
    }, githubHomes.githubToolHomeSource);
  }
  if (actionId === PUSH_GIT_CHECKPOINT_ACTION_ID) {
    if (!githubSetup) {
      return {
        error: "Pushing a setup checkpoint is not available for local-source project setup.",
        ok: false
      };
    }
    if (!githubProvider?.ok) {
      return githubTerminalError();
    }
    return startGitCheckpointTerminal(targetRoot, inputs, setupRuntime.configEnvironment, githubHomes.toolHomeSource, {
      allowCreate: false
    }, githubHomes.githubToolHomeSource);
  }

  const pluginTerminal = await startDoctorPluginTerminal({
    actionId,
    context: {
      config: setupRuntime.config || {},
      configEnvironment: setupRuntime.configEnvironment || {},
      studioRoot,
      targetRoot
    },
    input: inputs,
    plugins: setupRuntime.setupPlugins || []
  });
  if (pluginTerminal) {
    return pluginTerminal;
  }
  return {
    error: "Unknown terminal action.",
    ok: false
  };
}

async function runAutomaticProjectSetupRepair(candidate, {
  config = {},
  configEnvironment = {},
  emit = null,
  githubProvider = null,
  setupPlugins = [],
  startAutomaticRepair = null,
  studioRoot = "",
  targetRoot
} = {}) {
  const payload = {
    check: candidate.stage,
    inputs: candidate.inputs,
    repair: candidate.repair,
    targetRoot
  };
  emit?.("repair.started", {
    actionId: candidate.repair.actionId,
    checkId: candidate.stage.id,
    checkLabel: candidate.stage.label || candidate.stage.id,
    label: candidate.repair.label || candidate.repair.actionId
  });

  const result = typeof startAutomaticRepair === "function"
    ? await startAutomaticRepair(payload)
    : await (async () => {
        const terminal = await startProjectSetupTerminalAction({
          actionId: candidate.repair.actionId,
          inputs: candidate.inputs,
          setupRuntime: {
            config,
            configEnvironment,
            githubProvider,
            setupPlugins
          },
          studioRoot,
          targetRoot
        });
        if (terminal?.ok === false || !terminal?.id) {
          return terminal;
        }
        return waitForProjectSetupTerminalExit(terminal.id);
      })();

  emit?.("repair.finished", {
    actionId: candidate.repair.actionId,
    checkId: candidate.stage.id,
    checkLabel: candidate.stage.label || candidate.stage.id,
    exitCode: result?.exitCode,
    label: candidate.repair.label || candidate.repair.actionId,
    ok: !repairResultFailure(result),
    status: result?.status || ""
  });
  return result;
}

async function runCoreSetupChecks(options = {}) {
  const attemptedAutomaticRepairKeys = new Set();
  let latestStatus = null;
  let repairsAttempted = 0;

  while (true) {
    latestStatus = await runCoreSetupChecksOnce(options);
    if (options.autoRepair !== true || latestStatus.ready) {
      return latestStatus;
    }

    const candidate = findAutomaticRepairCandidate(latestStatus, attemptedAutomaticRepairKeys);
    if (!candidate) {
      const attemptedCandidate = findAttemptedAutomaticRepairCandidate(latestStatus, attemptedAutomaticRepairKeys);
      return attemptedCandidate
        ? automaticRepairStillBlockedStatus(latestStatus, attemptedCandidate)
        : latestStatus;
    }

    if (repairsAttempted >= AUTOMATIC_REPAIR_MAX_ATTEMPTS) {
      return annotateAutomaticRepairStatus(
        latestStatus,
        candidate,
        `Automatic repair stopped after ${AUTOMATIC_REPAIR_MAX_ATTEMPTS} attempts.`
      );
    }

    attemptedAutomaticRepairKeys.add(candidate.key);
    repairsAttempted += 1;
    const repairResult = await runAutomaticProjectSetupRepair(candidate, {
      ...options,
      targetRoot: latestStatus.targetRoot
    });
    if (repairResultFailure(repairResult)) {
      return automaticRepairFailureStatus(latestStatus, candidate, repairResult);
    }
  }
}

async function inspectProjectSetup(options = {}) {
  return runCoreSetupChecks(options);
}

function startGitInitTerminal(targetRoot, env = {}) {
  return startSharedGitInitTerminal({
    env,
    extraArgs: hostWritableWorkspaceDockerArgs(),
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startGhCreateRepoTerminal(targetRoot, env = {}, toolHomeSource = "", githubToolHomeSource = "") {
  return startSharedGhCreateRepoTerminal({
    env,
    githubToolHomeSource,
    namespace: TERMINAL_NAMESPACE,
    targetRoot,
    toolHomeSource
  });
}

function startLinkRemoteTerminal(targetRoot, input = {}, env = {}) {
  return startSharedLinkGithubRemoteTerminal({
    env,
    input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startVibe64GitignoreTerminal(targetRoot, env = {}) {
  return startSharedAddVibe64GitignoreRulesTerminal({
    env,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startGitIdentityTerminal(targetRoot, input = {}, env = {}, toolHomeSource = "", githubToolHomeSource = "") {
  return startSharedGitIdentityTerminal({
    env,
    githubToolHomeSource,
    inputs: input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot,
    toolHomeSource
  });
}

function startMirrorRemoteBranchTerminal(targetRoot, input = {}, env = {}, toolHomeSource = "", githubToolHomeSource = "") {
  return startSharedMirrorRemoteBranchTerminal({
    env,
    githubToolHomeSource,
    input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot,
    toolHomeSource
  });
}

function startGitCheckpointTerminal(targetRoot, input = {}, env = {}, toolHomeSource = "", {
  allowCreate = true
} = {}, githubToolHomeSource = "") {
  return startSharedGitCheckpointTerminal({
    allowCreate,
    env,
    githubToolHomeSource,
    input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot,
    toolHomeSource
  });
}

function startLocalGitCheckpointTerminal(targetRoot, input = {}, env = {}, {
  allowCreate = true
} = {}) {
  return startSharedLocalGitCheckpointTerminal({
    allowCreate,
    env,
    input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function createService({
  env = process.env,
  githubAccountMode = GITHUB_ACCOUNT_MODE_LOCAL,
  logger = null,
  projectService = null,
  studioRoot = "",
  systemRoot = "",
  targetRoot
} = {}) {
  const resolvedStudioRoot = path.resolve(String(studioRoot || process.cwd()));
  const doctorStatusStateRoot = String(env.VIBE64_DOCTOR_STATUS_ROOT || "").trim();
  void systemRoot;
  const resolvedGithubAccountMode = normalizeGithubAccountMode(githubAccountMode, GITHUB_ACCOUNT_MODE_LOCAL);

  function currentTargetRoot() {
    const selectedTargetRoot = String(targetRoot || projectServiceTargetRoot(projectService)).trim();
    return selectedTargetRoot ? path.resolve(selectedTargetRoot) : "";
  }

  function noProjectSelectedStatus() {
    return {
      blockedReason: "Choose a project before running Project Setup.",
      currentStageId: "project-selection",
      hardStop: false,
      ok: true,
      ready: false,
      stages: [],
      targetRoot: "",
      updatedAt: new Date().toISOString()
    };
  }

  function readyStatusCache(targetRootValue, {
    githubProvider = null,
    repositorySetupProfile = PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL
  } = {}) {
    return createRepositoryReadyStatusCache({
      doctorId: "project-setup",
      scope: projectSetupCacheScope({
        githubProvider,
        repositorySetupProfile
      }),
      stateRoot: doctorStatusStateRoot,
      studioRoot: resolvedStudioRoot,
      targetRoot: targetRootValue
    });
  }

  function githubContextForInput(input = {}) {
    return composeGithubTerminalHome(githubCredentialContext(input, {
      accountMode: resolvedGithubAccountMode
    }));
  }

  function currentProjectSourceRoot() {
    return typeof projectService?.currentProjectSourceRoot === "function"
      ? String(projectService.currentProjectSourceRoot() || "").trim()
      : "";
  }

  function projectWiringSetupEnabled() {
    return Boolean(
      projectService &&
      typeof projectService.listProjects === "function" &&
      currentTargetRoot() &&
      !currentProjectSourceRoot()
    );
  }

  async function selectedProjectRecord() {
    if (typeof projectService?.listProjects === "function") {
      const listed = await projectService.listProjects();
      if (listed?.ok === false) {
        const error = new Error(listed.error || listed.errors?.[0]?.message || "Project selection could not be read.");
        error.code = listed.code || listed.errors?.[0]?.code || "vibe64_project_selection_unavailable";
        throw error;
      }
      const listedProject = listed?.currentProject || (Array.isArray(listed?.projects)
        ? listed.projects.find((project) => project?.selected) || null
        : null);
      if (listedProject) {
        return listedProject;
      }
    }
    return projectService?.selectedProject || null;
  }

  async function currentRepositorySetupProfile(input = {}) {
    const explicitProfile = projectSetupRepositoryProfileForInput(input);
    if (explicitProfile) {
      return explicitProfile;
    }
    try {
      const project = await selectedProjectRecord();
      if (project) {
        return projectSetupRepositoryProfileForProject(project);
      }
    } catch {
      return PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL;
    }
    return PROJECT_SETUP_REPOSITORY_PROFILE_LOCAL;
  }

  function projectRuntimeRootForSetup(project = {}) {
    const projectRuntimeRoot = String(project?.projectRuntimeRoot || project?.projectLocalRoot || "").trim();
    if (projectRuntimeRoot) {
      return path.resolve(projectRuntimeRoot);
    }
    return typeof projectService?.currentProjectRuntimeRoot === "function"
      ? path.resolve(String(projectService.currentProjectRuntimeRoot() || currentTargetRoot()))
      : currentTargetRoot();
  }

  function projectGitCacheRepository(project = {}) {
    return path.join(projectRuntimeRootForSetup(project), "git-cache", "repository.git");
  }

  async function projectWiringChecks({
    context: setupContext = null,
    githubProvider = null
  } = {}) {
    const context = setupContext || {
      githubProvider,
      project: null,
      projectRuntimeRoot: "",
      targetRoot: currentTargetRoot()
    };
    return [
      {
        expected: "A Vibe64 project record is selected.",
        id: "project-record",
        label: "Project record",
        async run() {
          const project = await selectedProjectRecord();
          context.project = project;
          context.projectRuntimeRoot = projectRuntimeRootForSetup(project || {});
          if (!project) {
            return blockedCheck({
              id: "project-record",
              label: "Project record",
              expected: "A Vibe64 project record is selected.",
              observed: "No selected project record was found.",
              explanation: "Select or create a Vibe64 project before running Project Setup."
            });
          }
          return passCheck({
            id: "project-record",
            label: "Project record",
            expected: "A Vibe64 project record is selected.",
            observed: [
              project.slug ? `Project: ${project.slug}` : "",
              project.projectRoot || project.path || context.targetRoot
                ? `Project root: ${project.projectRoot || project.path || context.targetRoot}`
                : "",
              context.projectRuntimeRoot ? `Runtime root: ${context.projectRuntimeRoot}` : ""
            ].filter(Boolean).join("\n"),
            explanation: "Studio can resolve the catalog project without selecting a source tree."
          });
        }
      },
      {
        expected: "The project record names its canonical repository.",
        id: "project-repository",
        label: "Project repository",
        run() {
          const repositorySetupProfile = projectSetupRepositoryProfileForProject(context.project || {});
          context.repositorySetupProfile = repositorySetupProfile;
          context.projectDefaultBranch = projectRepositoryDefaultBranch(context.project || {});
          if (projectSetupUsesGithub(repositorySetupProfile)) {
            const repository = context.project?.githubRepository || context.project?.repository?.github || null;
            if (!repository?.fullName) {
              return blockedCheck({
                id: "project-repository",
                label: "Project repository",
                expected: "The project record names its GitHub repository.",
                observed: "Project GitHub repository metadata is missing.",
                explanation: "Link the project to a GitHub repository before Studio uses project-level Git state."
              });
            }
            return passCheck({
              id: "project-repository",
              label: "Project repository",
              expected: "The project record names its GitHub repository.",
              observed: [
                repository.fullName,
                repository.url || repository.cloneUrl || "",
                repository.defaultBranch ? `default: ${repository.defaultBranch}` : ""
              ].filter(Boolean).join("\n"),
              explanation: "Project Setup uses repository metadata from the project record, not a user-selected session."
            });
          }
          const repositoryMode = normalizeRepositoryMode(context.project?.repositoryMode || context.project?.repository?.mode);
          if (!repositoryMode) {
            return blockedCheck({
              id: "project-repository",
              label: "Project repository",
              expected: "The project record names its canonical repository.",
              observed: "Project repository mode metadata is missing.",
              explanation: "Repair the project record before Studio uses project-level Git state."
            });
          }
          return passCheck({
            id: "project-repository",
            label: "Project repository",
            expected: "The project record names its canonical repository.",
            observed: [
              `mode: ${repositoryMode}`,
              context.projectDefaultBranch ? `default: ${context.projectDefaultBranch}` : ""
            ].filter(Boolean).join("\n"),
            explanation: "Project Setup uses the catalog repository mode and project Git cache without requiring GitHub metadata."
          });
        }
      },
      {
        expected: "The project Git cache exists and can read committed refs.",
        id: "git-cache",
        label: "Git cache",
        async run() {
          const defaultBranch = context.projectDefaultBranch || projectRepositoryDefaultBranch(context.project || {});
          const gitDir = projectGitCacheRepository(context.project || {});
          if (!await pathIsReadable(gitDir)) {
            return blockedCheck({
              id: "git-cache",
              label: "Git cache",
              expected: "The project Git cache exists and can read committed refs.",
              observed: `Missing Git cache: ${gitDir}`,
              explanation: "Refresh or create the project Git cache before project-level setup is ready."
            });
          }
          let bare = "";
          try {
            bare = await runGitCache(gitDir, ["rev-parse", "--is-bare-repository"]);
          } catch (error) {
            return hardStopCheck({
              id: "git-cache",
              label: "Git cache",
              expected: "The project Git cache is a readable bare Git repository.",
              observed: String(error?.stderr || error?.message || error),
              explanation: "Studio cannot inspect committed project state until the Git cache is readable."
            });
          }
          if (bare !== "true") {
            return hardStopCheck({
              id: "git-cache",
              label: "Git cache",
              expected: "The project Git cache is a bare Git repository.",
              observed: `rev-parse --is-bare-repository returned: ${bare || "(empty)"}`,
              explanation: "The project Git cache path exists but is not the expected bare repository."
            });
          }
          const ref = defaultBranch ? `refs/heads/${defaultBranch}` : "HEAD";
          let commit = "";
          try {
            commit = await runGitCache(gitDir, ["rev-parse", "--verify", `${ref}^{commit}`]);
          } catch (error) {
            if (projectUsesBootstrapRepository(context.project) && await gitCacheRefIsMissing(gitDir, ref)) {
              const seedSession = await readSeedSessionBootstrapState(context.projectRuntimeRoot);
              context.committedBaselineDeferred = true;
              context.committedBaselineRef = ref;
              context.readiness = seedBootstrapReadiness(seedSession);
              return passCheck({
                id: "git-cache",
                label: "Git cache",
                expected: "The project Git cache is a readable bare Git repository.",
                observed: `${ref} has no committed baseline yet.`,
                explanation: "The Git cache is readable; the seed workflow will create the first committed project ref."
              });
            }
            return blockedCheck({
              id: "git-cache",
              label: "Git cache",
              expected: "The project Git cache can resolve the committed project ref.",
              observed: String(error?.stderr || error?.message || error),
              explanation: "Fetch or repair the project Git cache before project-level setup is ready."
            });
          }
          return passCheck({
            id: "git-cache",
            label: "Git cache",
            expected: "The project Git cache exists and can read committed refs.",
            observed: `${ref}: ${commit}`,
            explanation: "Committed project state can be read without checking out a source tree."
          });
        }
      },
      {
        expected: "Managed project metadata is readable.",
        id: "project-metadata",
        label: "Project metadata",
        async run() {
          const project = context.project || {};
          const paths = [
            ["Project root", project.projectRoot || project.path || context.targetRoot],
            ["Runtime root", context.projectRuntimeRoot],
            ["Project record", project.projectRecordPath || ""]
          ].filter(([, filePath]) => filePath);
          const missing = [];
          for (const [label, filePath] of paths) {
            if (!await pathIsReadable(filePath)) {
              missing.push(`${label}: ${filePath}`);
            }
          }
          if (missing.length) {
            return blockedCheck({
              id: "project-metadata",
              label: "Project metadata",
              expected: "Managed project metadata is readable.",
              observed: formatList(missing),
              explanation: "Repair the project record/runtime metadata before project-level setup is ready."
            });
          }
          return passCheck({
            id: "project-metadata",
            label: "Project metadata",
            expected: "Managed project metadata is readable.",
            observed: formatList(paths.map(([label, filePath]) => `${label}: ${filePath}`)),
            explanation: "The managed project home has the metadata Studio needs."
          });
        }
      },
      {
        expected: "Committed Vibe64 project config is readable from committed state.",
        id: "committed-config",
        label: "Committed Vibe64 config",
        async run() {
          if (context.committedBaselineDeferred) {
            return pendingCheck({
              id: "committed-config",
              label: "Committed Vibe64 config",
              expected: "Committed Vibe64 project config is readable from committed state.",
              observed: `${context.committedBaselineRef || "The committed project ref"} has no committed baseline yet.`,
              explanation: "Committed config is deferred until the seed workflow creates the first committed project baseline."
            });
          }
          if (typeof projectService?.readCommittedProjectType !== "function") {
            return blockedCheck({
              id: "committed-config",
              label: "Committed Vibe64 config",
              expected: "Committed Vibe64 project config is readable from committed state.",
              observed: "The project service does not expose committed project config reads.",
              explanation: "Project Setup cannot verify committed config without the committed-config project service API."
            });
          }
          const projectTypeResponse = await projectService.readCommittedProjectType();
          if (projectTypeResponse?.ok === false) {
            return blockedCheck({
              id: "committed-config",
              label: "Committed Vibe64 config",
              expected: "Committed Vibe64 project type can be read from committed state.",
              observed: projectTypeResponse.error || projectTypeResponse.errors?.[0]?.message || "Committed project type read failed.",
              explanation: "Fix the committed project config before project-level setup is ready."
            });
          }
          const projectType = projectTypeResponse?.projectType || {};
          if (projectType.ready !== true) {
            return blockedCheck({
              id: "committed-config",
              label: "Committed Vibe64 config",
              expected: "Committed Vibe64 project type can be read from committed state.",
              observed: projectType.message || projectType.errorCode || "Committed project type is unavailable.",
              explanation: "Finish and commit source-owned Vibe64 config before project-level setup is ready."
            });
          }
          let configStatus = "Config values were not inspected.";
          if (typeof projectService.readCommittedProjectConfig === "function") {
            const configResponse = await projectService.readCommittedProjectConfig();
            if (configResponse?.ok === false) {
              return blockedCheck({
                id: "committed-config",
                label: "Committed Vibe64 config",
                expected: "Committed Vibe64 project config can be read from committed state.",
                observed: configResponse.error || configResponse.errors?.[0]?.message || "Committed project config read failed.",
                explanation: "Fix the committed project config before project-level setup is ready."
              });
            }
            const config = configResponse?.config || {};
            configStatus = config.ready === true
              ? "Config values are complete."
              : `Config is readable; completeness is handled by runtime/deploy readiness (${config.message || config.status || "not ready"}).`;
          }
          return passCheck({
            id: "committed-config",
            label: "Committed Vibe64 config",
            expected: "Committed Vibe64 project config is readable from committed state.",
            observed: [
              projectType.projectType ? `Project type: ${projectType.projectType}` : "",
              projectType.ref ? `Ref: ${projectType.ref}` : "",
              projectType.commit ? `Commit: ${projectType.commit}` : "",
              configStatus
            ].filter(Boolean).join("\n"),
            explanation: "Project Setup reads committed/cache config without selecting an active session source."
          });
        }
      },
      {
        expected: "Project-level setup is ready.",
        id: "ready",
        label: "Ready",
        run() {
          if (context.committedBaselineDeferred) {
            return pendingCheck({
              id: "ready",
              label: "Ready",
              expected: "Project-level setup has a committed project baseline.",
              observed: "Waiting for the seed workflow to create the first committed project baseline.",
              explanation: "Project Setup will become ready after the seed baseline is committed and the Git cache can resolve it."
            });
          }
          return readyStage();
        }
      }
    ];
  }

  async function inspectProjectWiringSetup({
    emit = null,
    githubProvider = null,
    targetRoot = currentTargetRoot()
  } = {}) {
    const context = {
      githubProvider,
      project: null,
      projectRuntimeRoot: "",
      targetRoot
    };
    const checks = await projectWiringChecks({
      context,
      githubProvider
    });
    const stages = [];
    for (let index = 0; index < checks.length; index += 1) {
      const result = await runDoctorCheck({
        check: checks[index],
        context,
        emit
      });
      stages.push(result);
      if (!checkPassed(result)) {
        return finalizeStatus({
          context,
          stages: appendPendingChecks(stages, checks, index + 1),
          targetRoot
        });
      }
    }
    return finalizeStatus({
      context,
      stages,
      targetRoot
    });
  }

  async function loadAdapterSetupRuntime({
    includeSetupPlugins = true
  } = {}) {
    const resolvedTargetRoot = currentTargetRoot();
    if (!projectService || typeof projectService.createRuntime !== "function") {
      return {
        config: {},
        configEnvironment: {},
        setupPlugins: []
      };
    }
    const runtime = await projectService.createRuntime();
    if (!includeSetupPlugins || typeof runtime.adapter?.getSetupDoctorPlugins !== "function") {
      return {
        config: runtime.projectConfig || {},
        configEnvironment: {},
        setupPlugins: []
      };
    }
    const configEnvironment = typeof projectService.projectConfigEnvironment === "function"
      ? await projectService.projectConfigEnvironment()
      : {};
    const runtimeConfigEnvironment = typeof projectService.projectRuntimeConfigEnvironment === "function"
      ? (input = {}) => projectService.projectRuntimeConfigEnvironment(input)
      : null;
    const materializeRuntimeConfig = typeof projectService.materializeRuntimeConfigAction === "function"
      ? (input = {}) => projectService.materializeRuntimeConfigAction(input)
      : null;
    return {
      config: runtime.projectConfig || {},
      configEnvironment,
      setupPlugins: await runtime.adapter.getSetupDoctorPlugins({
        config: runtime.projectConfig || {},
        configEnvironment,
        materializeRuntimeConfig,
        runtimeConfigEnvironment,
        startTerminalSession,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot,
        terminalNamespace: TERMINAL_NAMESPACE
      })
    };
  }

  async function loadProjectSetupConfig() {
    if (projectService && typeof projectService.readProjectConfig === "function") {
      const response = await projectService.readProjectConfig();
      return response?.config || {};
    }
    const runtime = await loadAdapterSetupRuntime({
      includeSetupPlugins: false
    });
    return runtime.config || {};
  }

  return Object.freeze({
    async getStatus(input = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return noProjectSelectedStatus();
      }
      if (projectWiringSetupEnabled()) {
        return inspectProjectWiringSetup({
          targetRoot: resolvedTargetRoot
        });
      }
      const repositorySetupProfile = await currentRepositorySetupProfile(input);
      const githubProvider = githubContextForInput(input);
      const cache = readyStatusCache(resolvedTargetRoot, {
        githubProvider,
        repositorySetupProfile
      });
      const useCache = !refreshRequested(input);
      if (useCache) {
        const cachedStatus = await readReusableProjectSetupStatus(cache, {
          readConfig: loadProjectSetupConfig,
          targetRoot: resolvedTargetRoot
        });
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      const fullSetupRuntime = await loadAdapterSetupRuntime();
      return cache.remember(await inspectProjectSetup({
        config: fullSetupRuntime.config,
        configEnvironment: fullSetupRuntime.configEnvironment,
        githubProvider,
        repositorySetupProfile,
        setupPlugins: fullSetupRuntime.setupPlugins,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async getCachedStatus(input = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return noProjectSelectedStatus();
      }
      if (projectWiringSetupEnabled()) {
        return null;
      }
      const repositorySetupProfile = await currentRepositorySetupProfile(input);
      const githubProvider = githubContextForInput(input);
      const cache = readyStatusCache(resolvedTargetRoot, {
        githubProvider,
        repositorySetupProfile
      });
      return readReusableProjectSetupStatus(cache, {
        readConfig: loadProjectSetupConfig,
        targetRoot: resolvedTargetRoot
      });
    },

    async streamStatus({
      emit,
      refresh = false,
      vibe64User = null
    } = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return noProjectSelectedStatus();
      }
      if (projectWiringSetupEnabled()) {
        return inspectProjectWiringSetup({
          emit,
          targetRoot: resolvedTargetRoot
        });
      }
      const repositorySetupProfile = await currentRepositorySetupProfile({
        vibe64User
      });
      const githubProvider = githubContextForInput({
        vibe64User
      });
      const cache = readyStatusCache(resolvedTargetRoot, {
        githubProvider,
        repositorySetupProfile
      });
      const useCache = !refreshRequested({ refresh });
      if (useCache) {
        const cachedStatus = await readReusableProjectSetupStatus(cache, {
          readConfig: loadProjectSetupConfig,
          targetRoot: resolvedTargetRoot
        });
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      const fullSetupRuntime = await loadAdapterSetupRuntime();
      return cache.remember(await inspectProjectSetup({
        autoRepair: true,
        config: fullSetupRuntime.config,
        configEnvironment: fullSetupRuntime.configEnvironment,
        emit,
        githubProvider,
        repositorySetupProfile,
        setupPlugins: fullSetupRuntime.setupPlugins,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async startTerminal({
      actionId,
      inputs = {},
      vibe64User = null
    } = {}) {
      const resolvedTargetRoot = currentTargetRoot();
      if (!resolvedTargetRoot) {
        return {
          error: "Choose a project before running Project Setup terminal actions.",
          ok: false
        };
      }
      if (projectWiringSetupEnabled()) {
        return {
          error: "Project Setup no longer exposes worktree terminal repairs for managed project-home setup.",
          ok: false
        };
      }
      const repositorySetupProfile = await currentRepositorySetupProfile({
        vibe64User
      });
      const setupRuntime = await loadAdapterSetupRuntime();
      const coreActionIds = new Set([
        "terminal-git-init",
        GIT_IDENTITY_ACTION_ID,
        CREATE_GIT_CHECKPOINT_ACTION_ID
      ]);
      if (projectSetupUsesGithub(repositorySetupProfile)) {
        coreActionIds.add("terminal-gh-create-repo");
        coreActionIds.add("terminal-link-github-remote");
        coreActionIds.add(MIRROR_REMOTE_BRANCH_ACTION_ID);
        coreActionIds.add(PUSH_GIT_CHECKPOINT_ACTION_ID);
      }
      if (VIBE64_LOCAL_STATE_GITIGNORE_PATTERNS.length) {
        coreActionIds.add(ADD_VIBE64_GITIGNORE_RULES_ACTION_ID);
      }
      if (!coreActionIds.has(actionId) && !await pluginTerminalActionIsAvailable({
        actionId,
        setupRuntime,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      })) {
        return {
          error: "This terminal action is not available in the current project setup state.",
          ok: false
        };
      }

      const githubProvider = githubContextForInput({
        vibe64User
      });
      const terminal = await startProjectSetupTerminalAction({
        actionId,
        inputs,
        setupRuntime: {
          ...setupRuntime,
          githubProvider,
          repositorySetupProfile
        },
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      });
      return recordProjectSetupTerminalOwner(terminal, projectSetupTerminalOwnerMetadata({
        actionId,
        githubProvider
      }));
    },

    readTerminal(sessionId, input = {}) {
      return readOwnedTerminalSession(sessionId, {
        accountMode: resolvedGithubAccountMode,
        env,
        input,
        logger,
        namespace: TERMINAL_NAMESPACE
      });
    },

    writeTerminal(sessionId, data, input = {}) {
      return writeOwnedTerminalSession(sessionId, data, {
        accountMode: resolvedGithubAccountMode,
        env,
        input,
        logger,
        namespace: TERMINAL_NAMESPACE
      });
    },

    closeTerminal(sessionId, input = {}) {
      return closeOwnedTerminalSession(sessionId, {
        accountMode: resolvedGithubAccountMode,
        env,
        input,
        logger,
        namespace: TERMINAL_NAMESPACE
      });
    }
  });
}

export {
  checkRemoteSync,
  createService,
  ghRepoCreateScript,
  gitCheckpointScript,
  githubBranchRefApiPath,
  inspectProjectSetup,
  projectSetupTerminalOwnerMetadata,
  readProjectRemoteDefaultBranchSha
};
