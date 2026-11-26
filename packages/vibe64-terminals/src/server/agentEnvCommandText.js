// Parses an agent's env command line and words its replies: usage, scope status and mutation results.

import { vibe64Error } from "@local/vibe64-core/server/core";
import { SAVED_ENV_VALUE_SOURCE } from "@local/vibe64-project/server/savedEnvValues";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { commandLineFailure } from "./commandFailure.js";
import { stagingUsageText } from "./agentStagingStatus.js";
import { PRODUCTION_UNAVAILABLE_REASON } from "./productionEnvironment.js";

const ENV_SCOPE_DEVELOPMENT = "development";
const ENV_SCOPE_STAGING = "staging";
const ENV_SCOPE_PRODUCTION = "production";
const ENV_SCOPE_ALL = "all";
const SERVICES_FLAG = "--services=";
const SCOPE_LABELS = Object.freeze({
  [ENV_SCOPE_DEVELOPMENT]: "development",
  [ENV_SCOPE_STAGING]: "staging",
  [ENV_SCOPE_PRODUCTION]: "production"
});
const VALUE_ON_STDIN = "A value goes in on stdin only, never as an argument, so it never appears in the command line or a " +
  "transcript: openssl rand -hex 32 | vibe64-helper env set <scope> <KEY> --secret.";

// What each env operation reads: the arguments after its name (each one's name, `?` when it may be left out), its
// options and whether it reads a value on stdin. Anything else is refused, never ignored, and so is a missing argument,
// each naming what the operation takes: an input sent under a name the operation does not read would otherwise be
// answered ok and change nothing (26 Nov: a plan helper took progressText for text and kept no Progress). The plan
// helper's refuseUnreadInput (assistantWorkPlan.js) refuses its fields the same way.
const JSON_OPTION = "--json";
const OPERATION_INPUTS = Object.freeze({
  status: { arguments: ["<development|staging|production|all>?"], options: [JSON_OPTION] },
  set: {
    arguments: ["<development|staging|production>", "<KEY>"],
    options: ["--secret", SERVICES_FLAG, JSON_OPTION],
    stdin: true
  },
  remove: { arguments: ["<development|staging|production>", "<KEY>"], options: [JSON_OPTION] },
  saved: { arguments: [], options: [JSON_OPTION] },
  link: { arguments: ["<development|staging>", "<KEY>", "<saved-id>", "<field-id>"], options: [JSON_OPTION] },
  unlink: { arguments: ["<development|staging>", "<KEY>"], options: [JSON_OPTION] },
  get: { arguments: ["staging", "<KEY>"], options: [JSON_OPTION] },
  export: { arguments: ["staging"], options: [JSON_OPTION] }
});

function usageText() {
  return [
    "Usage:",
    "  vibe64-helper env status [development|staging|production|all] [--json]",
    "  <value on stdin> | vibe64-helper env set <development|staging> <KEY> [--secret] [--json]",
    "  <value on stdin> | vibe64-helper env set production <KEY> [--secret] [--services=<id>,<id>] [--json]",
    "  vibe64-helper env remove <development|staging|production> <KEY> [--json]",
    "  vibe64-helper env saved [--json]",
    "  vibe64-helper env link <development|staging> <KEY> <saved-id> <field-id> [--json]",
    "  vibe64-helper env unlink <development|staging> <KEY> [--json]",
    "  vibe64-helper env get staging <KEY> [--json]",
    "  vibe64-helper env export staging [--json]",
    "  vibe64-helper staging status [--json]   this project's Staging, names only (--help: ssh staging)",
    "",
    "Values are accepted only on stdin and are never printed by set, remove, status, saved, link or unlink. A value",
    "given as an argument (--secret=<value>, or after the KEY) is refused. So is an option, argument or stdin an",
    "operation doesn't read, a missing argument, and env remove of a name the Env doesn't store: each refusal names",
    "what the operation takes, and nothing changes.",
    "One final line ending on stdin (\\n or \\r\\n, which echo, openssl rand and heredocs add) is dropped, so",
    "`echo \"$VALUE\" |` and `printf '%s' \"$VALUE\" |` store the same value; every other character, whitespace included,",
    "is kept exactly. A value that really ends with a line break needs two. Empty stdin, or one line ending alone, stores",
    "an empty value.",
    "Development, staging and production are separate scopes; this command never copies values between them.",
    "--secret marks the value as a secret, which Env keeps hidden. A key that is already secret stays secret, and keys",
    "whose names look secret (KEY, SECRET, TOKEN, PASSWORD, ...) become secrets automatically.",
    "Generated secrets (for example an application key): produce the value with the framework's own generator and pipe",
    "it to env set <scope> <KEY> --secret. Never write it into the generated .env; Vibe64 regenerates that file from Env.",
    "Production (where the host deploys to production): env set production and env remove production change the",
    "Production Env, which reaches Production only when the person deploys; the Deploy page's Plan lists each change,",
    "and the person discards or deploys it. No production value is ever read back: env get and env export read staging",
    "only. Pipe only a value you generate (openssl rand -hex 32 | vibe64-helper env set production APP_KEY --secret)",
    "or a plain setting. Never ask for a live credential (a payment provider's live key, a password) in chat: name it,",
    "and the person types it into the Production Env form on the Deploy page. --services=<id>,<id> names the services",
    "of genesis/stack.md that get the setting; a new one otherwise goes to the public service, and one the Production",
    "Env holds keeps its services. The host lets only the people who may deploy change it.",
    "When the host offers saved values, env saved lists their names, descriptions and fields (* marks a secret), never",
    "their values. env link fills the variable the application already reads from one field of a saved value; a linked",
    "row is not editable, and env unlink returns it to an ordinary empty row.",
    "env get staging prints one value the staging release runs with, secrets included, and env export staging",
    "prints them all as shell export lines (eval \"$(vibe64-helper env export staging)\"), where the host allows",
    "this session to use staging; otherwise they say why. The host records each read. Use these values in",
    "commands and keep them out of source, messages and summaries: they are staging's secrets."
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
  if (normalized === ENV_SCOPE_STAGING || normalized === ENV_SCOPE_PRODUCTION) {
    return normalized;
  }
  if (allowAll && (!normalized || normalized === ENV_SCOPE_ALL)) {
    return ENV_SCOPE_ALL;
  }
  return "";
}

function parseCommandArgs(args = []) {
  const all = Array.isArray(args) ? args.map((arg) => String(arg || "")) : [];
  // `staging ssh-config -- <ssh command line>`: what follows -- is the ssh, scp or sftp command line the
  // session's ssh wrapper is about to run, for the host's record.
  const separator = all.indexOf("--");
  const values = separator < 0 ? all : all.slice(0, separator);
  const flags = values.filter((arg) => arg.startsWith("-"));
  const servicesFlags = flags.filter((flag) => flag.startsWith(SERVICES_FLAG));
  // --secret=<value>, --value=<value> and the like: a value given where only stdin takes one.
  const valueFlags = flags.filter((flag) => /^--(secret|value)=/u.test(flag));
  const unsupportedFlags = flags.filter((flag) => !["--help", "-h", "--json", "--secret"].includes(flag) &&
    !flag.startsWith(SERVICES_FLAG) && !valueFlags.includes(flag));
  const positionals = values.filter((arg) => !arg.startsWith("-"));
  const command = toText(positionals[0]).toLowerCase();
  const help = flags.includes("--help") || flags.includes("-h") || command === "help";
  const scope = normalizeScope(positionals[1], {
    allowAll: command === "status"
  });
  return {
    command,
    entryId: toText(positionals[3]),
    // Each option as a refusal may name it: without what follows its =, which can be a value.
    flags: flags.map((flag) => (flag.includes("=") ? `${flag.slice(0, flag.indexOf("="))}=` : flag)),
    fieldId: toText(positionals[4]),
    help,
    json: flags.includes("--json"),
    key: toText(positionals[2]),
    passthrough: separator < 0 ? null : all.slice(separator + 1),
    positionals,
    scope,
    secret: flags.includes("--secret"),
    services: servicesFlags.length > 0
      ? servicesFlags.at(-1).slice(SERVICES_FLAG.length).split(",").map(toText).filter(Boolean)
      : null,
    servicesFlags,
    unsupportedFlags,
    valueFlags
  };
}

function syntaxFailure(message = "Invalid Vibe64 Env command.") {
  return commandLineFailure(message, "vibe64_agent_env_command_usage", {
    exitCode: 2,
    stderr: `${message}\n\n${usageText()}`
  });
}

/** What an env operation takes, in words: its arguments, its options and its value on stdin. @param {string} command */
function operationTakes(command) {
  const { arguments: names, options, stdin } = OPERATION_INPUTS[command];
  const shown = [
    ...names.map((name) => (name.endsWith("?") ? `[${name.slice(0, -1)}]` : name)),
    ...options.map((option) => `[${option === SERVICES_FLAG ? `${SERVICES_FLAG}<id>,<id> (production)` : option}]`)
  ];
  return `${shown.join(" ")}${stdin ? ", and the value on stdin" : ""}`;
}

/**
 * Refuses what an env operation does not read (an option, an argument past its own, a value on stdin) and an argument
 * it needs that is missing, naming what it takes; an argument's text is never repeated, as it can be a value.
 * @param {ReturnType<typeof parseCommandArgs>} parsed @param {string} stdin
 */
function refuseUnreadInput(parsed, stdin) {
  const inputs = OPERATION_INPUTS[parsed.command];
  if (!inputs || parsed.help) {
    return null;
  }
  const reads = (flag) => inputs.options.includes(flag);
  const extra = parsed.positionals.length - 1 - inputs.arguments.length;
  const unread = [
    ...new Set(parsed.flags.filter((flag) => !reads(flag))),
    ...(extra > 0 ? [`${extra === 1 ? "an argument" : `${extra} arguments`} after ${inputs.arguments.at(-1) || parsed.command}`] : []),
    ...(stdin !== "" && !inputs.stdin ? ["a value on stdin"] : [])
  ];
  const takes = operationTakes(parsed.command);
  if (unread.length > 0) {
    const message = `env ${parsed.command} does not read ${unread.join(", ")}: nothing changed. It takes ${takes}.`;
    return commandLineFailure(message, "vibe64_agent_env_command_input_unknown", {
      exitCode: 2,
      stderr: `${message}\n\n${usageText()}`
    });
  }
  const missing = inputs.arguments.filter((name, index) => !name.endsWith("?") && !toText(parsed.positionals[index + 1]));
  if (missing.length > 0) {
    const message = `env ${parsed.command} takes ${takes}: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} `
      + "missing, so nothing changed.";
    return commandLineFailure(message, "vibe64_agent_env_command_input_missing", {
      exitCode: 2,
      stderr: `${message}\n\n${usageText()}`
    });
  }
  return null;
}

/**
 * The command's refusal before anything is read or written, or null to run it.
 * @param {ReturnType<typeof parseCommandArgs>} parsed @param {{ stdin?: string }} [input] the value on stdin
 */
function validateParsedCommand(parsed = {}, { stdin = "" } = {}) {
  if (parsed.valueFlags.length > 0 || (parsed.command === "set" && parsed.positionals.length > 3)) {
    return syntaxFailure(VALUE_ON_STDIN);
  }
  const unread = refuseUnreadInput(parsed, String(stdin ?? ""));
  if (unread) {
    return unread;
  }
  if (parsed.servicesFlags.length > 0 && (parsed.command !== "set" || parsed.scope !== ENV_SCOPE_PRODUCTION ||
      parsed.services.length === 0)) {
    return syntaxFailure("--services=<id>,<id> names a production setting's services: env set production <KEY> --services=web.");
  }
  if (parsed.unsupportedFlags.length > 0) {
    return syntaxFailure(`Unsupported option: ${parsed.unsupportedFlags[0]}`);
  }
  if (!parsed.command || parsed.help) {
    return {
      exitCode: 0,
      ok: true,
      stdout: parsed.command === "staging" ? stagingUsageText() : usageText()
    };
  }
  if (parsed.command === "staging") {
    const subcommand = toText(parsed.positionals[1]);
    const sshConfig = subcommand === "ssh-config" && !parsed.json;
    if (parsed.positionals.length > 2 || !(["", "status"].includes(subcommand) || sshConfig) || parsed.secret ||
        (parsed.passthrough !== null && !sshConfig)) {
      return commandLineFailure("staging accepts only status and --json.", "vibe64_agent_env_command_usage", {
        exitCode: 2,
        stderr: `staging accepts only status and --json.\n\n${stagingUsageText()}`
      });
    }
    return null;
  }
  if (parsed.passthrough !== null) {
    return syntaxFailure("Only staging ssh-config takes arguments after --.");
  }
  if ((parsed.command === "get" || parsed.command === "export") && parsed.scope === ENV_SCOPE_PRODUCTION) {
    return commandLineFailure(
      "Production values are never read back: the Production Env takes values in, and only the person sees them, on " +
        "the Deploy page. env get and env export read staging only.",
      "vibe64_agent_env_command_production_unreadable",
      { exitCode: 2 }
    );
  }
  if (parsed.command === "get" || parsed.command === "export") {
    if (parsed.scope !== ENV_SCOPE_STAGING) {
      return syntaxFailure(parsed.command === "get"
        ? "get reads one staging value: env get staging <KEY>."
        : "export reads staging values: env export staging.");
    }
    return null;
  }
  if (parsed.command === "status") {
    if (!parsed.scope) {
      return syntaxFailure("Status accepts only an optional development, staging, production or all scope.");
    }
    return null;
  }
  if (parsed.command === "saved") {
    return null;
  }
  if (!["set", "remove", "link", "unlink"].includes(parsed.command)) {
    return syntaxFailure(`Unknown Vibe64 Env command: ${parsed.command}`);
  }
  if (parsed.scope === ENV_SCOPE_PRODUCTION && (parsed.command === "link" || parsed.command === "unlink")) {
    return syntaxFailure(`${parsed.command} links saved values into development or staging only.`);
  }
  if (![ENV_SCOPE_DEVELOPMENT, ENV_SCOPE_STAGING, ENV_SCOPE_PRODUCTION].includes(parsed.scope)) {
    return syntaxFailure(`${parsed.command} requires an explicit development, staging or production scope.`);
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
  const production = scope === ENV_SCOPE_PRODUCTION;
  return {
    configured,
    editable: record.editable === true,
    key: toText(record.key),
    ...(linked ? { label: toText(record.label), linked: true } : {}),
    // The services a production setting goes to, and its change since the last Deploy to production (added, changed,
    // replaced, services or removed), which the Deploy page's Plan lists for the person.
    ...(production ? {
      change: toText(record.change),
      services: Array.isArray(record.services) ? record.services.map(toText).filter(Boolean) : []
    } : {}),
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

function unavailableStagingStatus() {
  return {
    available: false,
    reason: "Staging Env is not available in this Vibe64 installation.",
    records: [],
    scope: ENV_SCOPE_STAGING
  };
}

function unavailableProductionStatus() {
  return {
    available: false,
    reason: PRODUCTION_UNAVAILABLE_REASON,
    records: [],
    scope: ENV_SCOPE_PRODUCTION
  };
}

function humanStatus(statuses = []) {
  const lines = [];
  for (const status of statuses) {
    const label = { [ENV_SCOPE_STAGING]: "Staging Env", [ENV_SCOPE_PRODUCTION]: "Production Env" }[status.scope] ||
      "Development Env";
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
        record.requiredFor.length > 0 ? `required for ${record.requiredFor.join(", ")}` : "",
        record.services?.length > 0 ? `goes to ${record.services.join(", ")}` : "",
        record.change ? `${record.change} since the last Deploy to production` : ""
      ].filter(Boolean);
      lines.push(`  ${record.key} — ${details.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function mutationStdout({
  action = "set",
  created = false,
  empty = false,
  key = "",
  scope = ""
} = {}) {
  const label = SCOPE_LABELS[scope] || "development";
  // Nothing reaches Production until the person deploys, from the Plan that lists the change.
  const waits = scope === ENV_SCOPE_PRODUCTION
    ? "It reaches Production only when the person deploys to production; the Deploy page's Plan lists the change.\n"
    : "";
  if (action === "remove") {
    return `Removed ${label} Env ${key}.\nStored Env state remains outside Git.\n${waits}`;
  }
  const emptyLabel = empty ? " with an empty value" : "";
  return `${created ? "Created" : "Updated"} ${label} Env ${key}${emptyLabel}.\nStored by Vibe64 outside Git; the value was not printed.\n${waits}`;
}

/** A removal of a name the scope's Env doesn't store: refused, so nothing is answered as removed. */
function notStoredFailure(scope = "", key = "") {
  const label = SCOPE_LABELS[scope] || "development";
  return commandLineFailure(
    `${label[0].toUpperCase()}${label.slice(1)} Env ${key} is not stored, so nothing changed: env remove takes a name the `
      + `${label} Env stores (vibe64-helper env status ${scope} lists them).`,
    "vibe64_agent_env_command_key_not_stored"
  );
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
  const label = { [ENV_SCOPE_STAGING]: "Staging", [ENV_SCOPE_PRODUCTION]: "Production" }[scope] || "Development";
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
  ENV_SCOPE_STAGING,
  humanStatus,
  mutationPayload,
  notStoredFailure,
  parseCommandArgs,
  recordForKey,
  scopeStatus,
  unavailableProductionStatus,
  unavailableStagingStatus,
  validateParsedCommand
};
