// A publish plan is the exact, previewable description of one release: the saved
// commit, the Packaging facts, the tags, every package built once, every target it
// fans out to, and the tool and template versions. Its hash is what the person
// confirms; any change to those inputs produces a different hash.
import { VIBE64_PACKAGING_CONTRACT } from "@local/vibe64-genesis/server/packaging";

import { canonicalJson, sha256 } from "./canonical.js";
import { vibe64Destination } from "./destinations/index.js";
import { publishError } from "./errors.js";

const VIBE64_PUBLISH_PLAN_CONTRACT = "vibe64.publish-plan.v1";
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const TOOL_NAME = /^[@a-z0-9][a-z0-9@/._-]*$/u;
const VERSION_TEXT = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

function invalid(message, details) {
  throw publishError("VIBE64_PUBLISH_PLAN_INVALID", message, details);
}

function oneLine(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/u.test(value)) invalid(`${label} must be one non-empty line.`);
  return value.trim();
}

function versionMap(values, label) {
  if (!values || typeof values !== "object" || Array.isArray(values)) invalid(`${label} must be an object of exact versions.`);
  return Object.fromEntries(Object.entries(values).map(([name, version]) => {
    if (!TOOL_NAME.test(name)) invalid(`${label} has an invalid name: ${name}.`);
    if (typeof version !== "string" || !VERSION_TEXT.test(version)) invalid(`${label} ${name} needs an exact version.`);
    return [name, version];
  }));
}

// `v1.5.0` for a project with one versioned package; `<package>@1.5.0` when
// several packages version independently.
function releaseTagName({ packageId, version, independent }) {
  if (!SEMVER.test(version || "")) invalid(`Version ${version} is not a semantic version such as 1.5.0.`);
  return independent ? `${packageId}@${version}` : `v${version}`;
}

function packagingPackages(packaging) {
  if (packaging?.contract !== VIBE64_PACKAGING_CONTRACT || packaging.status !== "ready") {
    invalid("A publish plan needs a ready Packaging inspection.");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(packaging.packagingHash || "")) invalid("The Packaging inspection has no packaging hash.");
  return new Map(packaging.packages.map((entry) => [entry.id, entry]));
}

function normalizeTargets(targets, packages) {
  if (!Array.isArray(targets) || targets.length === 0) invalid("A publish plan needs at least one target.");
  const seen = new Set();
  return targets.map((target) => {
    const id = oneLine(target?.id, "Target id");
    if (!ID.test(id)) invalid(`Target id ${id} must use lowercase letters, digits and single hyphens.`);
    if (seen.has(id)) invalid(`Target ${id} appears twice.`);
    seen.add(id);
    const entry = packages.get(target.package);
    if (!entry) invalid(`Target ${id} names package ${target.package}, which Packaging does not declare.`);
    const destination = vibe64Destination(target.destination);
    if (!destination.packers.includes(entry.packer)) {
      invalid(`Target ${id}: ${destination.label} cannot publish a ${entry.packer} package.`);
    }
    const channel = target.channel === undefined || target.channel === null || target.channel === "" ? null : oneLine(target.channel, `Target ${id} channel`);
    if (channel && !destination.channels.some((known) => channel === known || channel.startsWith(`${known}:`))) {
      invalid(`Target ${id}: ${destination.label} has no channel ${channel}.`);
    }
    const normalized = { id, destination: destination.id, package: entry.id, channel };
    // Where the target publishes (registry, repository) is part of what the person confirms.
    if (target.settings !== undefined && target.settings !== null) normalized.settings = targetSettings(target.settings, id);
    return normalized;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function targetSettings(settings, id) {
  if (typeof settings !== "object" || Array.isArray(settings)) invalid(`Target ${id} settings must be an object.`);
  const plain = (value) => typeof value === "string" || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
  for (const [name, value] of Object.entries(settings)) {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name) || !plain(value)) invalid(`Target ${id} setting ${name} must be text, true/false or a list of text.`);
  }
  return Object.fromEntries(Object.entries(settings).sort(([left], [right]) => left.localeCompare(right)));
}

// Content packages build before the app packages that consume them; each builds once.
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

function createPublishPlan({
  savedCommit,
  packaging,
  versions = {},
  targets,
  toolchain = {},
  templates = {}
} = {}) {
  if (!COMMIT.test(savedCommit || "")) invalid("A publish plan needs the full saved commit id.");
  const packages = packagingPackages(packaging);
  const normalizedTargets = normalizeTargets(targets, packages);
  const versionedCount = [...packages.values()].filter((entry) => entry.versionFrom).length;
  const built = buildOrder(normalizedTargets, packages).map((id) => {
    const entry = packages.get(id);
    if (!entry.versionFrom) return { id, packer: entry.packer, version: null, tag: null };
    const version = versions[id];
    if (!SEMVER.test(version || "")) invalid(`Package ${id} needs its release version, such as 1.5.0.`);
    return {
      id,
      packer: entry.packer,
      version,
      tag: releaseTagName({ packageId: id, version, independent: versionedCount > 1 })
    };
  });
  for (const id of Object.keys(versions)) {
    if (!built.some((entry) => entry.id === id && entry.version)) invalid(`Version given for ${id}, which this release does not publish.`);
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
    steps: [
      ...tags.map((tag) => ({ kind: "tag", tag })),
      ...built.map(({ id }) => ({ kind: "build", package: id })),
      ...normalizedTargets.flatMap(({ id }) => [{ kind: "publish", target: id }, { kind: "read-back", target: id }])
    ]
  };
  return { plan, planHash: publishPlanHash(plan) };
}

function publishPlanHash(plan) {
  if (plan?.contract !== VIBE64_PUBLISH_PLAN_CONTRACT) invalid("Only a Vibe64 publish plan can be hashed.");
  return sha256(canonicalJson(plan));
}

// The short form people see next to the plan, such as "plan #c41d".
function publishPlanDisplayId(planHash) {
  const match = /^sha256:([0-9a-f]{4})[0-9a-f]{60}$/u.exec(planHash || "");
  if (!match) invalid("Not a publish plan hash.");
  return match[1];
}

export {
  VIBE64_PUBLISH_PLAN_CONTRACT,
  createPublishPlan,
  publishPlanDisplayId,
  publishPlanHash,
  releaseTagName
};
