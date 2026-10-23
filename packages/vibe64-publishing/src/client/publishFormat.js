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

function stepLabel(stepId, targetsById = {}) {
  const [kind, ...rest] = String(stepId || "").split(":");
  const subject = rest.join(":");
  if (kind === "tag") return `Tag ${subject}`;
  if (kind === "build") return `Build ${subject}`;
  const target = targetsById[subject];
  const name = target ? `${target.package} → ${target.destinationLabel || target.destination}` : subject;
  return kind === "dry-run" ? `Dry run ${name}` : `Publish ${name}`;
}

export { destinationAccent, destinationIcon, proofLine, relativeTime, shortCommit, statusInfo, stepLabel };
