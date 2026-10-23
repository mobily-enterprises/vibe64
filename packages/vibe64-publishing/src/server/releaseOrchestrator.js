// The local release flow, end to end:
//   1. prepare: the version bump and CHANGELOG entry are written into a session
//      as an ordinary change (proposed by the agent or the Release dialog);
//   2. the person Saves it like any other change;
//   3. plan: the exact plan for the saved commit, with preflight;
//   4. dry run (optional): build once, ask every destination what would happen;
//   5. the person confirms the exact plan on the Publish page (never in chat);
//   6. release: tag the saved commit, build every package once, fan out to every
//      target, read each one back, and record it all in the release history.
// Every target is resumable: confirming the same plan again finishes what is
// left, and what is already published with the same bytes counts as done.
import os from "node:os";
import path from "node:path";

import {
  VIBE64_PREFLIGHT_CHECKS,
  assertPreflightAllowsRelease,
  createPublishPlan,
  definePreflightCheck,
  publishPlanDisplayId,
  runPreflight
} from "@local/vibe64-packaging/server";
import { VIBE64_REGISTRY_PREFLIGHT_CHECKS } from "@local/vibe64-packaging/server/preflight/registries";
import { VIBE64_ANDROID_PREFLIGHT_CHECKS } from "@local/vibe64-packaging/server/preflight/android";
import { publishingKeysUnlocked } from "@local/vibe64-packaging/server/keys";

import { recoveryKitCovers } from "./credentials/recoveryKit.js";
import { sideloadKeyEntryId } from "./credentialBroker.js";

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function releaseError(message, code, details) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

function uniqueChecks(...lists) {
  const seen = new Set();
  return lists.flat().filter((check) => !seen.has(check.id) && seen.add(check.id));
}

// Local custody rules that sit on top of the shared checks.
const sideloadKeyReady = definePreflightCheck({
  id: "phone-install-key",
  label: "Phone install key",
  severity: "block",
  applies: ({ plan }) => (plan?.targets || []).some((target) => target.destination === "android-sideload"),
  run: ({ plan, keys }) => {
    const problems = [];
    for (const target of plan.targets.filter((entry) => entry.destination === "android-sideload")) {
      const entryId = sideloadKeyEntryId(target);
      if (!target.settings?.certificateSha256 || !(keys?.entries || []).some((entry) => entry.id === entryId)) {
        problems.push(`${target.id} has no install key yet. Create it on its card.`);
      } else if (!recoveryKitCovers(keys, entryId)) {
        problems.push(`Download a recovery kit that includes ${target.id}'s install key: without it, losing this computer means phones can never update the app.`);
      }
    }
    return problems.length ? { ok: false, message: problems.join(" ") } : { ok: true, message: "Install key saved, with a recovery kit." };
  }
});

const githubRepositoryMatches = definePreflightCheck({
  id: "github-release-repository",
  label: "GitHub repository",
  severity: "block",
  applies: ({ plan }) => (plan?.targets || []).some((target) => target.destination === "github-releases"),
  run: ({ plan, baseline }) => {
    const remote = baseline?.remote?.githubRepository || null;
    const wrong = plan.targets.filter((target) => target.destination === "github-releases" && target.settings?.repository !== remote);
    if (!remote) return { ok: false, message: "GitHub Releases needs this project's remote on GitHub, so the release tag can be pushed there." };
    if (wrong.length) return { ok: false, message: `${wrong.map(({ id }) => id).join(", ")} publishes to another repository than this project's remote (${remote}).` };
    return { ok: true, message: `The tag goes to ${remote} with the release.` };
  }
});

const LOCAL_CHECKS = Object.freeze([publishingKeysUnlocked, sideloadKeyReady, githubRepositoryMatches]);
const RELEASE_CHECKS = uniqueChecks(VIBE64_PREFLIGHT_CHECKS, VIBE64_REGISTRY_PREFLIGHT_CHECKS, VIBE64_ANDROID_PREFLIGHT_CHECKS, LOCAL_CHECKS);

// The part of a long tool output that says why: tools such as npm name the
// problem first and then print usage, while others such as Gradle sum up at
// the end, so a long output keeps its start and its end.
function outputExcerpt(output, limit = 1800) {
  if (output.length <= limit) return output;
  const head = output.slice(0, Math.floor(limit / 3)).replace(/\n[^\n]*$/u, "");
  const rest = output.slice(-(limit - head.length - 3));
  return `${head}\n…\n${rest.replace(/^[^\n]*\n/u, "")}`;
}

// A failure's log lines: the message, then the tool's own output (builds run
// without credentials; upload output is already redacted) so the person can
// see why, with the home folder shortened.
function failureLog(targetId, error, at) {
  const lines = [{ at, level: "error", message: `${targetId ? `${targetId}: ` : ""}${String(error?.message || error).slice(0, 1000)}` }];
  const output = String(error?.details?.output || "").trim();
  if (output) lines.push({ at, level: "error", message: outputExcerpt(output.replaceAll(os.homedir(), "~")) });
  return lines;
}

// The CHANGELOG section of one version, used as release notes.
function changelogSection(text, version) {
  if (!text) return null;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^##\\s+\\[?${version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\]?(?:\\s|$)`, "u").test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s/u.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim() || null;
}

function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version || "");
  if (!match) return "0.1.0";
  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function summarizeRelease(record) {
  if (!record) return null;
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    planId: record.planId,
    planHash: record.planHash,
    savedCommit: record.savedCommit,
    tags: record.tags || [],
    versions: record.versions || {},
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    confirmedBy: record.confirmedBy || null,
    targets: Object.fromEntries(Object.entries(record.targets || {}).map(([id, { localFile: _localFile, ...outcome }]) => [id, outcome])),
    steps: record.steps || [],
    error: record.error || null
  };
}

function createReleaseOrchestrator({
  projectRuntimeRoot,
  resultStore,
  cacheDirectory = "",
  targets,
  history,
  builders,
  confirmations,
  keys,
  toolchains,
  repository,
  verification,
  credentials,
  sourceWriter,
  packaging,
  now = () => new Date().toISOString()
} = {}) {
  if (!path.isAbsolute(resultStore || "")) throw new TypeError("Releases need an absolute result store.");
  const active = new Map(); // record id -> promise
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

  function interruptedOr(record) {
    if (record.status === "running" && !active.has(record.id)) return { ...record, status: "interrupted" };
    return record;
  }

  async function lastOutcomes() {
    const records = (await history.list({ limit: 100 })).map(interruptedOr);
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
    const [targetList, { records, latest }, keyStatus, toolchainStatus, pending, builderMap] = await Promise.all([
      targets.list(),
      lastOutcomes(),
      keys.status(),
      toolchains.status(),
      confirmations.pendingRequest(),
      builders.read()
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
      targets: targetList.map((target) => ({ ...target, latest: latest[target.id] || null })),
      builders: builderMap,
      keys: keyStatus,
      toolchains: toolchainStatus,
      checks,
      pendingConfirmation: pending,
      releases: records.slice(0, 30).map(summarizeRelease),
      activeRelease: [...active.keys()][0] || null
    };
  }

  // What the Release dialog offers before anything is written.
  async function suggestRelease() {
    const baseline = await repository.baseline();
    const release = await savedRelease(baseline);
    if (!release || release.packaging.status !== "ready") return { packages: [], notes: "" };
    const releases = (await history.list({ limit: 50 })).filter((record) => record.kind === "release" && record.status === "succeeded");
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

  // Writes the version bump and changelog into the session as an ordinary
  // change. Nothing is saved, tagged or published.
  async function prepareRelease({ sessionId, versions = {}, notes, user = null }) {
    const baseline = await repository.baseline();
    const release = await savedRelease(baseline);
    if (!release || release.packaging.status !== "ready") throw releaseError("Packaging is not ready on the saved project.", "vibe64_publishing_packaging_missing");
    const entries = Object.entries(versions);
    if (!entries.length) throw releaseError("Choose at least one package version.", "vibe64_publishing_prepare_invalid");
    const prepared = [];
    for (const [packageId, version] of entries) {
      const entry = release.packaging.packages.find((candidate) => candidate.id === packageId);
      if (!entry?.versionFrom) throw releaseError(`${packageId} has no version Vibe64 manages.`, "vibe64_publishing_prepare_invalid");
      if (!SEMVER.test(version || "")) throw releaseError(`${version} is not a version such as 1.5.0.`, "vibe64_publishing_prepare_invalid");
      prepared.push(await sourceWriter.prepareAndWrite({ sessionId, entry, version, notes, user }));
    }
    return {
      sessionId,
      packages: prepared.map(({ package: id, previousVersion, version, files }) => ({ id, previousVersion, version, files: files.map(({ path: file }) => file) })),
      next: "Review the change and Save it. The release uses the saved commit."
    };
  }

  async function nextBuildNumbers(packages) {
    const numbers = {};
    const records = await history.list({ limit: 200 });
    for (const entry of packages.filter((candidate) => candidate.packer === "capacitor")) {
      const used = records.map((record) => record.buildNumbers?.[entry.id]).filter(Number.isInteger);
      numbers[entry.id] = (used.length ? Math.max(...used) : 0) + 1;
    }
    return numbers;
  }

  // The runtime form of a plan target: plan settings and the confirmed account
  // that signs in, plus local tool choices (which twine), which do not change
  // where it publishes.
  async function runtimeTarget(planTarget, { tag = null, notes = null } = {}) {
    const tools = await toolchains.registryTools?.() || {};
    const settings = { ...(planTarget.settings || {}) };
    if (planTarget.destination === "pypi" && tools.twine) settings.twine = tools.twine;
    return { ...planTarget, account: planTarget.account || null, settings, ...(tag ? { tag } : {}), ...(notes ? { notes } : {}) };
  }

  // Builds the current plan for the saved commit and runs preflight on it.
  async function plan({ targetIds = null, acknowledged = [] } = {}) {
    const baseline = await repository.baseline();
    if (!baseline.supported) throw releaseError(baseline.message, "vibe64_publishing_repository_unavailable");
    const release = await savedRelease(baseline);
    if (release.packaging.status !== "ready") throw releaseError("Add a Packaging section and Save it before releasing.", "vibe64_publishing_packaging_missing");
    const all = await targets.list();
    const chosen = targetIds?.length ? all.filter((target) => targetIds.includes(target.id)) : all;
    if (!chosen.length) throw releaseError("Add a target first.", "vibe64_publishing_no_targets");
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
      buildNumbers: await nextBuildNumbers(built),
      targets: chosen.map(({ id, destination, package: packageId, channel, settings, account }) => ({ id, destination, package: packageId, channel, settings, account })),
      toolchain: {
        node: process.versions.node,
        ...(hasAndroid ? { java: String(toolStatus?.java?.version || "missing").replace(/[^0-9A-Za-z.+_-]/gu, "") || "missing", "android-build-tools": packaging.androidTemplate.buildTools } : {})
      },
      templates: hasAndroid ? { [packaging.androidTemplate.id]: packaging.androidTemplate.capacitor } : {}
    });
    const keyStatus = await keys.status();
    const previousRelease = (await history.list({ limit: 50 })).find((record) => record.kind === "release" && record.status === "succeeded") || null;
    const runtimeTargets = await Promise.all(publishPlan.targets.map((target) => runtimeTarget(target)));
    const credentialFacts = keyStatus.unlocked
      ? await credentials.facts({ targets: runtimeTargets, toolchains: androidTools || {} })
      : Object.fromEntries(publishPlan.targets.map((target) => [target.id, { ok: false, message: "Unlock your publishing keys to check sign-ins." }]));
    const android = hasAndroid
      ? await repository.withCheckout(baseline.repositoryRoot, baseline.commit, (root) => packaging.gatherAndroidFacts({
        sourceRoot: root,
        packaging: release.packaging,
        packageIds: built.filter((entry) => entry.packer === "capacitor").map(({ id }) => id),
        toolchains: androidTools || {}
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
      preflight: { ...preflight, acknowledged: accepted, ready: !preflight.blocked && preflight.acknowledgementsNeeded.every((id) => accepted.includes(id)) },
      baseline,
      release,
      targets: chosen,
      androidTools
    };
  }

  // The plan as the confirmation and history show it: no secrets, no local paths.
  function planSummary(current) {
    const { plan: publishPlan } = current;
    return {
      planHash: current.planHash,
      planId: current.planId,
      savedCommit: publishPlan.savedCommit,
      tags: publishPlan.tags,
      packages: publishPlan.packages,
      targets: publishPlan.targets.map((target) => ({ id: target.id, destination: target.destination, package: target.package, channel: target.channel, settings: target.settings, account: target.account || null })),
      toolchain: publishPlan.toolchain,
      templates: publishPlan.templates,
      steps: publishPlan.steps
    };
  }

  async function planForTargets({ targetIds = [], acknowledged = [] } = {}) {
    const current = await plan({ targetIds, acknowledged });
    return { ...planSummary(current), preflight: current.preflight, baseline: { commit: current.baseline.commit, branch: current.baseline.branch, remote: current.baseline.remote } };
  }

  async function requireCurrentPlan({ planHash, targetIds = [], acknowledged = [] }) {
    const current = await plan({ targetIds, acknowledged });
    if (current.planHash !== planHash) {
      throw releaseError("The plan changed since you reviewed it (new saved work, targets or tools). Review the new plan.", "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED", { planHash: current.planHash });
    }
    return current;
  }

  // Stage 1 for every package in the plan, once each, into the result store.
  async function buildAll(current, recordId) {
    const built = {};
    for (const entry of current.plan.packages) {
      await step(recordId, `build:${entry.id}`, "running");
      await history.appendLog(recordId, `Building ${entry.id}${entry.version ? ` ${entry.version}` : ""} without credentials…`);
      const result = await packaging.buildPackage({
        projectRoot: current.baseline.repositoryRoot,
        commit: current.plan.savedCommit,
        packaging: current.release.packaging,
        packageId: entry.id,
        version: entry.version,
        planHash: current.planHash,
        resultStore,
        cacheDirectory,
        versionCode: entry.buildNumber ?? null,
        toolchains: current.androidTools || {}
      });
      built[entry.id] = result.artifacts;
      await history.update(recordId, (record) => {
        record.packages = { ...(record.packages || {}), [entry.id]: { files: result.artifacts.manifest.files, digest: result.artifacts.digest, reused: Boolean(result.artifacts.reused) } };
        return record;
      });
      await step(recordId, `build:${entry.id}`, "done", `${result.artifacts.manifest.files.length} file${result.artifacts.manifest.files.length === 1 ? "" : "s"}${result.artifacts.reused ? " (already built)" : ""}`);
    }
    return built;
  }

  function step(recordId, id, status, message = "") {
    return history.update(recordId, (record) => {
      const steps = record.steps || [];
      const existing = steps.find((entry) => entry.id === id);
      const at = now();
      if (existing) Object.assign(existing, { status, message, ...(status === "running" ? { startedAt: at } : { finishedAt: at }) });
      else steps.push({ id, status, message, ...(status === "running" ? { startedAt: at } : { finishedAt: at }) });
      record.steps = steps;
      return record;
    });
  }

  function stepsFor(publishPlan, kind) {
    // Build first: a build that fails leaves no tag behind to block the next try.
    return [
      ...publishPlan.packages.map((entry) => ({ id: `build:${entry.id}`, status: "pending", message: "" })),
      ...(kind === "release" ? publishPlan.tags.map((tag) => ({ id: `tag:${tag}`, status: "pending", message: "" })) : []),
      ...publishPlan.targets.map((target) => ({ id: `${kind === "release" ? "publish" : "dry-run"}:${target.id}`, status: "pending", message: "" }))
    ];
  }

  function background(recordId, work) {
    const promise = (async () => {
      try {
        await work();
      } catch (error) {
        await history.update(recordId, (record) => {
          record.status = "failed";
          record.finishedAt = now();
          record.error = { code: error?.code || "vibe64_publishing_failed", message: String(error?.message || error).slice(0, 2000) };
          for (const entry of record.steps || []) if (entry.status === "running") entry.status = "failed";
          record.log.push(...failureLog("", error, now()));
          return record;
        }).catch(() => {});
      } finally {
        active.delete(recordId);
      }
    })();
    active.set(recordId, promise);
    return promise;
  }

  function versionOf(current, packageId) {
    return current.plan.packages.find((entry) => entry.id === packageId)?.version || null;
  }

  function tagFor(current, packageId) {
    return current.plan.packages.find((entry) => entry.id === packageId)?.tag || current.plan.tags[0] || null;
  }

  async function notesFor(current, packageId) {
    const entry = current.release.packaging.packages.find((candidate) => candidate.id === packageId);
    const version = versionOf(current, packageId);
    if (!entry || !version) return null;
    const changelog = await repository.fileAtCommit(current.baseline.repositoryRoot, current.plan.savedCommit, path.posix.join(entry.workdir || ".", "CHANGELOG.md").replace(/^\.\//u, ""));
    return changelogSection(changelog, version);
  }

  // Dry run: build once, then ask each destination what would happen. Nothing
  // is tagged, signed for distribution or uploaded.
  async function dryRun({ planHash, targetIds = [], acknowledged = [] }) {
    const current = await requireCurrentPlan({ planHash, targetIds, acknowledged });
    if (current.preflight.blocked) {
      throw releaseError("Preflight found a problem that stops this release. Fix it first.", "VIBE64_PUBLISH_PREFLIGHT_BLOCKED");
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
      steps: stepsFor(current.plan, "dry-run"),
      targets: {}
    });
    background(record.id, async () => {
      const built = await buildAll(current, record.id);
      let failures = 0;
      for (const planTarget of current.plan.targets) {
        await step(record.id, `dry-run:${planTarget.id}`, "running");
        try {
          const target = await runtimeTarget(planTarget, { tag: tagFor(current, planTarget.package), notes: await notesFor(current, planTarget.package) });
          const report = await credentials.dryRun({ target, version: versionOf(current, planTarget.package), artifacts: built[planTarget.package], toolchains: current.androidTools || {} });
          await history.update(record.id, (entry) => {
            entry.targets[planTarget.id] = { status: "checked", report: credentials.safeReport(report) };
            return entry;
          });
          await step(record.id, `dry-run:${planTarget.id}`, "done", report?.alreadyPublished ? "Already published with these bytes." : "Would publish.");
        } catch (error) {
          failures += 1;
          await history.update(record.id, (entry) => {
            entry.targets[planTarget.id] = { status: "failed", error: { code: error?.code || "", message: String(error?.message || error).slice(0, 1000) } };
            entry.log.push(...failureLog(planTarget.id, error, now()));
            return entry;
          });
          await step(record.id, `dry-run:${planTarget.id}`, "failed", String(error?.message || error).slice(0, 300));
        }
      }
      await history.update(record.id, (entry) => {
        entry.status = failures ? "failed" : "succeeded";
        entry.finishedAt = now();
        return entry;
      });
    });
    return { releaseId: record.id, kind: "dry-run" };
  }

  // An assistant (or the page) asks for the confirmation prompt for this plan.
  async function requestPublish({ planHash, targetIds = [], requestedBy = "assistant" }) {
    const current = await requireCurrentPlan({ planHash, targetIds });
    const request = await confirmations.request({ planHash: current.planHash, requestedBy });
    return { pendingConfirmation: request, planId: current.planId, message: "The person confirms this plan on the Publish page. Nothing is published until they do." };
  }

  // The person opens the confirmation on the Publish page.
  async function openConfirmation({ planHash, targetIds = [], acknowledged = [], actor }) {
    if (actor?.kind !== "person") {
      throw releaseError("Only the person can open a publish confirmation, on the Publish page.", "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON");
    }
    const current = await requireCurrentPlan({ planHash, targetIds, acknowledged });
    assertPreflightAllowsRelease(current.preflight, acknowledged);
    const { token, expiresAt } = await confirmations.open({ planHash: current.planHash, actor });
    return { token, expiresAt, plan: planSummary(current) };
  }

  // The person confirmed: redeem, then release in the background.
  async function confirmRelease({ planHash, token, targetIds = [], acknowledged = [], actor }) {
    const current = await requireCurrentPlan({ planHash, targetIds, acknowledged });
    assertPreflightAllowsRelease(current.preflight, acknowledged);
    const redeemed = await confirmations.redeem({ planHash: current.planHash, token, actor });
    const unfinished = (await history.list({ limit: 50 })).map(interruptedOr)
      .find((record) => record.kind === "release" && record.planHash === current.planHash && ["failed", "partial", "interrupted"].includes(record.status));
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
        buildNumbers: Object.fromEntries(current.plan.packages.filter((entry) => entry.buildNumber).map((entry) => [entry.id, entry.buildNumber])),
        toolchain: current.plan.toolchain,
        templates: current.plan.templates,
        builders: await builders.read(),
        confirmedBy: redeemed.actorId,
        confirmedAt: redeemed.usedAt,
        acknowledged: current.preflight.acknowledged,
        steps: stepsFor(current.plan, "release"),
        targets: {}
      });
    background(record.id, () => runRelease(current, record.id));
    return { releaseId: record.id, kind: "release", resumed: Boolean(unfinished) };
  }

  async function runRelease(current, recordId) {
    const facts = { ...current.baseline, projectRuntimeRoot };
    const built = await buildAll(current, recordId);
    if (current.plan.tags.length) {
      for (const tag of current.plan.tags) await step(recordId, `tag:${tag}`, "running");
      const tagged = await repository.createTags(facts, { commit: current.plan.savedCommit, tags: current.plan.tags });
      await history.appendLog(recordId, `Tagged ${current.plan.savedCommit.slice(0, 7)}: ${[...tagged.created, ...tagged.existing].join(", ")}.`);
      const pushed = await repository.pushTags(facts, current.plan.tags);
      if (pushed.pushed.length) await history.appendLog(recordId, `Pushed ${pushed.pushed.join(", ")} to ${facts.remote.name}.`);
      for (const tag of current.plan.tags) await step(recordId, `tag:${tag}`, "done", pushed.pushed.includes(tag) ? `Pushed to ${facts.remote.name}` : "In the project");
    }
    const record = await history.read(recordId);
    let proven = 0;
    for (const planTarget of current.plan.targets) {
      const stepId = `publish:${planTarget.id}`;
      const previous = record.targets?.[planTarget.id] || null;
      await step(recordId, stepId, "running");
      try {
        const target = await runtimeTarget(planTarget, { tag: tagFor(current, planTarget.package), notes: await notesFor(current, planTarget.package) });
        const outcome = await credentials.publish({
          target,
          version: versionOf(current, planTarget.package) || current.plan.savedCommit.slice(0, 12),
          artifacts: built[planTarget.package],
          previous,
          toolchains: current.androidTools || {}
        });
        proven += 1;
        await history.update(recordId, (entry) => {
          entry.targets[planTarget.id] = { ...credentials.safeOutcome(outcome), destination: planTarget.destination, package: planTarget.package };
          return entry;
        });
        await step(recordId, stepId, "done", outcome.alreadyPublished ? "Already published with these bytes" : "Published and read back");
        await history.appendLog(recordId, `${planTarget.id}: ${outcome.alreadyPublished ? "already published" : "published"} and read back.`);
      } catch (error) {
        await history.update(recordId, (entry) => {
          entry.targets[planTarget.id] = {
            status: "failed",
            destination: planTarget.destination,
            package: planTarget.package,
            version: versionOf(current, planTarget.package),
            error: { code: error?.code || "", message: String(error?.message || error).slice(0, 1000) }
          };
          entry.log.push(...failureLog(planTarget.id, error, now()));
          return entry;
        });
        await step(recordId, stepId, "failed", String(error?.message || error).slice(0, 300));
      }
    }
    await history.update(recordId, (entry) => {
      entry.status = proven === current.plan.targets.length ? "succeeded" : proven ? "partial" : "failed";
      entry.finishedAt = now();
      return entry;
    });
  }

  async function readRelease(id) {
    return summarizeRelease(interruptedOr(await history.read(id)));
  }

  async function readLogs(id) {
    const record = await history.read(id);
    return { id: record.id, status: interruptedOr(record).status, log: record.log || [] };
  }

  async function listHistory({ limit = 30 } = {}) {
    return (await history.list({ limit })).map(interruptedOr).map(summarizeRelease);
  }

  // Waits for a background run (tests and the CLI-like callers).
  function settle(id) {
    return active.get(id) || Promise.resolve();
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
    settle,
    suggestRelease
  });
}

export { changelogSection, createReleaseOrchestrator, outputExcerpt };
