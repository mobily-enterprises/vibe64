import path from "node:path";

import { changelogSection, failureLog } from "./releaseRecords.js";

/** @typedef {import("./types.js").ReleaseHistoryStore} ReleaseHistoryStore */
/** @typedef {import("./types.js").PublishingToolchains} PublishingToolchains */
/** @typedef {import("./types.js").ProjectRepository} ProjectRepository */
/** @typedef {import("./types.js").CredentialBroker} CredentialBroker */
/** @typedef {import("./types.js").PublishingPackaging} PublishingPackaging */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Release and dry-run records as they run in the background. Each run builds every package of the plan once, into the
 * result store. A dry run then asks each destination what would happen; a release tags the saved commit, publishes
 * every target and reads it back. Every step, outcome and failure is recorded in the release history.
 * @param {object} dependencies
 * @param {string} dependencies.projectRuntimeRoot
 * @param {string} dependencies.resultStore
 * @param {string} dependencies.cacheDirectory
 * @param {ReleaseHistoryStore} dependencies.history
 * @param {PublishingToolchains} dependencies.toolchains
 * @param {ProjectRepository} dependencies.repository
 * @param {CredentialBroker} dependencies.credentials
 * @param {PublishingPackaging} dependencies.packaging
 * @param {RuntimeLogger} dependencies.logger
 * @param {() => string} dependencies.now
 */
function createReleaseRuns({
  projectRuntimeRoot,
  resultStore,
  cacheDirectory,
  history,
  toolchains,
  repository,
  credentials,
  packaging,
  logger,
  now
}) {
  const active = new Map(); // record id -> promise

  /**
   * A record as the page shows it: a running record whose run is not active in this Vibe64 was interrupted.
   */
  function interruptedOr(record) {
    if (record.status === "running" && !active.has(record.id)) return { ...record, status: "interrupted" };
    return record;
  }

  /**
   * The runtime form of a plan target: plan settings and the confirmed account
   * that signs in, plus local tool choices (which twine), which do not change
   * where it publishes.
   */
  async function runtimeTarget(planTarget, options = {}) {
    const { tag = null, notes = null } = options;
    const tools = await toolchains.registryTools();
    const settings = { ...(planTarget.settings || {}) };
    if (planTarget.destination === "pypi" && tools.twine) settings.twine = tools.twine;
    return { ...planTarget, account: planTarget.account || null, settings, ...(tag ? { tag } : {}), ...(notes ? { notes } : {}) };
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
        }).catch(recordError => logger.warn({ error: recordError, recordId }, "A failed release run did not record its failure."));
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
    const changelog = await repository.fileAtCommit(
      current.baseline.repositoryRoot,
      current.plan.savedCommit,
      path.posix.join(entry.workdir || ".", "CHANGELOG.md").replace(/^\.\//u, "")
    );
    return changelogSection(changelog, version);
  }

  /**
   * Stage 1 for every package in the plan, once each, into the result store.
   */
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
        record.packages = {
          ...(record.packages || {}),
          [entry.id]: { files: result.artifacts.manifest.files, digest: result.artifacts.digest, reused: Boolean(result.artifacts.reused) }
        };
        return record;
      });
      await step(
        recordId,
        `build:${entry.id}`,
        "done",
        `${result.artifacts.manifest.files.length} file${result.artifacts.manifest.files.length === 1 ? "" : "s"}${result.artifacts.reused ? " (already built)" : ""}`
      );
    }
    return built;
  }

  /**
   * The dry run's work: build once, then ask each destination what would happen.
   */
  async function checkTargets(current, recordId) {
    const built = await buildAll(current, recordId);
    let failures = 0;
    for (const planTarget of current.plan.targets) {
      await step(recordId, `dry-run:${planTarget.id}`, "running");
      try {
        const target = await runtimeTarget(planTarget, {
          tag: tagFor(current, planTarget.package),
          notes: await notesFor(current, planTarget.package)
        });
        const report = await credentials.dryRun({
          target,
          version: versionOf(current, planTarget.package),
          artifacts: built[planTarget.package],
          toolchains: current.androidTools || {}
        });
        await history.update(recordId, (entry) => {
          entry.targets[planTarget.id] = { status: "checked", report: credentials.safeReport(report) };
          return entry;
        });
        await step(
          recordId,
          `dry-run:${planTarget.id}`,
          "done",
          report?.alreadyPublished ? "Already published with these bytes." : "Would publish."
        );
      } catch (error) {
        failures += 1;
        await history.update(recordId, (entry) => {
          entry.targets[planTarget.id] = {
            status: "failed",
            error: { code: error?.code || "", message: String(error?.message || error).slice(0, 1000) }
          };
          entry.log.push(...failureLog(planTarget.id, error, now()));
          return entry;
        });
        await step(recordId, `dry-run:${planTarget.id}`, "failed", String(error?.message || error).slice(0, 300));
      }
    }
    await history.update(recordId, (entry) => {
      entry.status = failures ? "failed" : "succeeded";
      entry.finishedAt = now();
      return entry;
    });
  }

  /**
   * The release's work: build once, tag the saved commit, then publish every target and read it back.
   */
  async function publishTargets(current, recordId) {
    const facts = { ...current.baseline, projectRuntimeRoot };
    const built = await buildAll(current, recordId);
    if (current.plan.tags.length) {
      for (const tag of current.plan.tags) await step(recordId, `tag:${tag}`, "running");
      const tagged = await repository.createTags(facts, { commit: current.plan.savedCommit, tags: current.plan.tags });
      await history.appendLog(
        recordId,
        `Tagged ${current.plan.savedCommit.slice(0, 7)}: ${[...tagged.created, ...tagged.existing].join(", ")}.`
      );
      const pushed = await repository.pushTags(facts, current.plan.tags);
      if (pushed.pushed.length) await history.appendLog(recordId, `Pushed ${pushed.pushed.join(", ")} to ${facts.remote.name}.`);
      for (const tag of current.plan.tags) await step(
        recordId,
        `tag:${tag}`,
        "done",
        pushed.pushed.includes(tag) ? `Pushed to ${facts.remote.name}` : "In the project"
      );
    }
    const record = await history.read(recordId);
    let proven = 0;
    for (const planTarget of current.plan.targets) {
      const stepId = `publish:${planTarget.id}`;
      const previous = record.targets?.[planTarget.id] || null;
      await step(recordId, stepId, "running");
      try {
        const target = await runtimeTarget(planTarget, {
          tag: tagFor(current, planTarget.package),
          notes: await notesFor(current, planTarget.package)
        });
        const outcome = await credentials.publish({
          target,
          version: versionOf(current, planTarget.package) || current.plan.savedCommit.slice(0, 12),
          artifacts: built[planTarget.package],
          previous,
          toolchains: current.androidTools || {}
        });
        proven += 1;
        await history.update(recordId, (entry) => {
          entry.targets[planTarget.id] = {
            ...credentials.safeOutcome(outcome),
            destination: planTarget.destination,
            package: planTarget.package
          };
          return entry;
        });
        await step(recordId, stepId, "done", outcome.alreadyPublished ? "Already published with these bytes" : "Published and read back");
        await history.appendLog(
          recordId,
          `${planTarget.id}: ${outcome.alreadyPublished ? "already published" : "published"} and read back.`
        );
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

  /**
   * Starts a dry run of the current plan for its record, in the background.
   */
  function startDryRun(current, recordId) {
    return background(recordId, () => checkTargets(current, recordId));
  }

  /**
   * Starts (or resumes) a release of the current plan for its record, in the background.
   */
  function startRelease(current, recordId) {
    return background(recordId, () => publishTargets(current, recordId));
  }

  /**
   * The record id of the run in progress, if any.
   */
  function activeReleaseId() {
    return [...active.keys()][0] || null;
  }

  /**
   * Waits for a record's background run to finish.
   */
  function settle(id) {
    return active.get(id) || Promise.resolve();
  }

  return Object.freeze({
    activeReleaseId,
    interruptedOr,
    runtimeTarget,
    settle,
    startDryRun,
    startRelease
  });
}

export { createReleaseRuns };
