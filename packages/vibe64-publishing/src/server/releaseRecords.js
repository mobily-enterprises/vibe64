// How a release record reads: its summary for the page, the log lines of a failure, the steps it tracks, the release
// notes from the CHANGELOG and the version bumps the Release dialog offers.
import os from "node:os";

const OUTPUT_EXCERPT_LIMIT = 1800;

/**
 * The part of a long tool output that says why: tools such as npm name the
 * problem first and then print usage, while others such as Gradle sum up at
 * the end, so a long output keeps its start and its end.
 */
function outputExcerpt(output) {
  if (output.length <= OUTPUT_EXCERPT_LIMIT) return output;
  const head = output.slice(0, Math.floor(OUTPUT_EXCERPT_LIMIT / 3)).replace(/\n[^\n]*$/u, "");
  const rest = output.slice(-(OUTPUT_EXCERPT_LIMIT - head.length - 3));
  return `${head}\n…\n${rest.replace(/^[^\n]*\n/u, "")}`;
}

/**
 * A failure's log lines: the message, then the tool's own output (builds run
 * without credentials; upload output is already redacted) so the person can
 * see why, with the home folder shortened.
 */
function failureLog(targetId, error, at) {
  const lines = [{ at, level: "error", message: `${targetId ? `${targetId}: ` : ""}${String(error?.message || error).slice(0, 1000)}` }];
  const output = String(error?.details?.output || "").trim();
  if (output) lines.push({ at, level: "error", message: outputExcerpt(output.replaceAll(os.homedir(), "~")) });
  return lines;
}

/**
 * The CHANGELOG section of one version, used as release notes.
 */
function changelogSection(text, version) {
  if (!text) return null;
  const lines = text.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^##\\s+\\[?${version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\]?(?:\\s|$)`, "u").test(line));
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

/**
 * The plan's own steps as a record tracks them; a dry run never tags.
 */
function recordSteps(publishPlan, kind) {
  const stepId = (entry) => {
    if (entry.kind === "build") return `build:${entry.package}`;
    if (entry.kind === "tag") return `tag:${entry.tag}`;
    return `${kind === "release" ? "publish" : "dry-run"}:${entry.target}`;
  };
  return publishPlan.steps
    .filter((entry) => kind === "release" || entry.kind !== "tag")
    .map((entry) => ({ id: stepId(entry), status: "pending", message: "" }));
}

export {
  bumpVersion,
  changelogSection,
  failureLog,
  outputExcerpt,
  recordSteps,
  summarizeRelease
};
