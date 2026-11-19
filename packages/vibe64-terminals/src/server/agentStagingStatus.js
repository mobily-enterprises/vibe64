// Words the agent's staging status: the host's view of the session
// project's staging, copied field by field so no value can pass through.

import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const STAGING_UNAVAILABLE_REASON = "This Vibe64 installation does not publish projects.";
const STAGING_STATES = new Set(["on-staging", "publishing", "failed", "not-on-staging", "offline"]);
// The words a person reads for each state: the feature is Publish, the place it runs Staging.
const STAGING_STATE_WORDS = Object.freeze({
  "on-staging": "published",
  publishing: "publishing",
  failed: "failed",
  "not-on-staging": "not published",
  offline: "offline"
});
const DEPLOYMENT_STEP_ROLES = Object.freeze(["prepare", "build", "migrate", "serve"]);

function stagingUsageText() {
  return [
    "Usage:",
    "  vibe64-helper staging status [--json]",
    "  ssh staging [command]             scp, sftp and rsync reach staging:<path> the same way",
    "",
    "staging status shows this session project's Staging: whether it is published, its public addresses,",
    "the current release (id, commit, when it was published and its recorded commands), its Staging Env variable",
    "names with their source, anything missing before the next publish, and whether this session may use staging",
    "itself. It never shows a value and changes nothing.",
    "",
    "Using staging itself, where the host offers it and allows this session:",
    "- ssh staging logs in to the staging host as the staging release's own staging account, in its",
    "  folder, with the Env it runs with, its database connection included: its files, data folders, database",
    "  client (mariadb or mysql, psql, sqlite3) and its own scripts work there as the app's do. It is not root",
    "  and has no general sudo, since the same host may run Vibe64 and other projects. Inside it,",
    "  staging-logs [--lines <n>] [--since <time>], staging-status and staging-restart read or restart",
    "  the app's own service, and staging-enter [command] runs the command, or a shell, where that running",
    "  service runs: the files it sees, its own mounts included (its private /tmp, a FUSE volume it mounted),",
    "  which the login itself does not see.",
    "- vibe64-helper env get staging <KEY> prints one value the staging release runs with, secrets included, and",
    "  vibe64-helper env export staging prints them all as export lines.",
    "The host records each login and Env read, and each login's commands word for word. Where it does not",
    "allow this session, both say why and do nothing; staging status says so too.",
    "",
    "Working on staging, when possible:",
    "- Read before you change anything: logs, status and read-only commands first. Staging may hold real",
    "  people's data, and a mistake there reaches them at once.",
    "- Before changing data or files, take a backup (a database dump or a copy, kept in the app's home on the",
    "  staging host rather than in this session's source, where real people's data could reach Git) and say",
    "  what will change and why, so the person can follow it and undo it.",
    "- Treat staging values as secrets: use them in commands, and keep them out of source, messages and",
    "  summaries. Inside ssh staging the release's Env is already loaded, so name a value ($DB_PASSWORD)",
    "  instead of writing it into a command line, which the host records word for word."
  ].join("\n") + "\n";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function texts(value) {
  return list(value).map(toText).filter(Boolean);
}

function stagingRecord(record = {}) {
  return {
    configured: record.valuePresent === true,
    generated: record.generated === true,
    key: toText(record.key),
    requiredFor: texts(record.requiredFor),
    secret: record.secret === true,
    source: toText(record.source),
    sourceLabel: toText(record.sourceLabel)
  };
}

function stagingRelease(release = null) {
  if (!release || typeof release !== "object") {
    return null;
  }
  return {
    commit: toText(release.commit),
    stagingPublishedAt: toText(release.stagingPublishedAt),
    id: toText(release.id),
    serveEnvironment: list(release.serveEnvironment)
      .map((entry) => ({ effect: toText(entry?.effect), key: toText(entry?.key) }))
      .filter((entry) => entry.key && entry.effect),
    steps: list(release.steps)
      .map((step) => ({ command: toText(step?.command), label: toText(step?.label), role: toText(step?.role) }))
      .filter((step) => DEPLOYMENT_STEP_ROLES.includes(step.role) && step.command)
  };
}

// Whether this session may use staging itself (ssh staging, staging Env values) and, if not, the
// host's reason.
function stagingAiAccess(access = null) {
  return {
    enabled: access?.enabled === true,
    reason: access?.enabled === true ? "" : toText(access?.reason)
  };
}

/**
 * The Staging status a host reports, reduced to the fields this command shows.
 * @param {object} staging
 */
function stagingStatusPayload(staging = {}) {
  const state = toText(staging.state);
  const latest = staging.latestStagingPublish;
  return {
    aiAccess: stagingAiAccess(staging.aiAccess),
    addresses: list(staging.addresses)
      .map((address) => ({ label: toText(address?.label), url: toText(address?.url) }))
      .filter((address) => address.url),
    blockers: texts(staging.blockers),
    latestStagingPublish: latest && toText(latest.status)
      ? { at: toText(latest.at), status: toText(latest.status) }
      : null,
    notes: texts(staging.notes),
    ok: true,
    records: list(staging.records)
      .map(stagingRecord)
      .filter((record) => record.key)
      .sort((left, right) => left.key.localeCompare(right.key)),
    release: stagingRelease(staging.release),
    state: STAGING_STATES.has(state) ? state : "unknown"
  };
}

function recordLine(record) {
  const state = record.configured
    ? record.generated ? "generated, set" : "set"
    : `not set${record.requiredFor.length > 0 ? `, required for ${record.requiredFor.join(", ")}` : ""}`;
  const source = record.sourceLabel || record.source;
  return `  ${record.key} — ${state}, ${record.secret ? "secret" : "plain"}${source ? ` (${source})` : ""}`;
}

function humanStagingStatus(payload) {
  const lines = [`Staging: ${STAGING_STATE_WORDS[payload.state] || payload.state}`];
  if (payload.addresses.length > 0) {
    lines.push("Addresses:", ...payload.addresses.map((address) => (
      `  ${address.url}${address.label ? ` (${address.label})` : ""}`
    )));
  }
  const release = payload.release;
  if (release) {
    lines.push(`Current release: ${release.id || "unknown"}`);
    if (release.commit) lines.push(`  Commit: ${release.commit}`);
    if (release.stagingPublishedAt) lines.push(`  Published: ${release.stagingPublishedAt}`);
    for (const step of release.steps) {
      const role = `${step.role[0].toUpperCase()}${step.role.slice(1)}`;
      lines.push(`  ${role}${step.label ? ` (${step.label})` : ""}: ${step.command}`);
    }
    for (const entry of release.serveEnvironment) {
      lines.push(`  Serve ${entry.key}: ${entry.effect}`);
    }
  } else {
    lines.push("Current release: none");
  }
  if (payload.aiAccess.enabled) {
    lines.push(
      "AI access to staging: on for this session (ssh staging; vibe64-helper env get|export staging)",
      "  It may hold real people's data: when possible read first, back up what you will change and say what will",
      "  change. vibe64-helper staging --help lists what works there (staging-logs, staging-enter, ...)."
    );
  } else {
    lines.push(`AI access to staging: off${payload.aiAccess.reason ? ` — ${payload.aiAccess.reason}` : ""}`);
  }
  if (payload.latestStagingPublish) {
    lines.push(`Latest publish: ${payload.latestStagingPublish.status}${payload.latestStagingPublish.at ? ` at ${payload.latestStagingPublish.at}` : ""}`);
  }
  lines.push("Staging Env (names only; values are never shown):");
  lines.push(...(payload.records.length > 0 ? payload.records.map(recordLine) : ["  no variables"]));
  if (payload.blockers.length > 0) {
    lines.push("Missing before the next publish:", ...payload.blockers.map((blocker) => `  ${blocker}`));
  }
  lines.push(...payload.notes);
  return `${lines.join("\n")}\n`;
}

export {
  STAGING_UNAVAILABLE_REASON,
  stagingStatusPayload,
  stagingUsageText,
  humanStagingStatus
};
