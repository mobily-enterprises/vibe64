import { oneLineText, processArguments, runtimeArguments, unknownEntryMessage } from "./stackOperation.js";
import { ERROR_CODE, invalid, setOnce, tokenValues } from "./outputsSyntax.js";

// An Outputs target's Preview identity block: the app-owned command that signs
// a preview in, its protocol, identity types, environment names and timeout.
const VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL = "vibe64.preview-identity.command.v1";
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const RESERVED_ENVIRONMENT_NAMES = new Set([
  "HOME",
  "LOGNAME",
  "NODE_OPTIONS",
  "PATH",
  "TMPDIR",
  "USER"
]);
const IDENTITY_TYPES = new Set(["email", "login", "user-id"]);
const PREVIEW_TIMEOUT_DEFAULT_MS = 10_000;
const PREVIEW_TIMEOUT_MAX_MS = 30_000;
// [entry prefix, draft field, label, value form shown in errors and the spec]
const PREVIEW_FIELDS = [
  ["- Command: ", "command", "Command", "`tools/preview-identity` `argument`..."],
  ["- Protocol: ", "protocol", "Protocol", `\`${VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL}\``],
  ["- Identity types: ", "identityTypes", "Identity types", `one or more of ${[...IDENTITY_TYPES].map((type) => `\`${type}\``).join(" ")}`],
  ["- Enabled environment: ", "enabledEnvironment", "Enabled environment", "`ENV_NAME`"],
  ["- Secret environment: ", "secretEnvironment", "Secret environment", "`ENV_NAME`"],
  ["- Runtimes: ", "runtimes", "Runtimes", "`runtime`..."],
  ["- Timeout ms: ", "timeoutMs", "Timeout ms", `\`1\` through \`${PREVIEW_TIMEOUT_MAX_MS}\` (default ${PREVIEW_TIMEOUT_DEFAULT_MS})`]
];
const PREVIEW_IDENTITY_ENTRY_FORMS = PREVIEW_FIELDS.map(([prefix, , , value]) => `${prefix}${value}`);

function environmentName(value, outputsPath, label, line) {
  if (value === undefined) return "";
  const name = oneLineText(value, ERROR_CODE, outputsPath, `Preview identity ${label} environment name`, line);
  if (
    !ENVIRONMENT_NAME.test(name)
    || RESERVED_ENVIRONMENT_NAMES.has(name)
    || name.startsWith("XDG_")
  ) {
    invalid(outputsPath, `Preview identity ${label} environment name is invalid.`, line);
  }
  return name;
}

function previewDraft(line) {
  return { seen: new Set(), line };
}

function parsePreviewLine(draft, source, outputsPath, line) {
  const field = PREVIEW_FIELDS.find(([prefix]) => source.startsWith(prefix));
  if (!field) {
    invalid(outputsPath, unknownEntryMessage("Preview identity entry", source, PREVIEW_IDENTITY_ENTRY_FORMS), line);
  }
  const [prefix, key, label] = field;
  const values = tokenValues(source, prefix, outputsPath, `Preview identity ${label}`, line);
  if (!["command", "identityTypes", "runtimes"].includes(key) && values.length !== 1) {
    invalid(outputsPath, `Preview identity ${label} accepts exactly one value.`, line);
  }
  setOnce(draft, key, values, outputsPath, line, `Preview identity ${label} entry`);
}

function normalizePreviewIdentity(draft, outputsPath, targetId) {
  for (const [field, label] of [
    ["command", "Command"],
    ["protocol", "Protocol"],
    ["identityTypes", "Identity types"]
  ]) {
    if (!draft[field]) {
      invalid(outputsPath, `Output target ${targetId} Preview identity needs ${label}.`, draft.line);
    }
  }
  const commandSource = draft.command.map((value) => `\`${value}\``).join(" ");
  const command = processArguments(
    commandSource,
    ERROR_CODE,
    outputsPath,
    "Preview identity command",
    draft.line
  );
  if (
    !command[0].includes("/")
    || command[0].includes("\\")
    || command[0].split("/").some((part) => !part || [".", ".."].includes(part))
    || command.some((argument) => /\{(?:host|port)\}/u.test(argument))
  ) {
    invalid(
      outputsPath,
      "Preview identity command must use a literal app-owned project-relative executable.",
      draft.line
    );
  }
  const protocol = draft.protocol[0];
  if (protocol !== VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL) {
    invalid(
      outputsPath,
      `Preview identity protocol must be ${VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL}.`,
      draft.line
    );
  }
  const identityTypes = [...new Set(draft.identityTypes.map((type) => {
    if (!IDENTITY_TYPES.has(type)) {
      invalid(outputsPath, `Unsupported preview identity type: ${type}.`, draft.line);
    }
    return type;
  }))];
  if (identityTypes.length !== draft.identityTypes.length) {
    invalid(outputsPath, "Preview identity types must not contain duplicates.", draft.line);
  }
  const environment = {
    enabled: environmentName(draft.enabledEnvironment?.[0], outputsPath, "enabled", draft.line),
    secret: environmentName(draft.secretEnvironment?.[0], outputsPath, "secret", draft.line)
  };
  if (environment.enabled && environment.enabled === environment.secret) {
    invalid(outputsPath, "Preview identity enabled and secret environment names must differ.", draft.line);
  }
  let timeoutMs = PREVIEW_TIMEOUT_DEFAULT_MS;
  if (draft.timeoutMs) {
    const value = draft.timeoutMs[0];
    if (!/^[0-9]+$/u.test(value)) {
      invalid(outputsPath, `Preview identity Timeout ms must be from 1 through ${PREVIEW_TIMEOUT_MAX_MS}.`, draft.line);
    }
    timeoutMs = Number(value);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PREVIEW_TIMEOUT_MAX_MS) {
      invalid(outputsPath, `Preview identity Timeout ms must be from 1 through ${PREVIEW_TIMEOUT_MAX_MS}.`, draft.line);
    }
  }
  return {
    command,
    environment,
    identityTypes,
    protocol,
    runtimes: draft.runtimes
      ? runtimeArguments(
        draft.runtimes.map((value) => `\`${value}\``).join(" "),
        ERROR_CODE,
        outputsPath,
        "Preview identity runtimes",
        draft.line
      )
      : [],
    timeoutMs
  };
}

export {
  PREVIEW_IDENTITY_ENTRY_FORMS,
  RESERVED_ENVIRONMENT_NAMES,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  normalizePreviewIdentity,
  parsePreviewLine,
  previewDraft
};
