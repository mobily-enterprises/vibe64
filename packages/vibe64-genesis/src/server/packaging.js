import {
  assertMatchingStackInspections,
  backtickedArguments,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  oneLineText,
  processArguments,
  projectPath,
  runtimeArguments,
  stackOperationHash,
  unknownEntryMessage
} from "./stackOperation.js";

const VIBE64_PACKAGING_CONTRACT = "vibe64.packaging.v1";
const VIBE64_PACKAGING_SECTION = "Packaging";
// Project files that steer Genesis and coding agents, never what a package
// ships. Releases build from the saved commit without them: a Python flat
// layout then cannot find `genesis/` as a second package, and an npm package
// without a `files` list cannot publish them.
const VIBE64_PACKAGING_SOURCE_EXCLUSIONS = Object.freeze(["genesis", ".genesis", ".agents", ".claude", ".codex", ".opencode"]);
const ERROR_CODE = "VIBE64_PACKAGING_INVALID";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const APPLICATION_ID = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/u;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*$/u;
const DOMAIN_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const PLACEHOLDER = /\{[^{}\s]*\}/u;
const PACKAGE_HEADING = /^### Package `([^`\r\n]+)`:[ \t]+(.+)$/u;
const STEP_LINE = /^- (Prepare|Build) `([^`\r\n]+)`:[ \t]+(.+)$/u;
const ENVIRONMENT_LINE = /^- Environment `([^`\r\n]+)`:[ \t]+(.+)$/u;
const PERMISSION_LINE = /^- Permission `([^`\r\n]+)`:[ \t]+(.+)$/u;
const CONTENT_LINE = /^- Content: package `([^`\r\n]+)`$/u;
const MAX_NAME_LENGTH = 50;
const MAX_PERMISSION_REASON_LENGTH = 500;
// Packaging supplies source facts only; credential-shaped names never belong here.
const CREDENTIAL_ENVIRONMENT_NAME = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|API_KEY|CREDENTIALS?)(?:_|$)/u;

// The closed v1 packer set. A packer appears here only with its implementation.
const PACKERS = Object.freeze({
  npm: Object.freeze({
    entries: ["workdir", "runtimes", "prepare", "build", "environment", "versionFrom"],
    required: ["versionFrom"],
    versionSources: ["package.json", "external"]
  }),
  "python-dist": Object.freeze({
    entries: ["workdir", "runtimes", "prepare", "build", "environment", "output", "versionFrom"],
    required: ["build", "output", "versionFrom"],
    versionSources: ["pyproject.toml", "external"]
  }),
  "web-bundle": Object.freeze({
    entries: ["workdir", "runtimes", "prepare", "build", "environment", "output"],
    required: ["build", "output"],
    versionSources: []
  }),
  capacitor: Object.freeze({
    entries: [
      "workdir", "content", "platforms", "applicationId", "name", "icon", "versionFrom",
      "deepLinkSchemeFrom", "appLinkDomainsFrom", "permission"
    ],
    required: ["content", "platforms", "applicationId", "name", "icon", "versionFrom"],
    versionSources: ["package.json", "external"]
  })
});
const PACKER_IDS = Object.freeze(Object.keys(PACKERS));
const CAPACITOR_PLATFORMS = Object.freeze(["android"]);
const VERSION_SOURCES = Object.freeze(["package.json", "pyproject.toml", "external"]);
const choices = (values) => values.map((value) => `\`${value}\``).join(" | ");

// [entry prefix, field, form shown in errors and the agent spec]
const SINGLE_ENTRIES = Object.freeze([
  ["- Packer: ", "packer", `- Packer: ${choices(PACKER_IDS)}`],
  ["- Workdir: ", "workdir", "- Workdir: `path`"],
  ["- Runtimes: ", "runtimes", "- Runtimes: `runtime`..."],
  ["- Output: ", "output", "- Output: `path`"],
  ["- Version from: ", "versionFrom", `- Version from: ${choices(VERSION_SOURCES)}`],
  ["- Platforms: ", "platforms", `- Platforms: ${choices(CAPACITOR_PLATFORMS)}...`],
  ["- Id: ", "applicationId", "- Id: `reverse.dns.id`"],
  ["- Name: ", "name", "- Name: `Display name`"],
  ["- Icon: ", "icon", "- Icon: `path/to/icon-1024.png`"],
  ["- Deep link scheme from: ", "deepLinkSchemeFrom", "- Deep link scheme from: `ENV_NAME`"],
  ["- App link domains from: ", "appLinkDomainsFrom", "- App link domains from: `ENV_NAME`"]
]);
const PACKAGING_HEADING_FORM = "### Package `id`: Label";
const PACKAGING_ENTRY_FORMS = Object.freeze([
  SINGLE_ENTRIES[0][2],
  SINGLE_ENTRIES[1][2],
  SINGLE_ENTRIES[2][2],
  "- Prepare|Build `label`: `command` `argument`...",
  "- Environment `NAME`: `value`",
  SINGLE_ENTRIES[3][2],
  SINGLE_ENTRIES[4][2],
  "- Content: package `web-bundle-id`",
  ...SINGLE_ENTRIES.slice(5).map(([, , form]) => form),
  "- Permission `id`: User-facing reason."
]);
const ENTRY_LABELS = Object.freeze({
  packer: "Packer",
  workdir: "Workdir",
  runtimes: "Runtimes",
  prepare: "Prepare",
  build: "Build",
  environment: "Environment",
  output: "Output",
  versionFrom: "Version from",
  content: "Content",
  platforms: "Platforms",
  applicationId: "Id",
  name: "Name",
  icon: "Icon",
  deepLinkSchemeFrom: "Deep link scheme from",
  appLinkDomainsFrom: "App link domains from",
  permission: "Permission"
});

function invalid(packagingPath, message, line) {
  invalidStackOperation(ERROR_CODE, packagingPath, message, line);
}

function packageId(value, packagingPath, label, line) {
  const id = oneLineText(value, ERROR_CODE, packagingPath, label, line);
  if (!ID_PATTERN.test(id)) invalid(packagingPath, `${label} must use lowercase letters, digits, and single hyphens.`, line);
  return id;
}

function oneToken(source, prefix, packagingPath, label, line) {
  return backtickedArguments(source.slice(prefix.length), ERROR_CODE, packagingPath, label, line, { count: 1 })[0];
}

function noPlaceholder(values, packagingPath, label, line) {
  if (values.some((value) => PLACEHOLDER.test(value))) {
    invalid(packagingPath, `${label} takes no placeholders in ${VIBE64_PACKAGING_CONTRACT}.`, line);
  }
  return values;
}

function environmentName(value, packagingPath, label, line) {
  if (!ENVIRONMENT_NAME.test(value)) invalid(packagingPath, `${label} must be an uppercase environment variable name.`, line);
  return value;
}

function setOnce(draft, field, value, packagingPath, line) {
  if (draft.seen.has(field)) invalid(packagingPath, `Package ${draft.id} has a duplicate ${ENTRY_LABELS[field]} entry.`, line);
  draft.seen.add(field);
  draft.fields[field] = value;
  draft.lines[field] = line;
}

function singleValue(field, source, prefix, packagingPath, line) {
  const label = `Packaging ${ENTRY_LABELS[field]}`;
  if (field === "runtimes") {
    return runtimeArguments(source.slice(prefix.length), ERROR_CODE, packagingPath, label, line);
  }
  if (field === "platforms") {
    const platforms = backtickedArguments(source.slice(prefix.length), ERROR_CODE, packagingPath, label, line);
    if (platforms.some((platform) => !CAPACITOR_PLATFORMS.includes(platform))) {
      invalid(packagingPath, `${label} must be ${choices(CAPACITOR_PLATFORMS)}.`, line);
    }
    if (new Set(platforms).size !== platforms.length) invalid(packagingPath, `${label} contains a duplicate platform.`, line);
    return platforms;
  }
  const value = noPlaceholder([oneToken(source, prefix, packagingPath, label, line)], packagingPath, label, line)[0];
  if (field === "packer") {
    if (!PACKER_IDS.includes(value)) {
      invalid(packagingPath, `Unknown packer \`${value}\`. ${VIBE64_PACKAGING_CONTRACT} packers are ${choices(PACKER_IDS)}.`, line);
    }
    return value;
  }
  if (["workdir", "output"].includes(field)) {
    return projectPath(value, ERROR_CODE, packagingPath, label, line, { allowRoot: field === "workdir" });
  }
  if (field === "icon") {
    const icon = projectPath(value, ERROR_CODE, packagingPath, label, line, { allowRoot: false });
    if (!icon.toLowerCase().endsWith(".png")) invalid(packagingPath, `${label} must be a 1024x1024 PNG file.`, line);
    return icon;
  }
  if (field === "versionFrom") {
    if (!VERSION_SOURCES.includes(value)) invalid(packagingPath, `${label} must be ${choices(VERSION_SOURCES)}.`, line);
    return value;
  }
  if (field === "applicationId") {
    if (!APPLICATION_ID.test(value) || value.length > 150) {
      invalid(packagingPath, `${label} must be a reverse-DNS id such as \`com.example.notes\` (letters, digits and underscores; each part starts with a letter).`, line);
    }
    return value;
  }
  if (field === "name") {
    if (value.trim() !== value || value.length > MAX_NAME_LENGTH) {
      invalid(packagingPath, `${label} must be at most ${MAX_NAME_LENGTH} characters without surrounding spaces.`, line);
    }
    return value;
  }
  return environmentName(value, packagingPath, label, line);
}

function packageDraft(match, packagingPath, line) {
  return {
    id: packageId(match[1], packagingPath, "Package id", line),
    label: oneLineText(match[2], ERROR_CODE, packagingPath, "Package label", line),
    fields: {},
    lines: {},
    prepare: [],
    build: [],
    environment: [],
    permissions: [],
    seen: new Set(),
    line
  };
}

function parsePackageLine(draft, source, packagingPath, line) {
  if (/^- Plugins?\b/u.test(source)) {
    invalid(packagingPath, "Packaging takes no Plugin list: the generated shell installs the native plugins of the Content package at its lockfile versions.", line);
  }
  for (const [prefix, field] of SINGLE_ENTRIES) {
    if (source.startsWith(prefix)) {
      setOnce(draft, field, singleValue(field, source, prefix, packagingPath, line), packagingPath, line);
      return;
    }
  }
  const content = source.match(CONTENT_LINE);
  if (content) {
    setOnce(draft, "content", packageId(content[1], packagingPath, "Packaging Content package", line), packagingPath, line);
    return;
  }
  const step = source.match(STEP_LINE);
  if (step) {
    const role = step[1].toLowerCase();
    const label = `Packaging ${step[1]} command`;
    draft[role].push({
      label: oneLineText(step[2], ERROR_CODE, packagingPath, `Packaging ${step[1]} label`, line),
      argv: noPlaceholder(processArguments(step[3], ERROR_CODE, packagingPath, label, line), packagingPath, label, line)
    });
    draft.lines[role] ??= line;
    return;
  }
  const environment = source.match(ENVIRONMENT_LINE);
  if (environment) {
    const name = environmentName(environment[1], packagingPath, "Packaging Environment name", line);
    if (CREDENTIAL_ENVIRONMENT_NAME.test(name)) {
      invalid(packagingPath, `Packaging Environment ${name} looks like a credential. Packaging holds only non-secret build facts.`, line);
    }
    if (draft.environment.some((entry) => entry.name === name)) {
      invalid(packagingPath, `Package ${draft.id} has a duplicate Environment ${name}.`, line);
    }
    const value = noPlaceholder(
      backtickedArguments(environment[2], ERROR_CODE, packagingPath, "Packaging Environment value", line, { count: 1 }),
      packagingPath,
      "Packaging Environment value",
      line
    )[0];
    draft.environment.push({ name, value });
    draft.lines.environment ??= line;
    return;
  }
  const permission = source.match(PERMISSION_LINE);
  if (permission) {
    const id = packageId(permission[1], packagingPath, "Packaging Permission id", line);
    const reason = oneLineText(permission[2], ERROR_CODE, packagingPath, "Packaging Permission reason", line);
    if (reason.includes("`") || reason.length > MAX_PERMISSION_REASON_LENGTH) {
      invalid(packagingPath, `Packaging Permission reason is plain user-facing text of at most ${MAX_PERMISSION_REASON_LENGTH} characters.`, line);
    }
    if (draft.permissions.some((entry) => entry.id === id)) invalid(packagingPath, `Package ${draft.id} has a duplicate Permission ${id}.`, line);
    draft.permissions.push({ id, reason });
    draft.lines.permission ??= line;
    return;
  }
  invalid(packagingPath, unknownEntryMessage("Packaging entry", source, PACKAGING_ENTRY_FORMS), line);
}

function normalizePackage(draft, packagingPath) {
  const packerId = draft.fields.packer;
  if (!packerId) invalid(packagingPath, `Package ${draft.id} needs a Packer entry: ${choices(PACKER_IDS)}.`, draft.line);
  const packer = PACKERS[packerId];
  const present = new Set([
    ...Object.keys(draft.fields).filter((field) => field !== "packer"),
    ...["prepare", "build", "environment"].filter((field) => draft[field].length),
    ...(draft.permissions.length ? ["permission"] : [])
  ]);
  for (const field of present) {
    if (!packer.entries.includes(field)) {
      invalid(packagingPath, `The ${packerId} packer takes no ${ENTRY_LABELS[field]} entry.`, draft.lines[field]);
    }
  }
  for (const field of packer.required) {
    if (!present.has(field)) invalid(packagingPath, `Package ${draft.id} (${packerId}) needs ${/^[AEIOU]/u.test(ENTRY_LABELS[field]) ? "an" : "a"} ${ENTRY_LABELS[field]} entry.`, draft.line);
  }
  if (draft.fields.versionFrom && !packer.versionSources.includes(draft.fields.versionFrom)) {
    invalid(packagingPath, `The ${packerId} packer reads its version from ${choices(packer.versionSources)}.`, draft.lines.versionFrom);
  }
  const normalized = {
    id: draft.id,
    label: draft.label,
    packer: packerId,
    workdir: draft.fields.workdir || ".",
    runtimeRequirements: draft.fields.runtimes || [],
    prepare: draft.prepare,
    build: draft.build,
    environment: draft.environment,
    output: draft.fields.output || null,
    versionFrom: draft.fields.versionFrom || null
  };
  if (packerId !== "capacitor") return normalized;
  return {
    ...normalized,
    content: draft.fields.content,
    platforms: draft.fields.platforms,
    application: {
      id: draft.fields.applicationId,
      name: draft.fields.name,
      icon: draft.fields.icon
    },
    deepLinkSchemeFrom: draft.fields.deepLinkSchemeFrom || null,
    appLinkDomainsFrom: draft.fields.appLinkDomainsFrom || null,
    permissions: draft.permissions
  };
}

function parseVibe64PackagingLines(lines, {
  path: packagingPath = "genesis/stack.md#Packaging"
} = {}) {
  if (!Array.isArray(lines)) invalid(packagingPath, "Packaging must be supplied as exact Stack section lines.");
  if (isExplicitlyEmptyStackSection(lines)) return { version: 1, packages: [] };
  const drafts = [];
  let draft = null;
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    if (!source) continue;
    const line = index + 1;
    const heading = source.match(PACKAGE_HEADING);
    if (heading) {
      draft = packageDraft(heading, packagingPath, line);
      drafts.push(draft);
      continue;
    }
    if (source.startsWith("#")) invalid(packagingPath, `Unknown Packaging heading: ${source}. Use ${PACKAGING_HEADING_FORM}.`, line);
    if (!draft) invalid(packagingPath, `Packaging entries belong under ${PACKAGING_HEADING_FORM}.`, line);
    parsePackageLine(draft, source, packagingPath, line);
  }
  if (drafts.length === 0) invalid(packagingPath, "## Packaging needs at least one Package or exactly `- Nothing.`.");
  const packages = drafts.map((entry) => normalizePackage(entry, packagingPath));
  const byId = new Map();
  for (const entry of packages) {
    if (byId.has(entry.id)) invalid(packagingPath, `Packaging contains a duplicate package id ${entry.id}.`);
    byId.set(entry.id, entry);
  }
  const applicationIds = new Set();
  for (const entry of packages.filter(({ packer }) => packer === "capacitor")) {
    const content = byId.get(entry.content);
    if (!content || content.packer !== "web-bundle") {
      invalid(packagingPath, `Package ${entry.id} Content must name a web-bundle package declared in Packaging.`);
    }
    if (applicationIds.has(entry.application.id)) invalid(packagingPath, `Packaging declares application id ${entry.application.id} twice.`);
    applicationIds.add(entry.application.id);
  }
  return { version: 1, packages };
}

function environmentDefaultValue(environmentDefaults, name, packagingPath, label) {
  const entry = (Array.isArray(environmentDefaults) ? environmentDefaults : []).find((candidate) => candidate?.name === name);
  if (!entry || typeof entry.value !== "string" || !entry.value.trim()) {
    invalid(packagingPath, `${label} names ${name}, which ## Environment defaults does not declare with a value.`);
  }
  return entry.value.trim();
}

// Schemes and app-link domains are runtime facts the server also reads; Packaging
// only names their variables, and the packer reads the same normalized values.
function resolveVibe64PackagingEnvironment(packaging, environmentDefaults = [], {
  path: packagingPath = "genesis/stack.md#Packaging"
} = {}) {
  return {
    ...packaging,
    packages: packaging.packages.map((entry) => {
      if (entry.packer !== "capacitor") return entry;
      const resolved = { ...entry, deepLinkScheme: null, appLinkDomains: [] };
      if (entry.deepLinkSchemeFrom) {
        const scheme = environmentDefaultValue(environmentDefaults, entry.deepLinkSchemeFrom, packagingPath, `Package ${entry.id} Deep link scheme from`);
        if (!URL_SCHEME.test(scheme) || ["http", "https", "file", "content", "javascript"].includes(scheme)) {
          invalid(packagingPath, `${entry.deepLinkSchemeFrom} must be a custom lowercase URL scheme such as \`notes\`.`);
        }
        resolved.deepLinkScheme = scheme;
      }
      if (entry.appLinkDomainsFrom) {
        const domains = environmentDefaultValue(environmentDefaults, entry.appLinkDomainsFrom, packagingPath, `Package ${entry.id} App link domains from`)
          .split(/[\s,]+/u)
          .filter(Boolean);
        if (domains.some((domain) => !DOMAIN_NAME.test(domain))) {
          invalid(packagingPath, `${entry.appLinkDomainsFrom} must list lowercase domain names separated by commas or spaces.`);
        }
        resolved.appLinkDomains = [...new Set(domains)];
      }
      return resolved;
    })
  };
}

function vibe64PackagingInspection({ environment = {}, section = {} } = {}) {
  assertMatchingStackInspections(section, environment, "Packaging section");
  const diagnostics = [...(section.diagnostics || [])];
  let parsed = { version: 1, packages: [] };
  if (section.status === "ready") {
    parsed = resolveVibe64PackagingEnvironment(parseVibe64PackagingLines(section.lines), environment.environmentDefaults);
  }
  const status = diagnostics.length > 0 ? "blocked" : parsed.packages.length > 0 ? "ready" : "unconfigured";
  return {
    contract: VIBE64_PACKAGING_CONTRACT,
    status,
    stackHash: section.stackHash,
    packagingHash: status === "ready" ? stackOperationHash(parsed) : "",
    source: section.source || null,
    version: parsed.version,
    packages: parsed.packages,
    diagnostics
  };
}

export {
  PACKAGING_ENTRY_FORMS,
  PACKAGING_HEADING_FORM,
  PACKER_IDS as VIBE64_PACKAGING_PACKERS,
  CAPACITOR_PLATFORMS as VIBE64_PACKAGING_PLATFORMS,
  VIBE64_PACKAGING_CONTRACT,
  VIBE64_PACKAGING_SECTION,
  VIBE64_PACKAGING_SOURCE_EXCLUSIONS,
  parseVibe64PackagingLines,
  resolveVibe64PackagingEnvironment,
  vibe64PackagingInspection
};
