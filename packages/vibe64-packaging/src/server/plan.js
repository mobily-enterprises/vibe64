// A publish plan is the exact, previewable description of one release: the saved
// commit, the Packaging facts, the tags, every package built once, every target it
// fans out to, and the tool and template versions. Its hash is what the person
// confirms; any change to those inputs produces a different hash.
import { VIBE64_PACKAGING_CONTRACT } from "@local/vibe64-genesis/server/packaging";

import { canonicalJson, sha256 } from "./canonical.js";
import { vibe64Destination } from "./destinations/index.js";
import { publishError } from "./errors.js";
import { COMMIT_ID } from "./git.js";
import { isReleaseVersion, isSemver } from "./release/version.js";

const VIBE64_PUBLISH_PLAN_CONTRACT = "vibe64.publish-plan.v1";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ACCOUNT = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const TOOL_NAME = /^[@a-z0-9][a-z0-9@/._-]*$/u;
const VERSION_TEXT = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

function invalid(code, message, details) {
  throw publishError(code, message, details);
}

function oneLine(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/u.test(value)) {
    invalid("VIBE64_PUBLISH_PLAN_LINE_INVALID", `${label} must be one non-empty line.`);
  }
  return value.trim();
}

function versionMap(values, label) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    invalid("VIBE64_PUBLISH_PLAN_VERSIONS_INVALID", `${label} must be an object of exact versions.`);
  }
  return Object.fromEntries(Object.entries(values).map(([name, version]) => {
    if (!TOOL_NAME.test(name)) invalid("VIBE64_PUBLISH_PLAN_TOOL_NAME_INVALID", `${label} has an invalid name: ${name}.`);
    if (typeof version !== "string" || !VERSION_TEXT.test(version)) {
      invalid("VIBE64_PUBLISH_PLAN_TOOL_VERSION_INVALID", `${label} ${name} needs an exact version.`);
    }
    return [name, version];
  }));
}

/**
 * `v1.5.0` for a project with one versioned package; `<package>@1.5.0` when
 * several packages version independently.
 */
function releaseTagName({ packageId, version, independent }) {
  if (!isSemver(version)) invalid("VIBE64_PUBLISH_PLAN_VERSION_INVALID", `Version ${version} is not a semantic version such as 1.5.0.`);
  if (!isReleaseVersion(version)) {
    invalid(
      "VIBE64_PUBLISH_PLAN_VERSION_METADATA",
      `Version ${version} has build metadata (+…), which a release tag such as v1.5.0 cannot hold. Choose a version without it.`
    );
  }
  return independent ? `${packageId}@${version}` : `v${version}`;
}

function packagingPackages(packaging) {
  if (packaging?.contract !== VIBE64_PACKAGING_CONTRACT || packaging.status !== "ready") {
    invalid("VIBE64_PUBLISH_PLAN_PACKAGING_NOT_READY", "A publish plan needs a ready Packaging inspection.");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(packaging.packagingHash || "")) {
    invalid("VIBE64_PUBLISH_PLAN_PACKAGING_HASH_ABSENT", "The Packaging inspection has no packaging hash.");
  }
  return new Map(packaging.packages.map((entry) => [entry.id, entry]));
}

function normalizeTargets(targets, packages) {
  if (!Array.isArray(targets) || targets.length === 0) {
    invalid("VIBE64_PUBLISH_PLAN_TARGETS_REQUIRED", "A publish plan needs at least one target.");
  }
  const seen = new Set();
  return targets.map((target) => {
    const id = oneLine(target?.id, "Target id");
    if (!ID.test(id)) {
      invalid("VIBE64_PUBLISH_PLAN_TARGET_ID_INVALID", `Target id ${id} must use lowercase letters, digits and single hyphens.`);
    }
    if (seen.has(id)) invalid("VIBE64_PUBLISH_PLAN_TARGET_DUPLICATE", `Target ${id} appears twice.`);
    seen.add(id);
    const entry = packages.get(target.package);
    if (!entry) {
      invalid(
        "VIBE64_PUBLISH_PLAN_TARGET_PACKAGE_UNKNOWN",
        `Target ${id} names package ${target.package}, which Packaging does not declare.`
      );
    }
    const destination = vibe64Destination(target.destination);
    if (!destination.packers.includes(entry.packer)) {
      invalid(
        "VIBE64_PUBLISH_PLAN_TARGET_PACKER_UNSUPPORTED",
        `Target ${id}: ${destination.label} cannot publish a ${entry.packer} package.`
      );
    }
    const channel = target.channel === undefined || target.channel === null || target.channel === ""
      ? null
      : oneLine(target.channel, `Target ${id} channel`);
    if (channel && !destination.channels.some((known) => channel === known || channel.startsWith(`${known}:`))) {
      invalid("VIBE64_PUBLISH_PLAN_TARGET_CHANNEL_UNKNOWN", `Target ${id}: ${destination.label} has no channel ${channel}.`);
    }
    const normalized = { id, destination: destination.id, package: entry.id, channel };
    // Where the target publishes (registry, repository) is part of what the person confirms.
    if (target.settings !== undefined && target.settings !== null) normalized.settings = targetSettings(target.settings, id);
    // The account that signs in is confirmed too: changing it changes the plan.
    if (target.account !== undefined && target.account !== null && target.account !== "") {
      const account = oneLine(target.account, `Target ${id} account`);
      if (!ACCOUNT.test(account)) {
        invalid(
          "VIBE64_PUBLISH_PLAN_TARGET_ACCOUNT_INVALID",
          `Target ${id} account ${account} must use lowercase letters, digits and hyphens.`
        );
      }
      normalized.account = account;
    }
    return normalized;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function targetSettings(settings, id) {
  if (typeof settings !== "object" || Array.isArray(settings)) {
    invalid("VIBE64_PUBLISH_PLAN_TARGET_SETTINGS_INVALID", `Target ${id} settings must be an object.`);
  }
  const plain = (value) => typeof value === "string" || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
  for (const [name, value] of Object.entries(settings)) {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name) || !plain(value)) {
      invalid("VIBE64_PUBLISH_PLAN_TARGET_SETTING_INVALID", `Target ${id} setting ${name} must be text, true/false or a list of text.`);
    }
  }
  return Object.fromEntries(Object.entries(settings).sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Content packages build before the app packages that consume them; each builds once.
 */
function buildOrder(targets, packages) {
  const order = [];
  const visit = (id) => {
    if (order.includes(id)) return;
    const entry = packages.get(id);
    if (entry.content) visit(entry.content);
    order.push(id);
  };
  for (const target of targets) visit(target.package);
  return order;
}

/**
 * App builds carry a build number (Android versionCode) that only ever grows; it
 * is never in source, so the caller supplies it (its last one + 1).
 */
function appBuildNumber(value, id) {
  if (!Number.isInteger(value) || value < 1 || value > 2_100_000_000) {
    invalid(
      "VIBE64_PUBLISH_PLAN_BUILD_NUMBER_REQUIRED",
      `App package ${id} needs its build number, a whole number from 1 to 2,100,000,000.`
    );
  }
  return value;
}

function createPublishPlan({
  savedCommit,
  packaging,
  versions = {},
  buildNumbers = {},
  targets,
  toolchain = {},
  templates = {}
} = {}) {
  if (!COMMIT_ID.test(savedCommit || "")) invalid("VIBE64_PUBLISH_PLAN_COMMIT_INVALID", "A publish plan needs the full saved commit id.");
  const packages = packagingPackages(packaging);
  const normalizedTargets = normalizeTargets(targets, packages);
  const versionedCount = [...packages.values()].filter((entry) => entry.versionFrom).length;
  const built = buildOrder(normalizedTargets, packages).map((id) => {
    const entry = packages.get(id);
    if (!entry.versionFrom) return { id, packer: entry.packer, version: null, tag: null };
    const version = versions[id];
    if (!isSemver(version)) {
      invalid("VIBE64_PUBLISH_PLAN_PACKAGE_VERSION_REQUIRED", `Package ${id} needs its release version, such as 1.5.0.`);
    }
    return {
      id,
      packer: entry.packer,
      version,
      tag: releaseTagName({ packageId: id, version, independent: versionedCount > 1 }),
      ...(entry.packer === "capacitor" ? { buildNumber: appBuildNumber(buildNumbers[id], id) } : {})
    };
  });
  for (const id of Object.keys(buildNumbers)) {
    if (!built.some((entry) => entry.id === id && entry.buildNumber)) {
      invalid("VIBE64_PUBLISH_PLAN_BUILD_NUMBER_UNUSED", `Build number given for ${id}, which this release does not build as an app.`);
    }
  }
  for (const id of Object.keys(versions)) {
    if (!built.some((entry) => entry.id === id && entry.version)) {
      invalid("VIBE64_PUBLISH_PLAN_VERSION_UNUSED", `Version given for ${id}, which this release does not publish.`);
    }
  }
  const tags = [...new Set(built.map(({ tag }) => tag).filter(Boolean))].sort();
  const plan = {
    contract: VIBE64_PUBLISH_PLAN_CONTRACT,
    savedCommit,
    packagingHash: packaging.packagingHash,
    tags,
    packages: built,
    targets: normalizedTargets,
    toolchain: versionMap(toolchain, "Toolchain"),
    templates: versionMap(templates, "Templates"),
    // The order a release runs in. Builds come first, so a build that fails
    // leaves no tag behind; each publish step reads its target back.
    steps: [
      ...built.map(({ id }) => ({ kind: "build", package: id })),
      ...tags.map((tag) => ({ kind: "tag", tag })),
      ...normalizedTargets.map(({ id }) => ({ kind: "publish", target: id }))
    ]
  };
  return { plan, planHash: publishPlanHash(plan) };
}

function publishPlanHash(plan) {
  if (plan?.contract !== VIBE64_PUBLISH_PLAN_CONTRACT) {
    invalid("VIBE64_PUBLISH_PLAN_CONTRACT_INVALID", "Only a Vibe64 publish plan can be hashed.");
  }
  return sha256(canonicalJson(plan));
}

/**
 * The short form people see next to the plan, such as "plan #c41d".
 */
function publishPlanDisplayId(planHash) {
  const match = /^sha256:([0-9a-f]{4})[0-9a-f]{60}$/u.exec(planHash || "");
  if (!match) invalid("VIBE64_PUBLISH_PLAN_HASH_INVALID", "Not a publish plan hash.");
  return match[1];
}

export {
  VIBE64_PUBLISH_PLAN_CONTRACT,
  createPublishPlan,
  publishPlanDisplayId,
  publishPlanHash,
  releaseTagName
};
