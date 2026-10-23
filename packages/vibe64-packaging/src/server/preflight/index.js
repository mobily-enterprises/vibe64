// Preflight checks are pure functions over facts the caller gathered (Git state,
// the Packaging inspection, the plan, release history). Each check has one
// severity: a failed Block stops the release, a failed Warn is shown, and a failed
// Ack must be acknowledged by the person before the release can run.
import { VIBE64_PACKAGING_CONTRACT } from "@local/vibe64-genesis/server/packaging";

import { publishError } from "../errors.js";

const PREFLIGHT_SEVERITIES = Object.freeze(["block", "warn", "ack"]);

function definePreflightCheck({ id, label, severity, applies = () => true, run } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id || "") || !label || !PREFLIGHT_SEVERITIES.includes(severity) || typeof run !== "function") {
    throw new TypeError("A preflight check needs an id, a label, a severity of block, warn or ack, and run().");
  }
  return Object.freeze({ id, label, severity, applies, run });
}

function outcome(check, value) {
  const ok = value === true || value?.ok === true;
  return {
    id: check.id,
    label: check.label,
    severity: check.severity,
    ok,
    message: typeof value?.message === "string" ? value.message : ok ? "" : `${check.label} failed.`
  };
}

function runPreflight(checks, context = {}) {
  const ids = new Set();
  const results = [];
  for (const check of checks) {
    if (ids.has(check.id)) throw new TypeError(`Preflight check ${check.id} appears twice.`);
    ids.add(check.id);
    if (!check.applies(context)) continue;
    try {
      results.push(outcome(check, check.run(context)));
    } catch (error) {
      results.push({ ...outcome(check, false), message: error?.message || `${check.label} could not run.` });
    }
  }
  const failed = (severity) => results.filter((result) => !result.ok && result.severity === severity);
  return {
    checks: results,
    blocked: failed("block").length > 0,
    warnings: failed("warn").map(({ id }) => id),
    acknowledgementsNeeded: failed("ack").map(({ id }) => id)
  };
}

function preflightAllowsRelease(result, acknowledged = []) {
  const accepted = new Set(acknowledged);
  return !result.blocked && result.acknowledgementsNeeded.every((id) => accepted.has(id));
}

function assertPreflightAllowsRelease(result, acknowledged = []) {
  if (result.blocked) {
    throw publishError("VIBE64_PUBLISH_PREFLIGHT_BLOCKED", "Preflight found a problem that stops this release.", {
      checks: result.checks.filter((check) => !check.ok && check.severity === "block").map(({ id }) => id)
    });
  }
  if (!preflightAllowsRelease(result, acknowledged)) {
    throw publishError("VIBE64_PUBLISH_PREFLIGHT_UNACKNOWLEDGED", "Some preflight notices need the person's acknowledgement.", {
      checks: result.acknowledgementsNeeded.filter((id) => !acknowledged.includes(id))
    });
  }
}

const baselineSavedAndPushed = definePreflightCheck({
  id: "baseline-saved-pushed",
  label: "Saved and pushed baseline",
  severity: "block",
  run: ({ baseline = {}, plan = {} }) => {
    if (!baseline.saved) return { ok: false, message: "Save your changes before releasing." };
    if (!baseline.pushed) return { ok: false, message: "Push the saved baseline before releasing." };
    if (baseline.commit !== plan.savedCommit) return { ok: false, message: "The plan does not use the saved baseline. Review the plan again." };
    return { ok: true, message: `Releasing saved commit ${baseline.commit.slice(0, 7)}.` };
  }
});

const packagingReady = definePreflightCheck({
  id: "packaging-ready",
  label: "Packaging section",
  severity: "block",
  run: ({ packaging = {}, plan = {} }) => {
    if (packaging.contract !== VIBE64_PACKAGING_CONTRACT || packaging.status !== "ready") {
      return { ok: false, message: "Packaging is missing or has errors." };
    }
    if (plan.packagingHash !== packaging.packagingHash) return { ok: false, message: "Packaging changed after the plan was made." };
    return { ok: true, message: `${packaging.packages.length} package${packaging.packages.length === 1 ? "" : "s"} declared.` };
  }
});

const toolchainUnchanged = definePreflightCheck({
  id: "toolchain-unchanged",
  label: "Tools since the last release",
  severity: "ack",
  applies: ({ previousRelease }) => Boolean(previousRelease?.toolchain),
  run: ({ plan = {}, previousRelease }) => {
    const changes = Object.entries(plan.toolchain || {})
      .filter(([name, version]) => previousRelease.toolchain[name] && previousRelease.toolchain[name] !== version)
      .map(([name, version]) => `${name} ${previousRelease.toolchain[name]} → ${version}`);
    return changes.length ? { ok: false, message: `Changed since the last release: ${changes.join(", ")}.` } : { ok: true };
  }
});

const VIBE64_PREFLIGHT_CHECKS = Object.freeze([baselineSavedAndPushed, packagingReady, toolchainUnchanged]);

export {
  PREFLIGHT_SEVERITIES,
  VIBE64_PREFLIGHT_CHECKS,
  assertPreflightAllowsRelease,
  definePreflightCheck,
  preflightAllowsRelease,
  runPreflight
};
