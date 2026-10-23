// How the Publish page names and colours things, in one place.
import {
  mdiAlertCircle,
  mdiCellphoneArrowDown,
  mdiCheckCircle,
  mdiCircleOutline,
  mdiCloseCircle,
  mdiGithub,
  mdiLanguagePython,
  mdiMinusCircleOutline,
  mdiNpm,
  mdiProgressClock
} from "@mdi/js";

const DESTINATION_ICONS = Object.freeze({
  "android-sideload": mdiCellphoneArrowDown,
  "github-releases": mdiGithub,
  npm: mdiNpm,
  pypi: mdiLanguagePython
});

// Each destination keeps one accent so a target reads the same everywhere.
const DESTINATION_ACCENTS = Object.freeze({
  "android-sideload": "success",
  "github-releases": "primary",
  npm: "error",
  pypi: "info"
});

const STATUS = Object.freeze({
  succeeded: { label: "Published", color: "success", icon: mdiCheckCircle },
  proven: { label: "Published", color: "success", icon: mdiCheckCircle },
  checked: { label: "Would publish", color: "success", icon: mdiCheckCircle },
  done: { label: "Done", color: "success", icon: mdiCheckCircle },
  passed: { label: "Checks passed", color: "success", icon: mdiCheckCircle },
  partial: { label: "Partly published", color: "warning", icon: mdiAlertCircle },
  interrupted: { label: "Interrupted", color: "warning", icon: mdiAlertCircle },
  unconfigured: { label: "No checks", color: "warning", icon: mdiAlertCircle },
  failed: { label: "Failed", color: "error", icon: mdiCloseCircle },
  running: { label: "Running", color: "primary", icon: mdiProgressClock },
  pending: { label: "Waiting", color: "default", icon: mdiCircleOutline },
  skipped: { label: "Skipped", color: "default", icon: mdiMinusCircleOutline }
});

function statusInfo(status) {
  return STATUS[status] || { label: String(status || "Unknown"), color: "default", icon: mdiCircleOutline };
}

function destinationIcon(id) {
  return DESTINATION_ICONS[id] || mdiCircleOutline;
}

function destinationAccent(id) {
  return DESTINATION_ACCENTS[id] || "primary";
}

function shortCommit(commit) {
  return String(commit || "").slice(0, 7);
}

function relativeTime(value, now = Date.now()) {
  const at = Date.parse(value || "");
  if (Number.isNaN(at)) return "";
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(at).toLocaleDateString();
}

// The one-line proof a person can recognise: a hash prefix or a link.
function proofLine(proof = {}) {
  if (!proof || typeof proof !== "object") return "";
  if (proof.url) return proof.url;
  if (proof.integrity) return `${String(proof.integrity).slice(0, 19)}…`;
  const hash = proof.sha256 || proof.checksum;
  if (hash) return `${String(hash).replace(/^sha256:/u, "sha256 ").slice(0, 19)}…`;
  return "";
}

// "registry.npmjs.org" rather than a full URL: the place a person recognises.
function hostOf(address) {
  try {
    const url = new URL(String(address || ""));
    return `${url.host}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return String(address || "");
  }
}

// Where people find a published version, when the destination has a public page.
function publicPageUrl(destination, { package: name, version, settings = {} } = {}) {
  if (!name) return "";
  if (destination === "npm" && /(^|\.)npmjs\.org$/u.test(hostOf(settings.registry || "https://registry.npmjs.org/").split("/")[0])) {
    return `https://www.npmjs.com/package/${name}${version ? `/v/${version}` : ""}`;
  }
  if (destination === "pypi" && ["pypi", "testpypi"].includes(settings.instance)) {
    return `https://${settings.instance === "testpypi" ? "test." : ""}pypi.org/project/${name}/${version ? `${version}/` : ""}`;
  }
  return "";
}

// Why a destination cannot take this project yet ("" when it can): a package of
// a kind it publishes, and for GitHub Releases a repository on GitHub.
function destinationGap(entry, { packages = [], baseline = {} } = {}) {
  if (!packages.some((candidate) => entry.packers.includes(candidate.packer))) {
    if (entry.id === "android-sideload") return "Needs an app package in Packaging";
    if (entry.id === "npm") return "Needs a JavaScript package in Packaging";
    if (entry.id === "pypi") return "Needs a Python package in Packaging";
    return "Needs a package in Packaging";
  }
  if (entry.id === "github-releases" && !baseline.remote?.githubRepository) return "Needs this project's repository on GitHub";
  return "";
}

// The most recent release that tried this target and failed after its last
// success: what the target card warns about.
function lastFailure(target, releases = []) {
  const since = Date.parse(target?.latest?.at || "") || 0;
  for (const release of releases) {
    if (release.kind !== "release" || release.status === "running") continue;
    if ((Date.parse(release.finishedAt || release.createdAt) || 0) <= since) return null;
    const outcome = release.targets?.[target.id];
    const step = (release.steps || []).find((entry) => entry.id === `publish:${target.id}`);
    if (outcome?.status === "proven" || outcome?.status === "succeeded") return null;
    if (!outcome && !step) continue;
    if (outcome?.error || ["failed", "partial", "interrupted"].includes(release.status)) {
      return { release, message: outcome?.error?.message || release.error?.message || statusInfo(release.status).label };
    }
  }
  return null;
}

// A package's name as the person gave it in Packaging, or its id.
function packageLabeller(packages = []) {
  const labels = Object.fromEntries(packages.map((entry) => [entry.id, entry.label || entry.id]));
  return (id) => labels[id] || id;
}

function stepLabel(stepId, targetsById = {}, label = (id) => id) {
  const [kind, ...rest] = String(stepId || "").split(":");
  const subject = rest.join(":");
  if (kind === "tag") return `Tag ${subject}`;
  if (kind === "build") return `Build ${label(subject)}`;
  const target = targetsById[subject];
  const name = target ? `${label(target.package)} → ${target.destinationLabel || target.destination}` : subject;
  return kind === "dry-run" ? `Dry run ${name}` : `Publish ${name}`;
}

export { destinationAccent, destinationGap, destinationIcon, hostOf, lastFailure, packageLabeller, proofLine, publicPageUrl, relativeTime, shortCommit, statusInfo, stepLabel };
