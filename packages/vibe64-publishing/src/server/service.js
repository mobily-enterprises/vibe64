// The local publishing service: one per running Vibe64. The person's keys,
// licences and toolchains are theirs (one set on this computer); targets,
// history, confirmations and results are each project's own state.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  CAPACITOR_SHELL_TEMPLATE,
  buildPackage,
  gatherAndroidFacts,
  generateSideloadKey,
  npmTokenUserconfig,
  publishTarget,
  vibe64Destination,
  withStageCredentials
} from "@local/vibe64-packaging/server";
import { createAgeStore } from "@local/vibe64-packaging/server/keys";
import { gatherCredentialFacts } from "@local/vibe64-packaging/server/preflight/registries";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";

import { PUBLISH_ACCOUNT_KINDS, PUBLISH_DESTINATION_CATALOG } from "../shared/destinationCatalog.js";
import { confirmingActor, createConfirmationService } from "./confirmationService.js";
import { createCredentialBroker } from "./credentialBroker.js";
import { createRecoveryKit, restoreRecoveryKit } from "./credentials/recoveryKit.js";
import { createLanShare } from "./lanShare.js";
import { createProjectRepository } from "./projectRepository.js";
import { createReleaseOrchestrator } from "./releaseOrchestrator.js";
import { createSessionReleaseWriter } from "./sessionReleaseWriter.js";
import { createBuilderMap } from "./state/builderMap.js";
import { createReleaseHistoryStore } from "./state/releaseHistoryStore.js";
import { createTargetsStore } from "./state/targetsStore.js";
import { createToolchainManager } from "./toolchainLicence.js";
import { createVerificationRunner } from "./verificationRunner.js";

const run = promisify(execFile);
const TWINE_VERSION = "6.1.0";

function serviceError(message, code) {
  return Object.assign(new Error(message), { code });
}

function publishingRoots(env = process.env) {
  const systemRoot = String(getStudioProjectContext()?.systemRoot || "").trim() || resolveDefaultLocalEditorSystemRoot();
  const cacheHome = String(env.XDG_CACHE_HOME || "").trim() || path.join(os.homedir(), ".cache");
  return {
    personalRoot: path.resolve(env.VIBE64_PUBLISHING_HOME || path.join(systemRoot, "publishing")),
    toolchainsRoot: path.resolve(env.VIBE64_PUBLISHING_TOOLCHAINS || path.join(cacheHome, "vibe64", "publishing", "toolchains")),
    cacheRoot: path.resolve(env.VIBE64_PUBLISHING_CACHE || path.join(cacheHome, "vibe64", "publishing", "build-cache"))
  };
}

// A result shape the routes and assistant contracts share.
async function result(operation) {
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

function createPublishingService({ project, sourceEditor, env = process.env, roots = null, now = () => new Date().toISOString() } = {}) {
  if (!project || typeof project.readCurrentProject !== "function") throw new TypeError("Publishing needs the project service.");
  const { personalRoot, toolchainsRoot, cacheRoot } = roots || publishingRoots(env);
  const keys = createAgeStore({ directory: path.join(personalRoot, "keys") });
  const pythonTools = path.join(toolchainsRoot, "python-publish");
  const baseToolchains = createToolchainManager({ personalRoot, toolchainsRoot, now });
  const toolchains = Object.freeze({
    ...baseToolchains,
    async status() {
      return { ...await baseToolchains.status(), python: { ready: Boolean(await stat(path.join(pythonTools, "bin", "python")).catch(() => null)), folder: pythonTools } };
    },
    async registryTools() {
      return await stat(path.join(pythonTools, "bin", "python")).catch(() => null)
        ? { twine: [path.join(pythonTools, "bin", "python"), "-m", "twine"] }
        : {};
    }
  });
  const packaging = Object.freeze({
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
  const broker = createCredentialBroker({ keys, packaging, now });
  const lanShare = createLanShare();
  const repository = createProjectRepository({ readProject: () => project.readCurrentProject() });
  const writer = createSessionReleaseWriter({ project, sourceEditor });
  const projects = new Map();

  function projectRuntime() {
    const context = currentProjectRequestContext();
    const runtimeRoot = String(context?.projectRuntimeRoot || "").trim();
    if (!path.isAbsolute(runtimeRoot)) throw serviceError("Open a project to publish it.", "vibe64_publishing_project_required");
    if (!projects.has(runtimeRoot)) {
      const publishingRoot = path.join(runtimeRoot, "publishing");
      const targets = createTargetsStore({ runtimeRoot: publishingRoot, now });
      const history = createReleaseHistoryStore({ runtimeRoot: publishingRoot, now });
      const verification = createVerificationRunner({ runtimeRoot: publishingRoot, repository, now });
      const confirmations = createConfirmationService({ runtimeRoot: publishingRoot });
      const orchestrator = createReleaseOrchestrator({
        projectRuntimeRoot: runtimeRoot,
        resultStore: path.join(publishingRoot, "results"),
        cacheDirectory: cacheRoot,
        targets,
        history,
        builders: createBuilderMap({ runtimeRoot: publishingRoot }),
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
    if (destination === "pypi") {
      const address = chosen?.address || "";
      if (!address || /upload\.pypi\.org/u.test(address)) return { instance: "pypi" };
      if (/test\.pypi\.org/u.test(address)) return { instance: "testpypi" };
      const upload = address.endsWith("/") ? address : `${address}/`;
      return { repository: upload, index: new URL("simple/", new URL("../", upload)).href };
    }
    if (destination === "github-releases") {
      const baseline = await repository.baseline();
      if (!baseline.remote?.githubRepository) throw serviceError("GitHub Releases needs this project's remote on GitHub.", "vibe64_publishing_github_remote_missing");
      return { repository: baseline.remote.githubRepository };
    }
    return {};
  }

  function requireAccountKind(destination, account, accounts) {
    const kind = Object.values(PUBLISH_ACCOUNT_KINDS).find((entry) => entry.destination === destination);
    if (!kind) return null;
    const chosen = accounts.find((entry) => entry.id === account);
    if (!chosen || chosen.kind !== kind.id) throw serviceError(`Choose a ${kind.label} account for this target.`, "vibe64_publishing_account_missing");
    return chosen;
  }

  return Object.freeze({
    keys,
    lanShare,
    readState: () => result(async () => {
      const { orchestrator } = projectRuntime();
      const state = await orchestrator.readState();
      return {
        ...state,
        destinations: PUBLISH_DESTINATION_CATALOG,
        accountKinds: Object.values(PUBLISH_ACCOUNT_KINDS),
        accounts: await broker.accounts(),
        keys: { ...state.keys, entries: state.keys.entries.map(({ id, kind, label, createdAt, certificateSha256, accountKind, address }) => ({ id, kind, label, createdAt, certificateSha256, accountKind, address })) },
        share: lanShare.status()
      };
    }),
    suggestRelease: () => result(() => projectRuntime().orchestrator.suggestRelease()),
    prepareRelease: (input = {}) => result(() => projectRuntime().orchestrator.prepareRelease({
      sessionId: input.sessionId, versions: input.versions || {}, notes: input.notes, user: input.vibe64User || null
    })),
    addTarget: (input = {}) => result(async () => {
      const { targets, orchestrator } = projectRuntime();
      const state = await orchestrator.readState();
      const entry = state.packaging.packages.find((candidate) => candidate.id === input.package);
      if (!entry) {
        throw serviceError("Packaging does not declare that package. Ask a coding conversation to add it, then Save.", "vibe64_publishing_package_missing");
      }
      const destination = vibe64Destination(input.destination);
      if (!destination.packers.includes(entry.packer)) throw serviceError(`${destination.label} cannot publish a ${entry.packer} package.`, "vibe64_publishing_target_invalid");
      const accounts = await broker.accounts();
      requireAccountKind(destination.id, input.account, accounts);
      const settings = { ...await defaultSettings({ destination: destination.id, account: input.account }), ...(input.settings || {}) };
      const target = await targets.add({ destination: destination.id, package: entry.id, channel: input.channel || null, account: input.account || null, settings });
      return { target };
    }),
    updateTarget: (input = {}) => result(async () => {
      const { targets } = projectRuntime();
      const existing = await targets.get(input.targetId);
      if (!existing) throw serviceError(`There is no target ${input.targetId}.`, "vibe64_publishing_target_missing");
      const changes = {};
      if (input.account !== undefined) {
        requireAccountKind(existing.destination, input.account, await broker.accounts());
        changes.account = input.account;
        Object.assign(changes, { settings: { ...existing.settings, ...await defaultSettings({ destination: existing.destination, account: input.account }) } });
      }
      if (input.channel !== undefined) changes.channel = input.channel || null;
      return { target: await targets.update(existing.id, changes) };
    }),
    removeTarget: (input = {}) => result(() => projectRuntime().targets.remove(input.targetId)),
    plan: (input = {}) => result(async () => ({ plan: await projectRuntime().orchestrator.plan({ targetIds: input.targetIds || [], acknowledged: input.acknowledged || [] }) })),
    runChecks: () => result(async () => {
      const baseline = await repository.baseline();
      if (!baseline.supported) throw serviceError(baseline.message, "vibe64_publishing_repository_unavailable");
      const { verification } = projectRuntime();
      verification.run({ repositoryRoot: baseline.repositoryRoot, commit: baseline.commit });
      return { checks: await verification.status(baseline.commit) };
    }),
    // The release needs the saved work on the remote; the person pushes it from
    // the Release dialog instead of hunting for the branch menu.
    pushSavedWork: () => result(async () => {
      const baseline = await repository.baseline();
      if (!baseline.supported) throw serviceError(baseline.message, "vibe64_publishing_repository_unavailable");
      if (!baseline.saved) throw serviceError("Save your changes before pushing them.", "vibe64_publishing_baseline_unsaved");
      const pushed = await repository.pushSaved(baseline);
      return { ...pushed, baseline: await repository.baseline() };
    }),
    dryRun: (input = {}) => result(() => projectRuntime().orchestrator.dryRun({
      planHash: input.planHash, targetIds: input.targetIds || [], acknowledged: input.acknowledged || []
    })),
    requestPublish: (input = {}) => result(() => projectRuntime().orchestrator.requestPublish({
      planHash: input.planHash, targetIds: input.targetIds || [], requestedBy: "assistant"
    })),
    dismissRequest: () => result(async () => ({ pendingConfirmation: await projectRuntime().confirmations.dismissRequest() })),
    openConfirmation: (input = {}, context = {}) => result(() => projectRuntime().orchestrator.openConfirmation({
      planHash: input.planHash,
      targetIds: input.targetIds || [],
      acknowledged: input.acknowledged || [],
      actor: confirmingActor({ channel: context.channel, assistant: Boolean(context.colleague), user: input.vibe64User })
    })),
    confirmRelease: (input = {}, context = {}) => result(() => projectRuntime().orchestrator.confirmRelease({
      planHash: input.planHash,
      token: input.token,
      targetIds: input.targetIds || [],
      acknowledged: input.acknowledged || [],
      actor: confirmingActor({ channel: context.channel, assistant: Boolean(context.colleague), user: input.vibe64User })
    })),
    listHistory: (input = {}) => result(async () => ({ releases: await projectRuntime().orchestrator.listHistory({ limit: input.limit || 30 }) })),
    readRelease: (input = {}) => result(async () => ({ release: await projectRuntime().orchestrator.readRelease(input.releaseId) })),
    readLogs: (input = {}) => result(() => projectRuntime().orchestrator.readLogs(input.releaseId)),

    createKeys: (input = {}) => result(async () => ({ keys: await keys.create({ passphrase: input.passphrase, windowMs: minutes(input.windowMinutes) }) })),
    unlockKeys: (input = {}) => result(async () => ({ keys: await keys.unlock({ passphrase: input.passphrase, windowMs: minutes(input.windowMinutes) }) })),
    lockKeys: () => result(async () => ({ keys: await keys.lock() })),
    addAccount: (input = {}) => result(async () => ({ account: await broker.addAccount(input) })),
    removeAccount: (input = {}) => result(() => broker.removeAccount(input.accountId)),
    recoveryKit: (input = {}) => result(async () => {
      const kit = await createRecoveryKit({ store: keys, passphrase: input.passphrase, now });
      return { fileName: kit.fileName, data: kit.bytes.toString("base64"), record: kit.record };
    }),
    restoreRecoveryKit: (input = {}) => result(async () => restoreRecoveryKit({ store: keys, bytes: Buffer.from(String(input.data || ""), "base64"), passphrase: input.passphrase })),
    createInstallKey: (input = {}) => result(async () => {
      const { targets, orchestrator } = projectRuntime();
      const target = await targets.get(input.targetId);
      if (target?.destination !== "android-sideload") throw serviceError("Install keys belong to an Install on my phone target.", "vibe64_publishing_target_invalid");
      const status = await toolchains.status();
      if (!status.java.ready) throw serviceError("Set up the Android build tools first: the key is made with Java.", "vibe64_publishing_toolchain_missing");
      const state = await orchestrator.readState();
      const entry = state.packaging.packages.find((candidate) => candidate.id === target.package);
      const key = await broker.createSideloadKey({ target, appName: entry?.applicationName || target.package, javaHome: status.java.javaHome });
      await targets.update(target.id, { settings: { ...target.settings, certificateSha256: key.certificateSha256 } });
      return { key: { certificateSha256: key.certificateSha256, algorithm: key.algorithm } };
    }),
    toolchainLicence: () => result(async () => ({ licence: await toolchains.licence() })),
    acceptToolchainLicence: (input = {}) => result(async () => ({
      acceptance: await toolchains.accept({ id: input.id, hash: input.hash, acceptedBy: input.vibe64User?.username || input.vibe64User?.id || os.userInfo().username })
    })),
    installAndroidToolchain: () => result(async () => ({ install: await toolchains.installAndroid() })),
    installPythonTools: () => result(async () => {
      await run("python3", ["-m", "venv", pythonTools], { timeout: 120_000 });
      await run(path.join(pythonTools, "bin", "python"), ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", `twine==${TWINE_VERSION}`], { timeout: 300_000 });
      return { python: { ready: true, folder: pythonTools } };
    }),
    shareInstall: (input = {}) => result(async () => ({ share: await lanShare.start(await signedApk(input)) })),
    stopShare: () => result(async () => ({ share: await lanShare.stop() })),
    // The signed APK of one proven phone target, for the download route.
    signedApk
  });

  async function signedApk({ releaseId, targetId } = {}) {
    const { history } = projectRuntime();
    const record = await history.read(releaseId);
    const outcome = record.targets?.[targetId];
    if (outcome?.status !== "proven" || !outcome.localFile || record.plan?.targets?.find((target) => target.id === targetId)?.destination !== "android-sideload") {
      throw serviceError("That release has no signed phone app to download.", "vibe64_publishing_download_missing");
    }
    return { key: `${releaseId}/${targetId}`, file: outcome.localFile, fileName: outcome.proof?.fileName || path.basename(outcome.localFile) };
  }
}

function minutes(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return Math.round(Number(value) * 60 * 1000);
}

export { createPublishingService, publishingRoots, result as publishingResult };
