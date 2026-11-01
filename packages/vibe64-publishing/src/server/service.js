// The local publishing service: one per running Vibe64. The person's keys,
// licences and toolchains are theirs (one set on this computer); targets,
// history, confirmations and results are each project's own state.
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CAPACITOR_SHELL_TEMPLATE,
  buildPackage,
  gatherAndroidFacts,
  generateSideloadKey,
  npmTokenUserconfig,
  publishTarget,
  pypiSettingsForAddress,
  vibe64Destination,
  withStageCredentials
} from "@local/vibe64-packaging/server";
import { createAgeStore, createRecoveryKit, restoreRecoveryKit } from "@local/vibe64-packaging/server/keys";
import { gatherCredentialFacts } from "@local/vibe64-packaging/server/preflight/registries";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";

import { PUBLISH_ACCOUNT_KINDS, PUBLISH_DESTINATION_CATALOG } from "../shared/destinationCatalog.js";
import { confirmingActor, createConfirmationService } from "./confirmationService.js";
import { createCredentialBroker } from "./credentialBroker.js";
import { createLanShare } from "./lanShare.js";
import { createProjectRepository } from "./projectRepository.js";
import { createReleaseOrchestrator } from "./releaseOrchestrator.js";
import { createSessionReleaseWriter } from "./sessionReleaseWriter.js";
import { createReleaseHistoryStore } from "./state/releaseHistoryStore.js";
import { createTargetsStore } from "./state/targetsStore.js";
import { createToolchainManager } from "./toolchainLicence.js";
import { createVerificationRunner } from "./verificationRunner.js";
import { publishingError } from "./publishingError.js";

/** @typedef {ReturnType<typeof import("./toolchainLicence.js").createToolchainManager>} ToolchainManager */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */

const TWINE_VERSION = "6.1.0";

function publishingRoots(env = process.env) {
  const systemRoot = String(getStudioProjectContext()?.systemRoot || "").trim() || resolveDefaultLocalEditorSystemRoot();
  const cacheHome = String(env.XDG_CACHE_HOME || "").trim() || path.join(os.homedir(), ".cache");
  return {
    personalRoot: path.resolve(env.VIBE64_PUBLISHING_HOME || path.join(systemRoot, "publishing")),
    toolchainsRoot: path.resolve(env.VIBE64_PUBLISHING_TOOLCHAINS || path.join(cacheHome, "vibe64", "publishing", "toolchains")),
    cacheRoot: path.resolve(env.VIBE64_PUBLISHING_CACHE || path.join(cacheHome, "vibe64", "publishing", "build-cache"))
  };
}

/**
 * A result shape the routes and assistant contracts share.
 */
async function publishingResult(operation) {
  try {
    return { ok: true, ...await operation() };
  } catch (error) {
    return {
      ok: false,
      code: String(error?.code || "vibe64_publishing_failed"),
      error: String(error?.message || "Publishing failed."),
      ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
    };
  }
}

/**
 * The Python publishing tools install through Vibe64's command gateway, with
 * the Python Vibe64 finds for project commands.
 */
async function installTool(toolchainsRoot, command, args, timeout, runCommand) {
  await mkdir(toolchainsRoot, { recursive: true });
  const result = await runCommand({
    actor: "daemon",
    allowedRoots: [toolchainsRoot],
    command,
    args,
    cwd: toolchainsRoot,
    envPolicy: "project",
    inheritProcessEnv: true,
    mode: "capture",
    purpose: "workspace-cache",
    runtimes: ["python"],
    timeout,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result?.ok !== true) {
    throw Object.assign(
      new Error(`Installing the Python publishing tools failed: ${String(result?.stderr || result?.error || "").trim().slice(-600)}`),
      { code: "vibe64_publishing_toolchain_failed" }
    );
  }
}

/**
 * The toolchains publishing uses: this computer's Android toolchains, and the
 * Python publishing tools in their own folder.
 * @param {object} dependencies
 * @param {ToolchainManager} dependencies.baseToolchains
 * @param {string} dependencies.pythonTools
 */
function createPublishingToolchains({ baseToolchains, pythonTools }) {
  async function status() {
    return {
      ...await baseToolchains.status(),
      python: { ready: Boolean(await stat(path.join(pythonTools, "bin", "python")).catch(() => null)), folder: pythonTools }
    };
  }

  async function registryTools() {
    return await stat(path.join(pythonTools, "bin", "python")).catch(() => null)
      ? { twine: [path.join(pythonTools, "bin", "python"), "-m", "twine"] }
      : {};
  }

  return Object.freeze({
    accept: baseToolchains.accept,
    androidToolchains: baseToolchains.androidToolchains,
    installAndroid: baseToolchains.installAndroid,
    licence: baseToolchains.licence,
    status,
    toolchainsRoot: baseToolchains.toolchainsRoot,
    registryTools
  });
}

/**
 * The packaging operations releases use, from @local/vibe64-packaging.
 */
function createPublishingPackaging() {
  return Object.freeze({
    androidTemplate: CAPACITOR_SHELL_TEMPLATE,
    buildPackage,
    gatherAndroidFacts,
    gatherCredentialFacts,
    generateSideloadKey,
    npmTokenUserconfig,
    publishTarget,
    vibe64Destination,
    withStageCredentials
  });
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {SourceEditorService} dependencies.sourceEditor
 * @param {RuntimeEnv} [dependencies.env]
 * @param {{ personalRoot: string, toolchainsRoot: string, cacheRoot: string } | null} [dependencies.roots]
 * @param {() => string} [dependencies.now]
 * @param {typeof runVibe64Command} [dependencies.runCommand]
 */
function createPublishingService({
  project,
  sourceEditor,
  env = process.env,
  roots = null,
  now = () => new Date().toISOString(),
  runCommand = runVibe64Command
}) {
  const { personalRoot, toolchainsRoot, cacheRoot } = roots || publishingRoots(env);
  const keys = createAgeStore({ directory: path.join(personalRoot, "keys") });
  const pythonTools = path.join(toolchainsRoot, "python-publish");
  const baseToolchains = createToolchainManager({
    personalRoot,
    toolchainsRoot,
    now
  });
  const toolchains = createPublishingToolchains({ baseToolchains, pythonTools });
  const packaging = createPublishingPackaging();
  const broker = createCredentialBroker({
    keys,
    packaging,
    now
  });
  const lanShare = createLanShare();
  const repository = createProjectRepository({ readProject: () => project.readCurrentProject() });
  const writer = createSessionReleaseWriter({ project, sourceEditor });
  const projects = new Map();

  function projectRuntime() {
    const context = currentProjectRequestContext();
    const runtimeRoot = String(context?.projectRuntimeRoot || "").trim();
    if (!path.isAbsolute(runtimeRoot)) throw publishingError("Open a project to publish it.", "vibe64_publishing_project_required");
    if (!projects.has(runtimeRoot)) {
      const publishingRoot = path.join(runtimeRoot, "publishing");
      const targets = createTargetsStore({ runtimeRoot: publishingRoot, now });
      const history = createReleaseHistoryStore({ runtimeRoot: publishingRoot, now });
      const verification = createVerificationRunner({
        runtimeRoot: publishingRoot,
        repository,
        now
      });
      const confirmations = createConfirmationService({ runtimeRoot: publishingRoot });
      const orchestrator = createReleaseOrchestrator({
        projectRuntimeRoot: runtimeRoot,
        resultStore: path.join(publishingRoot, "results"),
        cacheDirectory: cacheRoot,
        targets,
        history,
        confirmations,
        keys,
        toolchains,
        repository,
        verification,
        credentials: broker,
        sourceWriter: writer,
        packaging,
        now
      });
      projects.set(runtimeRoot, { targets, history, verification, confirmations, orchestrator });
    }
    return projects.get(runtimeRoot);
  }

  async function defaultSettings({ destination, account }) {
    const accounts = await broker.accounts();
    const chosen = accounts.find((entry) => entry.id === account) || null;
    if (destination === "npm") return { registry: chosen?.address || PUBLISH_ACCOUNT_KINDS.npm.defaultAddress };
    if (destination === "pypi") return pypiSettingsForAddress(chosen?.address || "");
    if (destination === "github-releases") {
      const baseline = await repository.baseline();
      if (!baseline.remote?.githubRepository) {
        throw publishingError("GitHub Releases needs this project's remote on GitHub.", "vibe64_publishing_github_remote_missing");
      }
      return { repository: baseline.remote.githubRepository };
    }
    return {};
  }

  function requireAccountKind(destination, account, accounts) {
    const kind = Object.values(PUBLISH_ACCOUNT_KINDS).find((entry) => entry.destination === destination);
    if (!kind) return null;
    const chosen = accounts.find((entry) => entry.id === account);
    if (!chosen || chosen.kind !== kind.id) {
      throw publishingError(`Choose a ${kind.label} account for this target.`, "vibe64_publishing_account_missing");
    }
    return chosen;
  }

  function restoreFromRecoveryKit(input) {
    return publishingResult(async () => restoreRecoveryKit({
      store: keys,
      bytes: Buffer.from(String(input.data || ""), "base64"),
      passphrase: input.passphrase
    }));
  }

  function readState() {
    return publishingResult(async () => {
      const { orchestrator } = projectRuntime();
      const state = await orchestrator.readState();
      return {
        ...state,
        destinations: PUBLISH_DESTINATION_CATALOG.map((entry) => ({ ...entry, packers: vibe64Destination(entry.id).packers })),
        accountKinds: Object.values(PUBLISH_ACCOUNT_KINDS),
        accounts: await broker.accounts(),
        keys: {
          ...state.keys,
          entries: state.keys.entries.map(({
            id,
            kind,
            label,
            createdAt,
            certificateSha256,
            accountKind,
            address,
            coveredByRecoveryKit
          }) => ({
            id,
            kind,
            label,
            createdAt,
            certificateSha256,
            accountKind,
            address,
            coveredByRecoveryKit
          }))
        },
        share: lanShare.status()
      };
    });
  }

  function suggestRelease() {
    return publishingResult(() => projectRuntime().orchestrator.suggestRelease());
  }

  function prepareRelease(input) {
    return publishingResult(() => projectRuntime().orchestrator.prepareRelease({
      sessionId: input.sessionId,
      versions: input.versions,
      notes: input.notes,
      user: input.vibe64User
    }));
  }

  function addTarget(input) {
    return publishingResult(async () => {
      const { targets, orchestrator } = projectRuntime();
      const state = await orchestrator.readState();
      const entry = state.packaging.packages.find((candidate) => candidate.id === input.package);
      if (!entry) {
        throw publishingError(
          "Packaging does not declare that package. Ask a coding conversation to add it, then Save.",
          "vibe64_publishing_package_missing"
        );
      }
      const destination = vibe64Destination(input.destination);
      if (!destination.packers.includes(entry.packer)) {
        throw publishingError(`${destination.label} cannot publish a ${entry.packer} package.`, "vibe64_publishing_target_invalid");
      }
      const accounts = await broker.accounts();
      requireAccountKind(destination.id, input.account, accounts);
      const settings = { ...await defaultSettings({ destination: destination.id, account: input.account }), ...(input.settings || {}) };
      const target = await targets.add({
        destination: destination.id,
        package: entry.id,
        channel: input.channel || null,
        account: input.account || null,
        settings
      });
      return { target };
    });
  }

  function updateTarget(input) {
    return publishingResult(async () => {
      const { targets } = projectRuntime();
      const existing = await targets.get(input.targetId);
      if (!existing) throw publishingError(`There is no target ${input.targetId}.`, "vibe64_publishing_target_missing");
      const changes = {};
      if (input.account !== undefined) {
        requireAccountKind(existing.destination, input.account, await broker.accounts());
        changes.account = input.account;
        Object.assign(changes, {
          settings: {
            ...existing.settings,
            ...await defaultSettings({ destination: existing.destination, account: input.account })
          }
        });
      }
      if (input.channel !== undefined) changes.channel = input.channel || null;
      return { target: await targets.update(existing.id, changes) };
    });
  }

  function removeTarget(input) {
    return publishingResult(() => projectRuntime().targets.remove(input.targetId));
  }

  function plan(input) {
    return publishingResult(async () => ({
      plan: await projectRuntime().orchestrator.plan({
        targetIds: input.targetIds || [],
        acknowledged: input.acknowledged || []
      })
    }));
  }

  function runChecks() {
    return publishingResult(async () => {
      const baseline = await repository.baseline();
      if (!baseline.supported) throw publishingError(baseline.message, "vibe64_publishing_repository_unavailable");
      const { verification } = projectRuntime();
      verification.run({ repositoryRoot: baseline.repositoryRoot, commit: baseline.commit });
      return { checks: await verification.status(baseline.commit) };
    });
  }

  /**
   * The release needs the saved work on the remote; the person pushes it from
   * the Release dialog instead of hunting for the branch menu.
   */
  function pushSavedWork() {
    return publishingResult(async () => {
      const baseline = await repository.baseline();
      if (!baseline.supported) throw publishingError(baseline.message, "vibe64_publishing_repository_unavailable");
      if (!baseline.saved) throw publishingError("Save your changes before pushing them.", "vibe64_publishing_baseline_unsaved");
      const pushed = await repository.pushSaved(baseline);
      return { ...pushed, baseline: await repository.baseline() };
    });
  }

  function dryRun(input) {
    return publishingResult(() => projectRuntime().orchestrator.dryRun({
      planHash: input.planHash,
      targetIds: input.targetIds || [],
      acknowledged: input.acknowledged || []
    }));
  }

  function requestPublish(input) {
    return publishingResult(() => projectRuntime().orchestrator.requestPublish({
      planHash: input.planHash,
      targetIds: input.targetIds || [],
      requestedBy: "assistant"
    }));
  }

  function dismissRequest() {
    return publishingResult(async () => ({ pendingConfirmation: await projectRuntime().confirmations.dismissRequest() }));
  }

  function openConfirmation(input, context) {
    return publishingResult(() => projectRuntime().orchestrator.openConfirmation({
      planHash: input.planHash,
      targetIds: input.targetIds || [],
      acknowledged: input.acknowledged || [],
      actor: confirmingActor({ channel: context.channel, assistant: Boolean(context.colleague), user: input.vibe64User })
    }));
  }

  function confirmRelease(input, context) {
    return publishingResult(() => projectRuntime().orchestrator.confirmRelease({
      planHash: input.planHash,
      token: input.token,
      targetIds: input.targetIds || [],
      acknowledged: input.acknowledged || [],
      actor: confirmingActor({ channel: context.channel, assistant: Boolean(context.colleague), user: input.vibe64User })
    }));
  }

  function listHistory(input) {
    return publishingResult(async () => ({ releases: await projectRuntime().orchestrator.listHistory({ limit: input.limit || 30 }) }));
  }

  function readRelease(input) {
    return publishingResult(async () => ({ release: await projectRuntime().orchestrator.readRelease(input.releaseId) }));
  }

  function readLogs(input) {
    return publishingResult(() => projectRuntime().orchestrator.readLogs(input.releaseId));
  }

  function createKeys(input) {
    return publishingResult(async () => ({
      keys: await keys.create({
        passphrase: input.passphrase,
        windowMs: minutes(input.windowMinutes)
      })
    }));
  }

  function unlockKeys(input) {
    return publishingResult(async () => ({
      keys: await keys.unlock({
        passphrase: input.passphrase,
        windowMs: minutes(input.windowMinutes)
      })
    }));
  }

  function lockKeys() {
    return publishingResult(async () => ({ keys: await keys.lock() }));
  }

  function addAccount(input) {
    return publishingResult(async () => ({ account: await broker.addAccount(input) }));
  }

  function removeAccount(input) {
    return publishingResult(() => broker.removeAccount(input.accountId));
  }

  function recoveryKit(input) {
    return publishingResult(async () => {
      const kit = await createRecoveryKit({
        store: keys,
        passphrase: input.passphrase,
        now
      });
      return { fileName: kit.fileName, data: kit.bytes.toString("base64"), record: kit.record };
    });
  }

  function createInstallKey(input) {
    return publishingResult(async () => {
      const { targets, orchestrator } = projectRuntime();
      const target = await targets.get(input.targetId);
      if (target?.destination !== "android-sideload") {
        throw publishingError("Install keys belong to an Install on my phone target.", "vibe64_publishing_target_invalid");
      }
      const status = await toolchains.status();
      if (!status.java.ready) {
        throw publishingError("Set up the Android build tools first: the key is made with Java.", "vibe64_publishing_toolchain_missing");
      }
      const state = await orchestrator.readState();
      const entry = state.packaging.packages.find((candidate) => candidate.id === target.package);
      const key = await broker.createSideloadKey({
        target,
        appName: entry?.applicationName || target.package,
        javaHome: status.java.javaHome
      });
      await targets.update(target.id, { settings: { ...target.settings, certificateSha256: key.certificateSha256 } });
      return { key: { certificateSha256: key.certificateSha256, algorithm: key.algorithm } };
    });
  }

  function toolchainLicence() {
    return publishingResult(async () => ({ licence: await toolchains.licence() }));
  }

  function acceptToolchainLicence(input) {
    return publishingResult(async () => ({
      acceptance: await toolchains.accept({
        id: input.id,
        hash: input.hash,
        acceptedBy: input.vibe64User?.username || input.vibe64User?.id || os.userInfo().username
      })
    }));
  }

  function installAndroidToolchain() {
    return publishingResult(async () => ({ install: await toolchains.installAndroid() }));
  }

  function installPythonTools() {
    return publishingResult(async () => {
      await installTool(toolchainsRoot, "python3", ["-m", "venv", pythonTools], 120_000, runCommand);
      await installTool(
        toolchainsRoot,
        path.join(pythonTools, "bin", "python"),
        ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", `twine==${TWINE_VERSION}`],
        300_000,
        runCommand
      );
      return { python: { ready: true, folder: pythonTools } };
    });
  }

  function shareInstall(input) {
    return publishingResult(async () => ({ share: await lanShare.start(await signedApk(input)) }));
  }

  function stopShare() {
    return publishingResult(async () => ({ share: await lanShare.stop() }));
  }

  return Object.freeze({
    keys,
    lanShare,
    readState,
    suggestRelease,
    prepareRelease,
    addTarget,
    updateTarget,
    removeTarget,
    plan,
    runChecks,
    pushSavedWork,
    dryRun,
    requestPublish,
    dismissRequest,
    openConfirmation,
    confirmRelease,
    listHistory,
    readRelease,
    readLogs,
    createKeys,
    unlockKeys,
    lockKeys,
    addAccount,
    removeAccount,
    recoveryKit,
    restoreRecoveryKit: restoreFromRecoveryKit,
    createInstallKey,
    toolchainLicence,
    acceptToolchainLicence,
    installAndroidToolchain,
    installPythonTools,
    shareInstall,
    stopShare,
    signedApkDownload
  });

  /**
   * The signed APK of one proven phone target.
   */
  async function signedApk({ releaseId, targetId }) {
    const { history } = projectRuntime();
    const record = await history.read(releaseId);
    const outcome = record.targets?.[targetId];
    if (outcome?.status !== "proven" ||
        !outcome.localFile ||
        record.plan?.targets?.find((target) => target.id === targetId)?.destination !== "android-sideload") {
      throw publishingError("That release has no signed phone app to download.", "vibe64_publishing_download_missing");
    }
    return {
      key: `${releaseId}/${targetId}`,
      file: outcome.localFile,
      fileName: outcome.proof?.fileName || path.basename(outcome.localFile)
    };
  }

  /**
   * The signed APK of one proven phone target, opened for the download route.
   */
  async function signedApkDownload({ releaseId, targetId }) {
    const apk = await signedApk({ releaseId, targetId });
    const details = await stat(apk.file).catch(() => null);
    if (!details?.isFile()) throw publishingError("The signed APK is gone. Release again.", "vibe64_publishing_download_missing");
    return { fileName: apk.fileName, size: details.size, stream: createReadStream(apk.file) };
  }
}

function minutes(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return Math.round(Number(value) * 60 * 1000);
}

export { createPublishingPackaging, createPublishingService, createPublishingToolchains, publishingResult, publishingRoots };
