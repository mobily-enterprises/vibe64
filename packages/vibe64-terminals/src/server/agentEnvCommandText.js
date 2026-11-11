// Parses an agent's env command line and words its replies: usage, scope status and mutation results.

import { vibe64Error } from "@local/vibe64-core/server/core";
import { SAVED_ENV_VALUE_SOURCE } from "@local/vibe64-project/server/savedEnvValues";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { commandLineFailure } from "./commandFailure.js";
import { deploymentUsageText } from "./agentDeploymentStatus.js";

const ENV_SCOPE_DEVELOPMENT = "development";
const ENV_SCOPE_PRODUCTION = "production";
const ENV_SCOPE_ALL = "all";

function usageText() {
  return [
    "Usage:",
    "  vibe64-helper env status [development|production|all] [--json]",
    "  <value on stdin> | vibe64-helper env set <development|production> <KEY> [--secret] [--json]",
    "  vibe64-helper env remove <development|production> <KEY> [--json]",
    "  vibe64-helper env saved [--json]",
    "  vibe64-helper env link <development|production> <KEY> <saved-id> <field-id> [--json]",
    "  vibe64-helper env unlink <development|production> <KEY> [--json]",
    "  vibe64-helper env get production <KEY> [--json]",
    "  vibe64-helper env export production [--json]",
    "  vibe64-helper deployment status [--json]   this project's Production, names only (--help: ssh production)",
    "",
    "Values are accepted only on stdin and are never printed by set, remove, status, saved, link or unlink.",
    "One final line ending on stdin (\\n or \\r\\n, which echo, openssl rand and heredocs add) is dropped, so",
    "`echo \"$VALUE\" |` and `printf '%s' \"$VALUE\" |` store the same value; every other character, whitespace included,",
    "is kept exactly. A value that really ends with a line break needs two. Empty stdin, or one line ending alone, stores",
    "an empty value.",
    "Development and production are separate scopes; this command never copies values between them.",
    "--secret marks the value as a secret, which Env keeps hidden. A key that is already secret stays secret, and keys",
    "whose names look secret (KEY, SECRET, TOKEN, PASSWORD, ...) become secrets automatically.",
    "Generated secrets (for example an application key): produce the value with the framework's own generator and pipe",
    "it to env set <scope> <KEY> --secret. Never write it into the generated .env; Vibe64 regenerates that file from Env.",
    "When the host offers saved values, env saved lists their names, descriptions and fields (* marks a secret), never",
    "their values. env link fills the variable the application already reads from one field of a saved value; a linked",
    "row is not editable, and env unlink returns it to an ordinary empty row.",
    "env get production prints one value the live release runs with, secrets included, and env export production",
    "prints them all as shell export lines (eval \"$(vibe64-helper env export production)\"), where the host allows",
    "this session to use production; otherwise they say why. The host records each read. Use these values in",
    "commands and keep them out of source, messages and summaries: they are production's secrets."
  ].join("\n") + "\n";
}


function assertOperationResult(result = {}, fallback = "Vibe64 Env operation failed.") {
  if (result.ok === false) {
    throw vibe64Error(
      toText(result.error || result.errors?.[0]?.message) || fallback,
      toText(result.code || result.errors?.[0]?.code) || "vibe64_agent_env_command_failed"
    );
  }
  return result;
}

function normalizeScope(value = "", options = {}) {
  const {
    allowAll = false
  } = options;
  const normalized = toText(value).toLowerCase();
  if (["dev", ENV_SCOPE_DEVELOPMENT].includes(normalized)) {
    return ENV_SCOPE_DEVELOPMENT;
  }
  if (["prod", ENV_SCOPE_PRODUCTION].includes(normalized)) {
    return ENV_SCOPE_PRODUCTION;
  }
  if (allowAll && (!normalized || normalized === ENV_SCOPE_ALL)) {
    return ENV_SCOPE_ALL;
  }
  return "";
}

function parseCommandArgs(args = []) {
  const all = Array.isArray(args) ? args.map((arg) => String(arg || "")) : [];
  // `deployment ssh-config -- <ssh command line>`: what follows -- is the ssh, scp or sftp command line the
  // session's ssh wrapper is about to run, for the host's record.
  const separator = all.indexOf("--");
  const values = separator < 0 ? all : all.slice(0, separator);
  const flags = values.filter((arg) => arg.startsWith("-"));
  const unsupportedFlags = flags.filter((flag) => !["--help", "-h", "--json", "--secret"].includes(flag));
  const positionals = values.filter((arg) => !arg.startsWith("-"));
  const command = toText(positionals[0]).toLowerCase();
  const help = flags.includes("--help") || flags.includes("-h") || command === "help";
  const scope = normalizeScope(positionals[1], {
    allowAll: command === "status"
  });
  return {
    command,
    entryId: toText(positionals[3]),
    fieldId: toText(positionals[4]),
    help,
    json: flags.includes("--json"),
    key: toText(positionals[2]),
    passthrough: separator < 0 ? null : all.slice(separator + 1),
    positionals,
    scope,
    secret: flags.includes("--secret"),
    unsupportedFlags
  };
}

function syntaxFailure(message = "Invalid Vibe64 Env command.") {
  return commandLineFailure(message, "vibe64_agent_env_command_usage", {
    exitCode: 2,
    stderr: `${message}\n\n${usageText()}`
  });
}

function validateParsedCommand(parsed = {}) {
  if (parsed.unsupportedFlags.length > 0) {
    return syntaxFailure(`Unsupported option: ${parsed.unsupportedFlags[0]}`);
  }
  if (!parsed.command || parsed.help) {
    return {
      exitCode: 0,
      ok: true,
      stdout: parsed.command === "deployment" ? deploymentUsageText() : usageText()
    };
  }
  if (parsed.command === "deployment") {
    const subcommand = toText(parsed.positionals[1]);
    const sshConfig = subcommand === "ssh-config" && !parsed.json;
    if (parsed.positionals.length > 2 || !(["", "status"].includes(subcommand) || sshConfig) || parsed.secret ||
        (parsed.passthrough !== null && !sshConfig)) {
      return commandLineFailure("deployment accepts only status and --json.", "vibe64_agent_env_command_usage", {
        exitCode: 2,
        stderr: `deployment accepts only status and --json.\n\n${deploymentUsageText()}`
      });
    }
    return null;
  }
  if (parsed.passthrough !== null) {
    return syntaxFailure("Only deployment ssh-config takes arguments after --.");
  }
  if (parsed.command === "get" || parsed.command === "export") {
    const keyCount = parsed.command === "get" ? 1 : 0;
    if (parsed.scope !== ENV_SCOPE_PRODUCTION || parsed.positionals.length !== 2 + keyCount || parsed.secret) {
      return syntaxFailure(parsed.command === "get"
        ? "get reads one production value: env get production <KEY>."
        : "export reads production values: env export production.");
    }
    return null;
  }
  if (parsed.command === "status") {
    if (!parsed.scope || parsed.positionals.length > 2 || parsed.secret) {
      return syntaxFailure("Status accepts only an optional development, production, or all scope.");
    }
    return null;
  }
  if (parsed.command === "saved") {
    if (parsed.positionals.length !== 1 || parsed.secret) {
      return syntaxFailure("saved accepts no arguments.");
    }
    return null;
  }
  if (!["set", "remove", "link", "unlink"].includes(parsed.command)) {
    return syntaxFailure(`Unknown Vibe64 Env command: ${parsed.command}`);
  }
  if (![ENV_SCOPE_DEVELOPMENT, ENV_SCOPE_PRODUCTION].includes(parsed.scope)) {
    return syntaxFailure(`${parsed.command} requires an explicit development or production scope.`);
  }
  if (parsed.command === "link") {
    if (!parsed.key || !parsed.entryId || !parsed.fieldId || parsed.positionals.length !== 5) {
      return syntaxFailure("link requires a variable name, a saved value id and a field id.");
    }
  } else if (!parsed.key || parsed.positionals.length !== 3) {
    return syntaxFailure(`${parsed.command} requires exactly one environment variable name.`);
  }
  if (parsed.command !== "set" && parsed.secret) {
    return syntaxFailure("--secret is valid only when setting a value.");
  }
  return null;
}

function recordIsLinked(record = null) {
  return toText(record?.source) === SAVED_ENV_VALUE_SOURCE;
}

/**
 * @param {object} record
 * @param {string} scope
 * @param {(record: object) => boolean} isUserValueRecord whether the scope stores the record's value itself
 */
function statusRecord(record, scope, isUserValueRecord) {
  const configured = record.valuePresent === true;
  const stored = isUserValueRecord(record) === true;
  const linked = recordIsLinked(record);
  return {
    configured,
    editable: record.editable === true,
    key: toText(record.key),
    ...(linked ? { label: toText(record.label), linked: true } : {}),
    missing: record.missing === true || record.valuePresent !== true,
    owner: toText(record.owner),
    requiredFor: Array.isArray(record.requiredFor) ? record.requiredFor.map(toText).filter(Boolean) : [],
    scope,
    secret: record.secret === true,
    source: toText(record.source),
    state: linked ? "linked" : configured ? "configured" : stored ? "empty" : "missing",
    stored
  };
}

/**
 * @param {object[]} records
 * @param {string} scope
 * @param {(record: object) => boolean} isUserValueRecord
 */
function sortedStatusRecords(records, scope, isUserValueRecord) {
  return (Array.isArray(records) ? records : [])
    .map((record) => statusRecord(record, scope, isUserValueRecord))
    .filter((record) => record.key)
    .sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * One scope's Env status for the agent's env command.
 * @param {string} scope
 * @param {object[]} records
 * @param {(record: object) => boolean} isUserValueRecord
 */
function scopeStatus(scope, records, isUserValueRecord) {
  return {
    available: true,
    records: sortedStatusRecords(records, scope, isUserValueRecord),
    scope
  };
}

function unavailableProductionStatus() {
  return {
    available: false,
    reason: "Production Env is not available in this Vibe64 installation.",
    records: [],
    scope: ENV_SCOPE_PRODUCTION
  };
}

function humanStatus(statuses = []) {
  const lines = [];
  for (const status of statuses) {
    const label = status.scope === ENV_SCOPE_PRODUCTION ? "Production Env" : "Development Env";
    lines.push(`${label}:`);
    if (status.available !== true) {
      lines.push(`  unavailable — ${status.reason}`);
      continue;
    }
    if (status.records.length === 0) {
      lines.push("  no declared or stored values");
      continue;
    }
    for (const record of status.records) {
      if (record.linked) {
        lines.push(`  ${record.key} — linked${record.label ? ` — ${record.label}` : ""}`);
        continue;
      }
      const details = [
        record.state,
        record.secret ? "secret" : "plain",
        record.editable ? "editable" : "managed",
        record.requiredFor.length > 0 ? `required for ${record.requiredFor.join(", ")}` : ""
      ].filter(Boolean);
      lines.push(`  ${record.key} — ${details.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function mutationStdout({
  action = "set",
  changed = false,
  created = false,
  empty = false,
  key = "",
  scope = ""
} = {}) {
  const label = scope === ENV_SCOPE_PRODUCTION ? "production" : "development";
  if (action === "remove") {
    return changed
      ? `Removed ${label} Env ${key}.\nStored Env state remains outside Git.\n`
      : `${label[0].toUpperCase()}${label.slice(1)} Env ${key} was not stored; no change.\n`;
  }
  const emptyLabel = empty ? " with an empty value" : "";
  return `${created ? "Created" : "Updated"} ${label} Env ${key}${emptyLabel}.\nStored by Vibe64 outside Git; the value was not printed.\n`;
}

function mutationPayload(input = {}, options = {}) {
  const {
    json = false
  } = options;
  const payload = {
    action: input.action,
    changed: input.changed === true,
    key: input.key,
    ok: true,
    scope: input.scope,
    storedOutsideGit: true,
    ...(input.action === "set" ? {
      created: input.created === true,
      empty: input.empty === true,
      secret: input.secret === true
    } : {})
  };
  return {
    ...payload,
    exitCode: 0,
    stdout: json
      ? `${JSON.stringify(payload, null, 2)}\n`
      : mutationStdout(payload)
  };
}

function recordForKey(records = [], key = "") {
  return (Array.isArray(records) ? records : []).find((record) => toText(record?.key) === key) || null;
}

function assertRecordEditable(record = null, scope = "", key = "") {
  if (!record || record.editable === true && toText(record.owner) !== "system") {
    return;
  }
  if (recordIsLinked(record)) {
    throw vibe64Error(
      `${key} is linked to a saved value. Unlink it before entering a value here.`,
      "vibe64_env_value_linked"
    );
  }
  const label = scope === ENV_SCOPE_PRODUCTION ? "Production" : "Development";
  throw vibe64Error(
    `${label} Env ${key} is managed by ${toText(record.source) || "Vibe64"} and cannot be changed as a user value.`,
    "vibe64_agent_env_command_managed_value"
  );
}

export {
  assertOperationResult,
  assertRecordEditable,
  ENV_SCOPE_ALL,
  ENV_SCOPE_DEVELOPMENT,
  ENV_SCOPE_PRODUCTION,
  humanStatus,
  mutationPayload,
  parseCommandArgs,
  recordForKey,
  scopeStatus,
  unavailableProductionStatus,
  validateParsedCommand
};
