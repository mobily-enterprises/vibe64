// Words the agent's deployment status: the host's view of the session
// project's deployment, copied field by field so no value can pass through.

import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const DEPLOYMENT_UNAVAILABLE_REASON = "This Vibe64 installation does not deploy projects.";
const DEPLOYMENT_STATES = new Set(["deployed", "deploying", "failed", "not-deployed", "offline"]);
const DEPLOYMENT_STEP_ROLES = Object.freeze(["prepare", "build", "migrate", "serve"]);

function deploymentUsageText() {
  return [
    "Usage:",
    "  vibe64-helper deployment status [--json]",
    "",
    "Shows this session project's deployment: whether it is deployed, its public addresses, the current release",
    "(id, commit, when it was deployed and its recorded commands), its Production Env variable names with their",
    "source, and anything missing before the next deploy. It never shows a value and changes nothing."
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

/**
 * The deployment a host reports, reduced to the fields this command shows.
 * @param {object} deployment
 */
function deploymentStatusPayload(deployment = {}) {
  const state = toText(deployment.state);
  const latest = deployment.latestDeploy;
  return {
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
  const lines = [`Deployment: ${payload.state}`];
  if (payload.addresses.length > 0) {
    lines.push("Addresses:", ...payload.addresses.map((address) => (
      `  ${address.url}${address.label ? ` (${address.label})` : ""}`
    )));
  }
  const release = payload.release;
  if (release) {
    lines.push(`Current release: ${release.id || "unknown"}`);
    if (release.commit) lines.push(`  Commit: ${release.commit}`);
    if (release.deployedAt) lines.push(`  Deployed: ${release.deployedAt}`);
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
  if (payload.latestDeploy) {
    lines.push(`Latest deploy: ${payload.latestDeploy.status}${payload.latestDeploy.at ? ` at ${payload.latestDeploy.at}` : ""}`);
  }
  lines.push("Production Env (names only; values are never shown):");
  lines.push(...(payload.records.length > 0 ? payload.records.map(recordLine) : ["  no variables"]));
  if (payload.blockers.length > 0) {
    lines.push("Missing before the next deploy:", ...payload.blockers.map((blocker) => `  ${blocker}`));
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
