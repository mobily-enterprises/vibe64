// Words the agent's deployment status: the host's view of the session
// project's deployment, copied field by field so no value can pass through.

import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const DEPLOYMENT_UNAVAILABLE_REASON = "This Vibe64 installation does not publish projects.";
const DEPLOYMENT_STATES = new Set(["deployed", "deploying", "failed", "not-deployed", "offline"]);
// The words a person reads for each state: the feature is Publish, the place it runs Production.
const PRODUCTION_STATE_WORDS = Object.freeze({
  deployed: "published",
  deploying: "publishing",
  failed: "failed",
  "not-deployed": "not published",
  offline: "offline"
});
const DEPLOYMENT_STEP_ROLES = Object.freeze(["prepare", "build", "migrate", "serve"]);

function deploymentUsageText() {
  return [
    "Usage:",
    "  vibe64-helper deployment status [--json]",
    "  ssh production [command]          scp, sftp and rsync reach production:<path> the same way",
    "",
    "deployment status shows this session project's Production: whether it is published, its public addresses,",
    "the current release (id, commit, when it was published and its recorded commands), its Production Env variable",
    "names with their source, anything missing before the next publish, and whether this session may use production",
    "itself. It never shows a value and changes nothing.",
    "",
    "Using production itself, where the host offers it and allows this session:",
    "- ssh production logs in to the production host as the live release's own application account, in its",
    "  folder, with the Env it runs with, its database connection included: its files, data folders, database",
    "  client (mariadb or mysql, psql, sqlite3) and its own scripts work there as the app's do. It is not root",
    "  and has no general sudo, since the same host may run Vibe64 and other projects. Inside it,",
    "  production-logs [--lines <n>] [--since <time>], production-status and production-restart read or restart",
    "  the app's own service, and production-enter [command] runs the command, or a shell, where that running",
    "  service runs: the files it sees, its own mounts included (its private /tmp, a FUSE volume it mounted),",
    "  which the login itself does not see.",
    "- vibe64-helper env get production <KEY> prints one value the live release runs with, secrets included, and",
    "  vibe64-helper env export production prints them all as export lines.",
    "The host records each login and Env read. Where it does not allow this session, both say why and do",
    "nothing; deployment status says so too.",
    "",
    "Working on production, when possible:",
    "- Read before you change anything: logs, status and read-only commands first. Production holds real",
    "  people's data, and a mistake there reaches them at once.",
    "- Before changing data or files, take a backup (a database dump or a copy, kept in the app's home on the",
    "  production host rather than in this session's source, where real people's data could reach Git) and say",
    "  what will change and why, so the person can follow it and undo it.",
    "- Treat production values as secrets: use them in commands, and keep them out of source, messages and",
    "  summaries."
  ].join("\n") + "\n";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function texts(value) {
  return list(value).map(toText).filter(Boolean);
}

function deploymentRecord(record = {}) {
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

function deploymentRelease(release = null) {
  if (!release || typeof release !== "object") {
    return null;
  }
  return {
    commit: toText(release.commit),
    deployedAt: toText(release.deployedAt),
    id: toText(release.id),
    serveEnvironment: list(release.serveEnvironment)
      .map((entry) => ({ effect: toText(entry?.effect), key: toText(entry?.key) }))
      .filter((entry) => entry.key && entry.effect),
    steps: list(release.steps)
      .map((step) => ({ command: toText(step?.command), label: toText(step?.label), role: toText(step?.role) }))
      .filter((step) => DEPLOYMENT_STEP_ROLES.includes(step.role) && step.command)
  };
}

// Whether this session may use production itself (ssh production, production Env values) and, if not, the
// host's reason.
function deploymentAiAccess(access = null) {
  return {
    enabled: access?.enabled === true,
    reason: access?.enabled === true ? "" : toText(access?.reason)
  };
}

/**
 * The deployment a host reports, reduced to the fields this command shows.
 * @param {object} deployment
 */
function deploymentStatusPayload(deployment = {}) {
  const state = toText(deployment.state);
  const latest = deployment.latestDeploy;
  return {
    aiAccess: deploymentAiAccess(deployment.aiAccess),
    addresses: list(deployment.addresses)
      .map((address) => ({ label: toText(address?.label), url: toText(address?.url) }))
      .filter((address) => address.url),
    blockers: texts(deployment.blockers),
    latestDeploy: latest && toText(latest.status)
      ? { at: toText(latest.at), status: toText(latest.status) }
      : null,
    notes: texts(deployment.notes),
    ok: true,
    records: list(deployment.records)
      .map(deploymentRecord)
      .filter((record) => record.key)
      .sort((left, right) => left.key.localeCompare(right.key)),
    release: deploymentRelease(deployment.release),
    state: DEPLOYMENT_STATES.has(state) ? state : "unknown"
  };
}

function recordLine(record) {
  const state = record.configured
    ? record.generated ? "generated, set" : "set"
    : `not set${record.requiredFor.length > 0 ? `, required for ${record.requiredFor.join(", ")}` : ""}`;
  const source = record.sourceLabel || record.source;
  return `  ${record.key} — ${state}, ${record.secret ? "secret" : "plain"}${source ? ` (${source})` : ""}`;
}

function humanDeploymentStatus(payload) {
  const lines = [`Production: ${PRODUCTION_STATE_WORDS[payload.state] || payload.state}`];
  if (payload.addresses.length > 0) {
    lines.push("Addresses:", ...payload.addresses.map((address) => (
      `  ${address.url}${address.label ? ` (${address.label})` : ""}`
    )));
  }
  const release = payload.release;
  if (release) {
    lines.push(`Current release: ${release.id || "unknown"}`);
    if (release.commit) lines.push(`  Commit: ${release.commit}`);
    if (release.deployedAt) lines.push(`  Published: ${release.deployedAt}`);
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
      "AI access to production: on for this session (ssh production; vibe64-helper env get|export production)",
      "  It holds real people's data: when possible read first, back up what you will change and say what will",
      "  change. vibe64-helper deployment --help lists what works there (production-logs, production-enter, ...)."
    );
  } else {
    lines.push(`AI access to production: off${payload.aiAccess.reason ? ` — ${payload.aiAccess.reason}` : ""}`);
  }
  if (payload.latestDeploy) {
    lines.push(`Latest publish: ${payload.latestDeploy.status}${payload.latestDeploy.at ? ` at ${payload.latestDeploy.at}` : ""}`);
  }
  lines.push("Production Env (names only; values are never shown):");
  lines.push(...(payload.records.length > 0 ? payload.records.map(recordLine) : ["  no variables"]));
  if (payload.blockers.length > 0) {
    lines.push("Missing before the next publish:", ...payload.blockers.map((blocker) => `  ${blocker}`));
  }
  lines.push(...payload.notes);
  return `${lines.join("\n")}\n`;
}

export {
  DEPLOYMENT_UNAVAILABLE_REASON,
  deploymentStatusPayload,
  deploymentUsageText,
  humanDeploymentStatus
};
