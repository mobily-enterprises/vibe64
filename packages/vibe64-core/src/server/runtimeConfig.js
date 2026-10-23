import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "./core.js";

const RUNTIME_CONFIG_OWNERS = Object.freeze({
  SYSTEM: "system",
  USER: "user"
});
const RUNTIME_CONFIG_SCOPES = Object.freeze({
  DEV: "dev",
  PROD: "prod"
});
const RUNTIME_CONFIG_PHASES = Object.freeze({
  CLIENT_BUILD: "client-build",
  DEPLOY: "deploy",
  GENERATE: "generate",
  INSTALL: "install",
  MIGRATE: "migrate",
  OUTPUT: "output",
  PREVIEW: "preview",
  SERVER: "server"
});
const RUNTIME_CONFIG_TARGETS = Object.freeze({
  CHECKS: "checks",
  COMMAND: "command",
  OUTPUT_TARGET: "output-target",
  SERVER: "server"
});
const RUNTIME_CONFIG_OWNER_VALUES = new Set(Object.values(RUNTIME_CONFIG_OWNERS));
const RUNTIME_CONFIG_SCOPE_VALUES = new Set(Object.values(RUNTIME_CONFIG_SCOPES));
const RUNTIME_CONFIG_PHASE_VALUES = new Set(Object.values(RUNTIME_CONFIG_PHASES));
const RUNTIME_CONFIG_TARGET_VALUES = new Set(Object.values(RUNTIME_CONFIG_TARGETS));
const RUNTIME_CONFIG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RUNTIME_CONFIG_VIBE64_RESERVED_PREFIX = "VIBE64_";
const RUNTIME_CONFIG_SECRET_KEY_PARTS = new Set([
  "CREDENTIAL",
  "DSN",
  "KEY",
  "PASS",
  "PASSWORD",
  "PWD",
  "SECRET",
  "TOKEN"
]);
const REDACTED_RUNTIME_CONFIG_VALUE = "********";
const RUNTIME_CONFIG_LABEL_MAX_LENGTH = 200;

function runtimeConfigError(message, code) {
  return vibe64Error(message, code);
}

function normalizeRuntimeConfigKey(key = "") {
  const normalizedKey = normalizeText(key);
  if (!RUNTIME_CONFIG_KEY_PATTERN.test(normalizedKey)) {
    throw runtimeConfigError(
      `Invalid runtime config key: ${normalizedKey || "(empty)"}`,
      "vibe64_runtime_config_key_invalid"
    );
  }
  return normalizedKey;
}

function normalizeRuntimeConfigOwner(owner = RUNTIME_CONFIG_OWNERS.USER) {
  const normalizedOwner = normalizeText(owner || RUNTIME_CONFIG_OWNERS.USER);
  if (!RUNTIME_CONFIG_OWNER_VALUES.has(normalizedOwner)) {
    throw runtimeConfigError(
      `Invalid runtime config owner: ${normalizedOwner || "(empty)"}`,
      "vibe64_runtime_config_owner_invalid"
    );
  }
  return normalizedOwner;
}

function normalizeRuntimeConfigScope(scope = RUNTIME_CONFIG_SCOPES.DEV) {
  const normalizedScope = normalizeText(scope || RUNTIME_CONFIG_SCOPES.DEV);
  if (!RUNTIME_CONFIG_SCOPE_VALUES.has(normalizedScope)) {
    throw runtimeConfigError(
      `Invalid runtime config scope: ${normalizedScope || "(empty)"}`,
      "vibe64_runtime_config_scope_invalid"
    );
  }
  return normalizedScope;
}

function normalizeRuntimeConfigPhase(phase = "") {
  const normalizedPhase = normalizeText(phase);
  if (!RUNTIME_CONFIG_PHASE_VALUES.has(normalizedPhase)) {
    throw runtimeConfigError(
      `Invalid runtime config phase: ${normalizedPhase || "(empty)"}`,
      "vibe64_runtime_config_phase_invalid"
    );
  }
  return normalizedPhase;
}

function normalizeRuntimeConfigPhases(phases = []) {
  return [...new Set((Array.isArray(phases) ? phases : [])
    .map(normalizeRuntimeConfigPhase))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeRuntimeConfigTarget(target = "") {
  const normalizedTarget = normalizeText(target);
  if (!RUNTIME_CONFIG_TARGET_VALUES.has(normalizedTarget)) {
    throw runtimeConfigError(
      `Invalid runtime config target: ${normalizedTarget || "(empty)"}`,
      "vibe64_runtime_config_target_invalid"
    );
  }
  return normalizedTarget;
}

function normalizeRuntimeConfigTargets(targets = []) {
  return [...new Set((Array.isArray(targets) ? targets : [])
    .map(normalizeRuntimeConfigTarget))]
    .sort((left, right) => left.localeCompare(right));
}

function runtimeConfigKeyLooksSecret(key = "") {
  const parts = normalizeText(key).split(/[^A-Za-z0-9]+/u).filter(Boolean);
  return parts.includes("DATABASE") && parts.includes("URL") ||
    parts.some((part) => RUNTIME_CONFIG_SECRET_KEY_PARTS.has(part));
}

function runtimeConfigKeyIsVibe64Reserved(key = "") {
  return normalizeText(key).startsWith(RUNTIME_CONFIG_VIBE64_RESERVED_PREFIX);
}

// A display-only provenance line a host may give a record it supplies.
function normalizeRuntimeConfigLabel(label) {
  if (label === undefined || label === null || label === "") return "";
  if (typeof label !== "string" || label.length > RUNTIME_CONFIG_LABEL_MAX_LENGTH || /[\r\n]/u.test(label)) {
    throw runtimeConfigError(
      `Runtime config labels must be one line of up to ${RUNTIME_CONFIG_LABEL_MAX_LENGTH} characters.`,
      "vibe64_runtime_config_label_invalid"
    );
  }
  return label.trim();
}

function normalizeRuntimeConfigRecord(record = {}) {
  if (!isPlainObject(record)) {
    throw runtimeConfigError("Runtime config records must be objects.", "vibe64_runtime_config_record_invalid");
  }
  const key = normalizeRuntimeConfigKey(record.key);
  const owner = normalizeRuntimeConfigOwner(record.owner);
  const secret = record.secret === undefined
    ? runtimeConfigKeyLooksSecret(key)
    : record.secret === true;
  const label = normalizeRuntimeConfigLabel(record.label);
  return {
    editable: record.editable === undefined ? owner === RUNTIME_CONFIG_OWNERS.USER : record.editable === true,
    key,
    ...(label ? { label } : {}),
    owner,
    requiredFor: normalizeRuntimeConfigPhases(record.requiredFor),
    scope: normalizeRuntimeConfigScope(record.scope),
    secret,
    source: normalizeText(record.source),
    targets: normalizeRuntimeConfigTargets(record.targets),
    value: String(record.value ?? ""),
    valuePresent: record.valuePresent === undefined
      ? String(record.value ?? "").length > 0
      : record.valuePresent === true
  };
}

function runtimeConfigRecordSort(left, right) {
  return left.scope.localeCompare(right.scope) ||
    left.key.localeCompare(right.key) ||
    left.owner.localeCompare(right.owner) ||
    left.source.localeCompare(right.source);
}

function mergeRuntimeConfigRecords(records = []) {
  const byScopeKey = new Map();
  for (const record of (Array.isArray(records) ? records : [])) {
    const normalizedRecord = normalizeRuntimeConfigRecord(record);
    const recordKey = `${normalizedRecord.scope}\0${normalizedRecord.key}`;
    const existingRecord = byScopeKey.get(recordKey);
    if (!runtimeConfigRecordCanReplace(existingRecord, normalizedRecord)) {
      continue;
    }
    byScopeKey.set(recordKey, normalizedRecord);
  }
  return [...byScopeKey.values()].sort(runtimeConfigRecordSort);
}

function runtimeConfigRecordCanReplace(existingRecord = null, incomingRecord = {}) {
  if (!existingRecord) {
    return true;
  }
  if (incomingRecord.owner === RUNTIME_CONFIG_OWNERS.USER && existingRecord.owner !== RUNTIME_CONFIG_OWNERS.USER) {
    return false;
  }
  if (incomingRecord.owner === RUNTIME_CONFIG_OWNERS.USER && existingRecord.editable !== true) {
    return false;
  }
  return true;
}

function resolveRuntimeConfig(records = [], context = {}) {
  if (!Array.isArray(records)) {
    throw runtimeConfigError(
      "Runtime config resolution requires a records array.",
      "vibe64_runtime_config_records_invalid"
    );
  }
  const options = isPlainObject(context) ? context : {};
  const normalizedRecords = mergeRuntimeConfigRecords(records);
  const scope = normalizeRuntimeConfigScope(options.scope || RUNTIME_CONFIG_SCOPES.DEV);
  const phases = normalizeRuntimeConfigPhases(Array.isArray(options.phases)
    ? options.phases
    : options.phase
      ? [options.phase]
      : []);
  const target = normalizeText(options.target);
  const missing = missingRuntimeConfigRecords(normalizedRecords, {
    phases,
    scope,
    target
  });
  return {
    missing,
    ok: missing.length === 0,
    phases,
    records: normalizedRecords,
    scope,
    target,
    values: runtimeConfigEnv(normalizedRecords, {
      scope,
      target
    }),
    view: runtimeConfigViewModel({
      missing,
      records: normalizedRecords,
      scope,
      target
    })
  };
}

function runtimeConfigRecordMatchesTarget(record = {}, target = "") {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return true;
  }
  const targets = Array.isArray(record.targets) ? record.targets : [];
  return targets.length === 0 || targets.includes(normalizedTarget);
}

function runtimeConfigRecordsForScope(records = [], scope = RUNTIME_CONFIG_SCOPES.DEV, {
  target = ""
} = {}) {
  const normalizedScope = normalizeRuntimeConfigScope(scope);
  return mergeRuntimeConfigRecords(records)
    .filter((record) => (
      record.scope === normalizedScope &&
      runtimeConfigRecordMatchesTarget(record, target)
    ));
}

function runtimeConfigEnv(records = [], {
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  target = ""
} = {}) {
  return Object.fromEntries(runtimeConfigRecordsForScope(records, scope, {
    target
  })
    .map((record) => [record.key, record.value]));
}

function missingRuntimeConfigRecords(records = [], {
  phases = [],
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  target = ""
} = {}) {
  const requiredPhases = new Set(normalizeRuntimeConfigPhases(phases));
  if (requiredPhases.size === 0) {
    return [];
  }
  return runtimeConfigRecordsForScope(records, scope, {
    target
  })
    .filter((record) => {
      if (record.requiredFor.length === 0) {
        return false;
      }
      if (!record.requiredFor.some((phase) => requiredPhases.has(phase))) {
        return false;
      }
      return record.valuePresent !== true;
    })
    .map((record) => ({
      key: record.key,
      owner: record.owner,
      requiredFor: record.requiredFor,
      scope: record.scope,
      source: record.source
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function redactRuntimeConfigValue(record = {}) {
  return record.secret ? REDACTED_RUNTIME_CONFIG_VALUE : record.value;
}

function runtimeConfigViewRecord(record = {}, {
  missingKeys = new Set()
} = {}) {
  const normalizedRecord = normalizeRuntimeConfigRecord(record);
  return {
    editable: normalizedRecord.editable,
    key: normalizedRecord.key,
    ...(normalizedRecord.label ? { label: normalizedRecord.label } : {}),
    missing: missingKeys.has(normalizedRecord.key),
    owner: normalizedRecord.owner,
    requiredFor: normalizedRecord.requiredFor,
    scope: normalizedRecord.scope,
    secret: normalizedRecord.secret,
    source: normalizedRecord.source,
    value: redactRuntimeConfigValue(normalizedRecord),
    valuePresent: normalizedRecord.valuePresent === true
  };
}

function runtimeConfigViewModel({
  missing = [],
  records = [],
  scope = RUNTIME_CONFIG_SCOPES.DEV,
  target = ""
} = {}) {
  const missingKeys = new Set((Array.isArray(missing) ? missing : []).map((entry) => entry.key));
  return {
    records: runtimeConfigRecordsForScope(records, scope, {
      target
    })
      .map((record) => runtimeConfigViewRecord(record, {
        missingKeys
      })),
    scope: normalizeRuntimeConfigScope(scope)
  };
}

function runtimeConfigEnvViewModel(config = {}) {
  const source = isPlainObject(config) ? config : {};
  const scope = normalizeRuntimeConfigScope(source.scope || RUNTIME_CONFIG_SCOPES.DEV);
  const view = isPlainObject(source.view)
    ? source.view
    : runtimeConfigViewModel({
        missing: source.missing,
        records: source.records,
        scope,
        target: normalizeText(source.target)
      });
  return {
    environment: scope,
    records: Array.isArray(view.records) ? view.records : [],
    unavailable: source.unavailable || null
  };
}

export {
  REDACTED_RUNTIME_CONFIG_VALUE,
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  RUNTIME_CONFIG_TARGETS,
  mergeRuntimeConfigRecords,
  missingRuntimeConfigRecords,
  normalizeRuntimeConfigKey,
  normalizeRuntimeConfigOwner,
  normalizeRuntimeConfigPhase,
  normalizeRuntimeConfigPhases,
  normalizeRuntimeConfigRecord,
  normalizeRuntimeConfigScope,
  normalizeRuntimeConfigTarget,
  normalizeRuntimeConfigTargets,
  resolveRuntimeConfig,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigKeyLooksSecret,
  runtimeConfigRecordsForScope,
  runtimeConfigViewRecord,
  runtimeConfigViewModel
};
