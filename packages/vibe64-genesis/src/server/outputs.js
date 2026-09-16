import {
  assertMatchingStackInspections,
  backtickedArguments,
  httpReadinessLine,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  oneLineText,
  processArguments,
  projectPath,
  runtimeArguments,
  uniqueSorted,
  urlPath
} from "./stackOperation.js";

const VIBE64_OUTPUTS_CONTRACT = "vibe64.outputs.v1";
const VIBE64_OUTPUTS_SECTION = "Outputs";
const VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL = "vibe64.preview-identity.command.v1";
const ERROR_CODE = "VIBE64_OUTPUTS_INVALID";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PLACEHOLDER = /\{([a-z][a-z0-9-]*)\}/gu;
const TARGET_HEADING = /^### Target `([^`\r\n]+)`:[ \t]+(.+)$/u;
const DOWNLOAD_HEADING = /^#### Download `([^`\r\n]+)`$/u;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const RESERVED_ENVIRONMENT_NAMES = new Set([
  "HOME",
  "LOGNAME",
  "NODE_OPTIONS",
  "PATH",
  "TMPDIR",
  "USER"
]);
const IDENTITY_TYPES = new Set(["email", "login", "user-id"]);
const MODES = new Set(["finite", "interactive"]);
const PRESENTATION_KINDS = new Set(["terminal", "web"]);
const PREVIEW_FIELDS = [
  ["- Command: ", "command", "Command"],
  ["- Protocol: ", "protocol", "Protocol"],
  ["- Identity types: ", "identityTypes", "Identity types"],
  ["- Enabled environment: ", "enabledEnvironment", "Enabled environment"],
  ["- Secret environment: ", "secretEnvironment", "Secret environment"],
  ["- Runtimes: ", "runtimes", "Runtimes"],
  ["- Timeout ms: ", "timeoutMs", "Timeout ms"]
];

function invalid(outputsPath, message, line, details = {}) {
  invalidStackOperation(ERROR_CODE, outputsPath, message, line, details);
}

function outputId(value, outputsPath, label, line) {
  const normalized = oneLineText(value, ERROR_CODE, outputsPath, label, line);
  if (!ID_PATTERN.test(normalized)) {
    invalid(outputsPath, `${label} must use lowercase letters, digits, and single hyphens.`, line);
  }
  return normalized;
}

function tokenValues(source, prefix, outputsPath, label, line, options) {
  return backtickedArguments(
    source.slice(prefix.length),
    ERROR_CODE,
    outputsPath,
    label,
    line,
    options
  );
}

function oneToken(source, prefix, outputsPath, label, line) {
  return tokenValues(source, prefix, outputsPath, label, line, { count: 1 })[0];
}

function outputArguments(source, outputsPath, label, line) {
  const argv = processArguments(source, ERROR_CODE, outputsPath, label, line);
  for (const argument of argv) {
    if ([...argument.matchAll(PLACEHOLDER)].some((match) => !["host", "port"].includes(match[1]))) {
      invalid(outputsPath, `${label} supports only {host} and {port} placeholders.`, line);
    }
  }
  return argv;
}

function setOnce(draft, field, value, outputsPath, line, label) {
  if (draft.seen.has(field)) invalid(outputsPath, `Duplicate ${label}.`, line);
  draft.seen.add(field);
  draft[field] = value;
}

function targetDraft(match, outputsPath, line) {
  return {
    id: outputId(match[1], outputsPath, "Output target id", line),
    label: oneLineText(match[2], ERROR_CODE, outputsPath, "Output target label", line),
    default: false,
    mode: "",
    workdir: ".",
    runtimeRequirements: [],
    steps: [],
    presentation: null,
    previewIdentity: null,
    downloads: [],
    seen: new Set(),
    line
  };
}

function presentationDraft(line) {
  return {
    kind: "",
    preferredPort: null,
    urlPath: "/",
    readiness: null,
    seen: new Set(),
    line
  };
}

function downloadDraft(match, outputsPath, line) {
  return {
    id: outputId(match[1], outputsPath, "Download id", line),
    path: "",
    name: "",
    mediaType: "",
    seen: new Set(),
    line
  };
}

function preferredPort(value, outputsPath, line) {
  if (!/^[0-9]+$/u.test(value)) {
    invalid(outputsPath, "Web presentation preferred port must be an integer from 1024 through 65535.", line);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    invalid(outputsPath, "Web presentation preferred port must be an integer from 1024 through 65535.", line);
  }
  return port;
}

function parseTargetLine(draft, source, outputsPath, line) {
  if (source === "- Default.") {
    setOnce(draft, "default", true, outputsPath, line, "output target Default entry");
    return;
  }
  if (source.startsWith("- Mode: ")) {
    const mode = oneToken(source, "- Mode: ", outputsPath, "Output target Mode", line);
    if (!MODES.has(mode)) {
      invalid(outputsPath, "Output target Mode must be `interactive` or `finite`.", line);
    }
    setOnce(draft, "mode", mode, outputsPath, line, "output target Mode entry");
    return;
  }
  if (source.startsWith("- Workdir: ")) {
    setOnce(
      draft,
      "workdir",
      projectPath(
        oneToken(source, "- Workdir: ", outputsPath, "Output target Workdir", line),
        ERROR_CODE,
        outputsPath,
        "Output target workdir",
        line
      ),
      outputsPath,
      line,
      "output target Workdir entry"
    );
    return;
  }
  if (source.startsWith("- Runtimes: ")) {
    setOnce(
      draft,
      "runtimeRequirements",
      runtimeArguments(
        source.slice("- Runtimes: ".length),
        ERROR_CODE,
        outputsPath,
        "Output target runtimes",
        line
      ),
      outputsPath,
      line,
      "output target Runtimes entry"
    );
    return;
  }
  const step = source.match(/^- (Prepare|Build|Run) `([^`\r\n]+)`:[ \t]+(.+)$/u);
  if (step) {
    const role = step[1].toLowerCase();
    const argv = outputArguments(step[3], outputsPath, "Output step command", line);
    if (role !== "run" && argv.some((argument) => /\{(?:host|port)\}/u.test(argument))) {
      invalid(outputsPath, "Only a web presentation's Run step may use {host} or {port} placeholders.", line);
    }
    draft.steps.push({
      label: oneLineText(step[2], ERROR_CODE, outputsPath, "Output step label", line),
      argv,
      role
    });
    return;
  }
  invalid(outputsPath, `Unknown Outputs target entry: ${source}.`, line);
}

function parsePresentationLine(draft, source, outputsPath, line) {
  if (source.startsWith("- Kind: ")) {
    const kind = oneToken(source, "- Kind: ", outputsPath, "Presentation Kind", line);
    if (!PRESENTATION_KINDS.has(kind)) {
      invalid(outputsPath, "Presentation Kind must be `terminal` or `web`.", line);
    }
    setOnce(draft, "kind", kind, outputsPath, line, "Presentation Kind entry");
    return;
  }
  if (source.startsWith("- Preferred port: ")) {
    setOnce(
      draft,
      "preferredPort",
      preferredPort(
        oneToken(source, "- Preferred port: ", outputsPath, "Web presentation Preferred port", line),
        outputsPath,
        line
      ),
      outputsPath,
      line,
      "Presentation Preferred port entry"
    );
    return;
  }
  if (source.startsWith("- URL path: ")) {
    setOnce(
      draft,
      "urlPath",
      urlPath(
        oneToken(source, "- URL path: ", outputsPath, "Web presentation URL path", line),
        ERROR_CODE,
        outputsPath,
        "Web presentation URL path",
        line
      ),
      outputsPath,
      line,
      "Presentation URL path entry"
    );
    return;
  }
  if (source.startsWith("- Ready when: ")) {
    setOnce(
      draft,
      "readiness",
      httpReadinessLine(source, ERROR_CODE, outputsPath, "Web presentation readiness", line),
      outputsPath,
      line,
      "Presentation Ready when entry"
    );
    return;
  }
  invalid(outputsPath, `Unknown Presentation entry: ${source}.`, line);
}

function safeDownloadName(value, outputsPath, line) {
  const name = oneLineText(value, ERROR_CODE, outputsPath, "Download Name", line);
  if (
    name.length > 255
    || [".", ".."].includes(name)
    || /[\\/\0]/u.test(name)
    || name.trim() !== name
  ) {
    invalid(outputsPath, "Download Name must be a safe filename without path separators.", line);
  }
  return name;
}

function downloadMediaType(value, outputsPath, line) {
  const mediaType = oneLineText(value, ERROR_CODE, outputsPath, "Download Media type", line);
  if (mediaType.length > 127 || !MEDIA_TYPE.test(mediaType)) {
    invalid(outputsPath, "Download Media type must be a lowercase type/subtype value.", line);
  }
  return mediaType;
}

function parseDownloadLine(draft, source, outputsPath, line) {
  if (source.startsWith("- Path: ")) {
    setOnce(
      draft,
      "path",
      projectPath(
        oneToken(source, "- Path: ", outputsPath, "Download Path", line),
        ERROR_CODE,
        outputsPath,
        "Download path",
        line,
        { allowRoot: false }
      ),
      outputsPath,
      line,
      "Download Path entry"
    );
    return;
  }
  if (source.startsWith("- Name: ")) {
    setOnce(
      draft,
      "name",
      safeDownloadName(oneToken(source, "- Name: ", outputsPath, "Download Name", line), outputsPath, line),
      outputsPath,
      line,
      "Download Name entry"
    );
    return;
  }
  if (source.startsWith("- Media type: ")) {
    setOnce(
      draft,
      "mediaType",
      downloadMediaType(
        oneToken(source, "- Media type: ", outputsPath, "Download Media type", line),
        outputsPath,
        line
      ),
      outputsPath,
      line,
      "Download Media type entry"
    );
    return;
  }
  invalid(outputsPath, `Unknown Download entry: ${source}.`, line);
}

function normalizeDownload(draft, outputsPath, targetId) {
  for (const [field, label] of [
    ["path", "Path"],
    ["name", "Name"],
    ["mediaType", "Media type"]
  ]) {
    if (!draft[field]) {
      invalid(outputsPath, `Output target ${targetId} Download ${draft.id} needs ${label}.`, draft.line);
    }
  }
  return {
    id: draft.id,
    path: draft.path,
    name: draft.name,
    mediaType: draft.mediaType
  };
}

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
  if (!field) invalid(outputsPath, `Unknown Preview identity entry: ${source}.`, line);
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
  let timeoutMs = 10_000;
  if (draft.timeoutMs) {
    const value = draft.timeoutMs[0];
    if (!/^[0-9]+$/u.test(value)) {
      invalid(outputsPath, "Preview identity Timeout ms must be from 1 through 30000.", draft.line);
    }
    timeoutMs = Number(value);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      invalid(outputsPath, "Preview identity Timeout ms must be from 1 through 30000.", draft.line);
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

function normalizePresentation(draft, outputsPath, targetId) {
  if (!draft.kind) {
    invalid(outputsPath, `Output target ${targetId} Presentation needs Kind.`, draft.line);
  }
  if (draft.kind === "terminal") {
    if (draft.preferredPort !== null || draft.readiness || draft.seen.has("urlPath")) {
      invalid(outputsPath, `Output target ${targetId} terminal Presentation accepts only Kind.`, draft.line);
    }
    return { kind: "terminal" };
  }
  if (!draft.readiness) {
    invalid(outputsPath, `Output target ${targetId} web Presentation needs one Ready when entry.`, draft.line);
  }
  return {
    kind: "web",
    preferredPort: draft.preferredPort,
    urlPath: draft.urlPath,
    readiness: draft.readiness
  };
}

function normalizeTarget(draft, outputsPath) {
  if (!draft.mode) {
    invalid(outputsPath, `Output target ${draft.id} needs one Mode entry.`, draft.line);
  }
  if (draft.steps.length === 0) {
    invalid(outputsPath, `Output target ${draft.id} needs at least one step.`, draft.line);
  }
  const phase = { prepare: 0, build: 1, run: 2 };
  for (let index = 1; index < draft.steps.length; index += 1) {
    if (phase[draft.steps[index].role] < phase[draft.steps[index - 1].role]) {
      invalid(outputsPath, `Output target ${draft.id} steps must be ordered Prepare, Build, then Run.`, draft.line);
    }
  }
  const runSteps = draft.steps.filter(({ role }) => role === "run");
  const downloads = draft.downloads.map((download) => normalizeDownload(download, outputsPath, draft.id));
  if (new Set(downloads.map(({ id }) => id)).size !== downloads.length) {
    invalid(outputsPath, `Output target ${draft.id} contains a duplicate Download id.`, draft.line);
  }
  if (draft.mode === "finite") {
    if (runSteps.length > 0 || draft.presentation || draft.previewIdentity) {
      invalid(outputsPath, `Finite output target ${draft.id} cannot have Run, Presentation, or Preview identity entries.`, draft.line);
    }
    if (downloads.length === 0) {
      invalid(outputsPath, `Finite output target ${draft.id} needs at least one Download.`, draft.line);
    }
  } else if (runSteps.length !== 1 || draft.steps.at(-1).role !== "run") {
    invalid(outputsPath, `Interactive output target ${draft.id} needs exactly one final Run step.`, draft.line);
  } else if (!draft.presentation) {
    invalid(outputsPath, `Interactive output target ${draft.id} needs one Presentation.`, draft.line);
  }
  const presentation = draft.presentation
    ? normalizePresentation(draft.presentation, outputsPath, draft.id)
    : null;
  const placeholders = draft.steps.flatMap(({ argv }) => (
    argv.flatMap((argument) => [...argument.matchAll(PLACEHOLDER)].map((match) => match[1]))
  ));
  if (placeholders.length > 0 && presentation?.kind !== "web") {
    invalid(outputsPath, `Only a web output target may use {host} or {port} placeholders.`, draft.line);
  }
  if (draft.previewIdentity && presentation?.kind !== "web") {
    invalid(outputsPath, `Only a web output target may declare Preview identity.`, draft.line);
  }
  return {
    id: draft.id,
    label: draft.label,
    default: draft.default,
    mode: draft.mode,
    workdir: draft.workdir,
    runtimeRequirements: draft.runtimeRequirements,
    steps: draft.steps,
    presentation,
    downloads,
    ...(draft.previewIdentity
      ? { previewIdentity: normalizePreviewIdentity(draft.previewIdentity, outputsPath, draft.id) }
      : {})
  };
}

function parseVibe64OutputsLines(lines, {
  path: outputsPath = "genesis/stack.md#Outputs"
} = {}) {
  if (!Array.isArray(lines)) {
    invalid(outputsPath, "Outputs must be supplied as exact Stack section lines.");
  }
  if (isExplicitlyEmptyStackSection(lines)) return { version: 1, targets: [] };

  const targets = [];
  let target = null;
  let subsection = "target";
  let subsectionDraft = null;
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    if (!source) continue;
    const line = index + 1;
    const heading = source.match(TARGET_HEADING);
    if (heading) {
      if (target) targets.push(normalizeTarget(target, outputsPath));
      target = targetDraft(heading, outputsPath, line);
      subsection = "target";
      subsectionDraft = null;
      continue;
    }
    if (!target) invalid(outputsPath, "## Outputs must begin with a Target heading.", line);
    if (source === "#### Presentation") {
      if (target.presentation) {
        invalid(outputsPath, "Presentation must appear at most once below an output target.", line);
      }
      target.presentation = presentationDraft(line);
      subsection = "presentation";
      subsectionDraft = target.presentation;
      continue;
    }
    if (source === "#### Preview identity") {
      if (target.previewIdentity) {
        invalid(outputsPath, "Preview identity must appear at most once below an output target.", line);
      }
      target.previewIdentity = previewDraft(line);
      subsection = "previewIdentity";
      subsectionDraft = target.previewIdentity;
      continue;
    }
    const downloadHeading = source.match(DOWNLOAD_HEADING);
    if (downloadHeading) {
      const download = downloadDraft(downloadHeading, outputsPath, line);
      target.downloads.push(download);
      subsection = "download";
      subsectionDraft = download;
      continue;
    }
    if (subsection === "presentation") {
      parsePresentationLine(subsectionDraft, source, outputsPath, line);
    } else if (subsection === "previewIdentity") {
      parsePreviewLine(subsectionDraft, source, outputsPath, line);
    } else if (subsection === "download") {
      parseDownloadLine(subsectionDraft, source, outputsPath, line);
    } else {
      parseTargetLine(target, source, outputsPath, line);
    }
  }
  if (target) targets.push(normalizeTarget(target, outputsPath));
  if (targets.length === 0) {
    invalid(outputsPath, "## Outputs needs at least one Target or exactly `- Nothing.`.");
  }
  const ids = targets.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) invalid(outputsPath, "Outputs contains a duplicate target id.");
  if (targets.filter(({ default: isDefault }) => isDefault).length > 1) {
    invalid(outputsPath, "Outputs may declare at most one default target.");
  }
  return { version: 1, targets };
}

function vibe64OutputsInspection({ environment = {}, section = {} } = {}) {
  assertMatchingStackInspections(section, environment, "Outputs section");
  const sectionDiagnostics = [...(section.diagnostics || [])];
  const environmentDiagnostics = [...(environment.diagnostics || [])];
  let parsed = { version: 1, targets: [] };
  if (section.status === "ready") parsed = parseVibe64OutputsLines(section.lines);
  const disabledReason = environmentDiagnostics.length === 0
    ? null
    : environmentDiagnostics.map(({ message }) => message).join(" ");
  const targets = parsed.targets.map((target) => ({
    ...target,
    source: section.source || null,
    available: sectionDiagnostics.length === 0 && environmentDiagnostics.length === 0,
    disabledReason
  }));
  const diagnostics = [...sectionDiagnostics, ...environmentDiagnostics];
  let status = "ready";
  if (diagnostics.length > 0) status = "blocked";
  else if (targets.length === 0) status = "unconfigured";
  return {
    contract: VIBE64_OUTPUTS_CONTRACT,
    status,
    stackHash: section.stackHash,
    components: [...(section.components || [])],
    environmentDefaults: structuredClone(environment.environmentDefaults || []),
    runtimeRequirements: uniqueSorted(
      targets.flatMap((target) => target.runtimeRequirements)
    ),
    resources: structuredClone(environment.resources || []),
    targets,
    diagnostics
  };
}

export {
  VIBE64_OUTPUTS_CONTRACT,
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  parseVibe64OutputsLines,
  vibe64OutputsInspection
};
