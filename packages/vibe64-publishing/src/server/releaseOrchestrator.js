import {
  UNFINISHED_RELEASE_STATUSES,
  assertPreflightAllowsRelease,
  createPublishPlan,
  isReleaseVersion,
  nextBuildNumbers,
  publishPlanDisplayId,
  runPreflight
} from "@local/vibe64-packaging/server";
import { recoveryKitCovers } from "@local/vibe64-packaging/server/keys";

import { publishingError } from "./publishingError.js";
import { RELEASE_CHECKS, installKey } from "./releaseChecks.js";
import { bumpVersion, recordSteps, summarizeRelease } from "./releaseRecords.js";
import { createReleaseRuns } from "./releaseRuns.js";

/** @typedef {ReturnType<typeof import("./state/targetsStore.js").createTargetsStore>} TargetsStore */
/** @typedef {import("./types.js").ReleaseHistoryStore} ReleaseHistoryStore */
/** @typedef {ReturnType<typeof import("./confirmationService.js").createConfirmationService>} ConfirmationService */
/** @typedef {import("@local/vibe64-packaging/server/types").AgeStore} AgeStore */
/** @typedef {import("./types.js").PublishingToolchains} PublishingToolchains */
/** @typedef {import("./types.js").ProjectRepository} ProjectRepository */
/** @typedef {ReturnType<typeof import("./verificationRunner.js").createVerificationRunner>} VerificationRunner */
/** @typedef {import("./types.js").CredentialBroker} CredentialBroker */
/** @typedef {ReturnType<typeof import("./sessionReleaseWriter.js").createSessionReleaseWriter>} SessionReleaseWriter */
/** @typedef {import("./types.js").PublishingPackaging} PublishingPackaging */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * The local release flow, end to end:
 *   1. prepare: the version bump and CHANGELOG entry are written into a session
 *      as an ordinary change (proposed by the agent or the Release dialog);
 *   2. the person Saves it like any other change;
 *   3. plan: the exact plan for the saved commit, with preflight;
 *   4. dry run (optional): build once, ask every destination what would happen;
 *   5. the person confirms the exact plan on the Publish page (never in chat);
 *   6. release: build every package once, tag the saved commit, fan out to every
 *      target, read each one back, and record it all in the release history.
 * Every target is resumable: confirming the same plan again finishes what is
 * left, and what is already published with the same bytes counts as done.
 * @param {object} dependencies
 * @param {string} dependencies.projectRuntimeRoot
 * @param {string} dependencies.resultStore
 * @param {string} [dependencies.cacheDirectory]
 * @param {TargetsStore} dependencies.targets
 * @param {ReleaseHistoryStore} dependencies.history
 * @param {ConfirmationService} dependencies.confirmations
 * @param {AgeStore} dependencies.keys
 * @param {PublishingToolchains} dependencies.toolchains
 * @param {ProjectRepository} dependencies.repository
 * @param {VerificationRunner} dependencies.verification
 * @param {CredentialBroker} dependencies.credentials
 * @param {SessionReleaseWriter} dependencies.sourceWriter
 * @param {PublishingPackaging} dependencies.packaging
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.baseEnvironment PATH and locale for builds and the Android checks
 * @param {RuntimeLogger} dependencies.logger
 * @param {() => string} [dependencies.now]
 */
function createReleaseOrchestrator({
  projectRuntimeRoot,
  resultStore,
  cacheDirectory = "",
  targets,
  history,
  confirmations,
  keys,
  toolchains,
  repository,
  verification,
  credentials,
  sourceWriter,
  packaging,
  baseEnvironment,
  logger,
  now = () => new Date().toISOString()
}) {
  const runs = createReleaseRuns({
    projectRuntimeRoot,
    resultStore,
    cacheDirectory,
    history,
    toolchains,
    repository,
    credentials,
    packaging,
    baseEnvironment,
    logger,
    now
  });
  const releaseCache = new Map(); // commit -> { packaging, versions }

  async function savedRelease(baseline) {
    if (!baseline?.supported || !baseline.commit) return null;
    if (!releaseCache.has(baseline.commit)) {
      releaseCache.set(baseline.commit, repository.readRelease(baseline.repositoryRoot, baseline.commit).catch((error) => {
        releaseCache.delete(baseline.commit);
        throw error;
      }));
    }
    return releaseCache.get(baseline.commit);
  }

  async function lastOutcomes() {
    const records = (await history.list({ limit: Infinity })).map(runs.interruptedOr);
    const latest = {};
    for (const record of records.filter((entry) => entry.kind === "release")) {
      for (const [targetId, outcome] of Object.entries(record.targets || {})) {
        if (latest[targetId] || outcome.status !== "proven") continue;
        const { localFile, ...shown } = outcome;
        latest[targetId] = { ...shown, downloadable: Boolean(localFile), releaseId: record.id, at: record.finishedAt || record.createdAt };
      }
    }
    return { records, latest };
  }

  async function readState() {
    const baseline = await repository.baseline();
    let release = null;
    let releaseProblem = "";
    try {
      release = await savedRelease(baseline);
    } catch (error) {
      releaseProblem = error?.message || "The saved project could not be read.";
    }
    const [targetList, { records, latest }, keyStatus, toolchainStatus, pending] = await Promise.all([
      targets.list(),
      lastOutcomes(),
      keys.status(),
      toolchains.status(),
      confirmations.pendingRequest()
    ]);
    const checks = baseline.commit ? await verification.status(baseline.commit) : null;
    const packages = release?.packaging?.status === "ready"
      ? release.packaging.packages.map((entry) => ({
        id: entry.id,
        label: entry.label || entry.id,
        packer: entry.packer,
        versionFrom: entry.versionFrom || null,
        version: release.versions[entry.id] ?? null,
        platforms: entry.platforms || [],
        applicationId: entry.application?.id || null,
        applicationName: entry.application?.name || null
      }))
      : [];
    return {
      baseline: {
        supported: Boolean(baseline.supported),
        commit: baseline.commit || null,
        branch: baseline.branch || null,
        saved: Boolean(baseline.saved),
        pushed: Boolean(baseline.pushed),
        remote: baseline.remote || null,
        message: baseline.message || ""
      },
      packaging: {
        status: release?.packaging?.status || (releaseProblem ? "error" : "missing"),
        packages,
        diagnostics: (release?.packaging?.diagnostics || []).map(({ message }) => message).slice(0, 20),
        problem: releaseProblem
      },
      targets: targetList.map((target) => ({
        ...target,
        latest: latest[target.id] || null,
        ...(target.destination === "android-sideload" ? { installKey: installKey(target, keyStatus) } : {})
      })),
      keys: {
        ...keyStatus,
        entries: (keyStatus.entries || []).map((entry) => ({ ...entry, coveredByRecoveryKit: recoveryKitCovers(keyStatus, entry.id) }))
      },
      toolchains: toolchainStatus,
      checks,
      pendingConfirmation: pending,
      releases: records.slice(0, 30).map(summarizeRelease),
      activeRelease: runs.activeReleaseId()
    };
  }

  /**
   * What the Release dialog offers before anything is written.
   */
  async function suggestRelease() {
    const baseline = await repository.baseline();
    const release = await savedRelease(baseline);
    if (!release || release.packaging.status !== "ready") return { packages: [], notes: "" };
    const releases = (await history.list({ limit: Infinity })).filter((record) => record.kind === "release" && record.status === "succeeded");
    const lastTag = releases[0]?.tags?.[0] || null;
    const subjects = await repository.subjectsSince(baseline.repositoryRoot, baseline.commit, lastTag);
    return {
      packages: release.packaging.packages.filter((entry) => entry.versionFrom).map((entry) => ({
        id: entry.id,
        label: entry.label || entry.id,
        current: release.versions[entry.id] ?? null,
        external: entry.versionFrom === "external",
        // A saved version no release has published yet can go out as it is.
        released: releases.some((record) => record.versions?.[entry.id] === release.versions[entry.id]),
        suggestions: ["patch", "minor", "major"].map((kind) => ({ kind, version: bumpVersion(release.versions[entry.id], kind) }))
      })),
      notes: subjects.filter((subject) => !/^release\b/iu.test(subject)).slice(0, 12).map((subject) => `- ${subject}`).join("\n")
    };
  }

  /**
   * Writes the version bump and changelog into the session as an ordinary
   * change. Nothing is saved, tagged or published.
   */
  async function prepareRelease({ sessionId, versions, notes, user }) {
    const baseline = await repository.baseline();
    const release = await savedRelease(baseline);
    if (!release || release.packaging.status !== "ready") {
      throw publishingError("Packaging is not ready on the saved project.", "vibe64_publishing_saved_packaging_missing");
    }
    const entries = Object.entries(versions);
    if (!entries.length) throw publishingError("Choose at least one package version.", "vibe64_publishing_prepare_invalid");
    const prepared = [];
    for (const [packageId, version] of entries) {
      const entry = release.packaging.packages.find((candidate) => candidate.id === packageId);
      if (!entry?.versionFrom) {
        throw publishingError(`${packageId} has no version Vibe64 manages.`, "vibe64_publishing_package_version_unmanaged", {
          params: { packageId }
        });
      }
      if (!isReleaseVersion(version)) {
        throw publishingError(`${version} is not a version such as 1.5.0.`, "vibe64_publishing_version_invalid", { params: { version } });
      }
      prepared.push(await sourceWriter.prepareAndWrite({ sessionId, entry, version, notes, user }));
    }
    return {
      sessionId,
      packages: prepared.map(({
        package: id,
        previousVersion,
        version,
        files
      }) => ({
        id,
        previousVersion,
        version,
        files: files.map(({ path: file }) => file)
      })),
      next: "Review the change and Save it. The release uses the saved commit."
    };
  }

  async function buildNumbersFor(packages, savedCommit) {
    const releases = (await history.list({ limit: Infinity })).map(runs.interruptedOr);
    return nextBuildNumbers({ releases, packages, savedCommit });
  }

  /**
   * Builds the current plan for the saved commit and runs preflight on it.
   */
  // readable-check: allow dependency-default - data: no chosen target ids plans every target
  async function plan({ targetIds = null, acknowledged = [] } = {}) {
    const baseline = await repository.baseline();
    if (!baseline.supported) throw publishingError(baseline.message, "vibe64_publishing_repository_unavailable");
    const release = await savedRelease(baseline);
    if (release.packaging.status !== "ready") {
      throw publishingError("Add a Packaging section and Save it before releasing.", "vibe64_publishing_packaging_missing");
    }
    const all = await targets.list();
    const chosen = targetIds?.length ? all.filter((target) => targetIds.includes(target.id)) : all;
    if (!chosen.length) throw publishingError("Add a target first.", "vibe64_publishing_no_targets");
    const builtIds = new Set();
    const visit = (id) => {
      const entry = release.packaging.packages.find((candidate) => candidate.id === id);
      if (!entry) return;
      if (entry.content) visit(entry.content);
      builtIds.add(id);
    };
    chosen.forEach((target) => visit(target.package));
    const built = release.packaging.packages.filter((entry) => builtIds.has(entry.id));
    const versions = Object.fromEntries(built.filter((entry) => entry.versionFrom).map((entry) => [entry.id, release.versions[entry.id]]));
    const hasAndroid = built.some((entry) => entry.packer === "capacitor");
    const androidTools = hasAndroid ? await toolchains.androidToolchains() : null;
    const toolStatus = hasAndroid ? await toolchains.status() : null;
    const { plan: publishPlan, planHash } = createPublishPlan({
      savedCommit: baseline.commit,
      packaging: release.packaging,
      versions,
      buildNumbers: await buildNumbersFor(built.map((entry) => ({ ...entry, version: versions[entry.id] ?? null })), baseline.commit),
      targets: chosen.map(({
        id,
        destination,
        package: packageId,
        channel,
        settings,
        account
      }) => ({
        id,
        destination,
        package: packageId,
        channel,
        settings,
        account
      })),
      toolchain: {
        node: process.versions.node,
        ...(hasAndroid ? {
          java: String(toolStatus?.java?.version || "missing").replace(/[^0-9A-Za-z.+_-]/gu, "") || "missing",
          "android-build-tools": packaging.androidTemplate.buildTools
        } : {})
      },
      templates: hasAndroid ? { [packaging.androidTemplate.id]: packaging.androidTemplate.capacitor } : {}
    });
    const keyStatus = await keys.status();
    // However many dry runs and failures came after it.
    const previousRelease = (await history.list({ limit: Infinity })).find((record) =>
      record.kind === "release" && record.status === "succeeded") ||
      null;
    const runtimeTargets = await Promise.all(publishPlan.targets.map((target) => runs.runtimeTarget(target)));
    const credentialFacts = keyStatus.unlocked
      ? await credentials.facts({ targets: runtimeTargets, toolchains: androidTools || {} })
      : Object.fromEntries(publishPlan.targets.map((target) => [target.id, {
        ok: false,
        message: "Unlock your publishing keys to check sign-ins."
      }]));
    const android = hasAndroid
      ? await repository.withCheckout(baseline.repositoryRoot, baseline.commit, (root) => packaging.gatherAndroidFacts({
        sourceRoot: root,
        packaging: release.packaging,
        packageIds: built.filter((entry) => entry.packer === "capacitor").map(({ id }) => id),
        toolchains: androidTools || {},
        baseEnvironment
      }))
      : null;
    const context = {
      baseline: { saved: baseline.saved, pushed: baseline.pushed, commit: baseline.commit, remote: baseline.remote },
      plan: publishPlan,
      packaging: release.packaging,
      previousRelease,
      tags: await repository.existingTags(baseline.repositoryRoot, publishPlan.tags),
      verification: await verification.status(baseline.commit),
      credentials: credentialFacts,
      android,
      keys: keyStatus
    };
    const preflight = runPreflight(RELEASE_CHECKS, context);
    const accepted = acknowledged.filter((id) => preflight.acknowledgementsNeeded.includes(id));
    return {
      plan: publishPlan,
      planHash,
      planId: publishPlanDisplayId(planHash),
      preflight: {
        ...preflight,
        acknowledged: accepted,
        ready: !preflight.blocked && preflight.acknowledgementsNeeded.every((id) => accepted.includes(id))
      },
      baseline,
      release,
      targets: chosen,
      androidTools
    };
  }

  /**
   * The plan as the confirmation and history show it: no secrets, no local paths.
   */
  function planSummary(current) {
    const { plan: publishPlan } = current;
    return {
      planHash: current.planHash,
      planId: current.planId,
      savedCommit: publishPlan.savedCommit,
      tags: publishPlan.tags,
      packages: publishPlan.packages,
      targets: publishPlan.targets.map((target) => ({
        id: target.id,
        destination: target.destination,
        package: target.package,
        channel: target.channel,
        settings: target.settings,
        account: target.account || null
      })),
      toolchain: publishPlan.toolchain,
      templates: publishPlan.templates,
      steps: publishPlan.steps
    };
  }

  async function planForTargets({ targetIds = [], acknowledged = [] } = {}) {
    const current = await plan({ targetIds, acknowledged });
    return {
      ...planSummary(current),
      preflight: current.preflight,
      baseline: { commit: current.baseline.commit, branch: current.baseline.branch, remote: current.baseline.remote }
    };
  }

  async function requireCurrentPlan({ planHash, targetIds = [], acknowledged = [] }) {
    const current = await plan({ targetIds, acknowledged });
    if (current.planHash !== planHash) {
      throw publishingError(
        "The plan changed since you reviewed it (new saved work, targets or tools). Review the new plan.",
        "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED",
        { details: { planHash: current.planHash }, messageCode: "vibe64_publishing_plan_changed_since_review" }
      );
    }
    return current;
  }

  /**
   * Dry run: build once, then ask each destination what would happen. Nothing
   * is tagged, signed for distribution or uploaded.
   */
  async function dryRun({ planHash, targetIds = [], acknowledged = [] }) {
    const current = await requireCurrentPlan({ planHash, targetIds, acknowledged });
    if (current.preflight.blocked) {
      throw publishingError(
        "Preflight found a problem that stops this release. Fix it first.",
        "vibe64_publishing_dry_run_preflight_blocked"
      );
    }
    const record = await history.create({
      kind: "dry-run",
      planHash: current.planHash,
      planId: current.planId,
      plan: planSummary(current),
      savedCommit: current.plan.savedCommit,
      tags: current.plan.tags,
      versions: Object.fromEntries(current.plan.packages.filter((entry) => entry.version).map((entry) => [entry.id, entry.version])),
      buildNumbers: {},
      steps: recordSteps(current.plan, "dry-run"),
      targets: {}
    });
    runs.startDryRun(current, record.id);
    return { releaseId: record.id, kind: "dry-run" };
  }

  /**
   * An assistant (or the page) asks for the confirmation prompt for this plan.
   */
  async function requestPublish({ planHash, targetIds = [], requestedBy = "assistant" }) {
    const current = await requireCurrentPlan({ planHash, targetIds });
    const request = await confirmations.request({
      planHash: current.planHash,
      targetIds: current.plan.targets.map(({ id }) => id),
      requestedBy
    });
    return {
      pendingConfirmation: request,
      planId: current.planId,
      message: "The person confirms this plan on the Publish page. Nothing is published until they do."
    };
  }

  /**
   * The person opens the confirmation on the Publish page.
   */
  async function openConfirmation({ planHash, targetIds = [], acknowledged = [], actor }) {
    if (actor?.kind !== "person") {
      throw publishingError("Only the person can open a publish confirmation, on the Publish page.", "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON", {
        messageCode: "vibe64_publishing_confirmation_open_person_only"
      });
    }
    const current = await requireCurrentPlan({ planHash, targetIds, acknowledged });
    assertPreflightAllowsRelease(current.preflight, acknowledged);
    const { token, expiresAt } = await confirmations.open({ planHash: current.planHash, actor });
    return { token, expiresAt, plan: planSummary(current) };
  }

  /**
   * The person confirmed: redeem, then release in the background.
   */
  async function confirmRelease({ planHash, token, targetIds = [], acknowledged = [], actor }) {
    const current = await requireCurrentPlan({ planHash, targetIds, acknowledged });
    assertPreflightAllowsRelease(current.preflight, acknowledged);
    const redeemed = await confirmations.redeem({ planHash: current.planHash, token, actor });
    const unfinished = (await history.list({ limit: Infinity })).map(runs.interruptedOr)
      .find((record) =>
        record.kind === "release" && record.planHash === current.planHash && UNFINISHED_RELEASE_STATUSES.includes(record.status));
    const record = unfinished
      ? await history.update(unfinished.id, (entry) => {
        entry.status = "running";
        entry.finishedAt = null;
        entry.resumedAt = now();
        entry.confirmedAt = redeemed.usedAt;
        delete entry.error;
        entry.log.push({ at: now(), level: "info", message: "Resumed after a new confirmation." });
        return entry;
      })
      : await history.create({
        kind: "release",
        planHash: current.planHash,
        planId: current.planId,
        plan: planSummary(current),
        savedCommit: current.plan.savedCommit,
        tags: current.plan.tags,
        versions: Object.fromEntries(current.plan.packages.filter((entry) => entry.version).map((entry) => [entry.id, entry.version])),
        buildNumbers: Object.fromEntries(
          current.plan.packages.filter((entry) => entry.buildNumber).map((entry) => [entry.id, entry.buildNumber])
        ),
        toolchain: current.plan.toolchain,
        templates: current.plan.templates,
        confirmedBy: redeemed.actorId,
        confirmedAt: redeemed.usedAt,
        acknowledged: current.preflight.acknowledged,
        steps: recordSteps(current.plan, "release"),
        targets: {}
      });
    runs.startRelease(current, record.id);
    return { releaseId: record.id, kind: "release", resumed: Boolean(unfinished) };
  }

  async function readRelease(id) {
    return summarizeRelease(runs.interruptedOr(await history.read(id)));
  }

  async function readLogs(id) {
    const record = await history.read(id);
    return { id: record.id, status: runs.interruptedOr(record).status, log: record.log || [] };
  }

  async function listHistory({ limit = 30 } = {}) {
    return (await history.list({ limit })).map(runs.interruptedOr).map(summarizeRelease);
  }

  return Object.freeze({
    confirmRelease,
    dryRun,
    listHistory,
    openConfirmation,
    plan: planForTargets,
    prepareRelease,
    readLogs,
    readRelease,
    readState,
    requestPublish,
    settle: runs.settle,
    suggestRelease
  });
}

export { createReleaseOrchestrator };
