const SUBSYSTEM_ANCHOR_KINDS = Object.freeze(["directory", "file"]);
const SUBSYSTEM_ANCHOR_RELATIONS = Object.freeze(["owns", "implements", "supports", "configures"]);
const SUBSYSTEM_CAPABILITY_DIRECTIONS = Object.freeze(["provides", "requires"]);
const SUBSYSTEM_ORIGINS = Object.freeze(["derived", "inferred", "declared"]);
const SUBSYSTEM_STATUSES = Object.freeze(["current", "proposed", "accepted"]);
const EXECUTION_SIDES = Object.freeze(["unknown", "client", "server", "shared", "external"]);
const CAPABILITY_KIND_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;

function normalizedEnum(value, allowed, fallback, label) {
  const normalized = String(value || fallback || "").trim();
  if (!allowed.includes(normalized)) {
    throw new TypeError(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return normalized;
}

function normalizeSourcePath(value = "", { required = true } = {}) {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "");
  if (!normalized && !required) {
    return "";
  }
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    throw new TypeError(`Subsystem source path must stay inside the active session: ${value || "(empty)"}.`);
  }
  return normalized;
}

function normalizedStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeSubsystemAnchor(anchor = {}, { defaultOrigin = "declared" } = {}) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    throw new TypeError("Subsystem anchors must be objects.");
  }
  return {
    kind: normalizedEnum(anchor.kind, SUBSYSTEM_ANCHOR_KINDS, "directory", "Subsystem anchor kind"),
    path: normalizeSourcePath(anchor.path),
    relation: normalizedEnum(anchor.relation, SUBSYSTEM_ANCHOR_RELATIONS, "owns", "Subsystem anchor relation"),
    origin: normalizedEnum(anchor.origin, SUBSYSTEM_ORIGINS, defaultOrigin, "Subsystem anchor origin"),
    evidenceIds: normalizedStrings(anchor.evidenceIds)
  };
}

function normalizeSubsystemCapability(capability = {}, { defaultOrigin = "declared" } = {}) {
  if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
    throw new TypeError("Subsystem capabilities must be objects.");
  }
  const kind = String(capability.kind || "capability").trim();
  if (!CAPABILITY_KIND_PATTERN.test(kind)) {
    throw new TypeError(`Invalid subsystem capability kind: ${kind || "(empty)"}.`);
  }
  const direction = normalizedEnum(
    capability.direction,
    SUBSYSTEM_CAPABILITY_DIRECTIONS,
    "provides",
    "Subsystem capability direction"
  );
  const value = String(capability.value || "").trim();
  const title = String(capability.title || value || kind).trim();
  const id = String(capability.id || `${direction}:${kind}:${value || title}`).trim();
  if (!id || !title) {
    throw new TypeError("Subsystem capabilities require stable identity and a title.");
  }
  return {
    id,
    kind,
    direction,
    title,
    value,
    description: String(capability.description || "").trim(),
    origin: normalizedEnum(capability.origin, SUBSYSTEM_ORIGINS, defaultOrigin, "Subsystem capability origin"),
    sourcePath: normalizeSourcePath(capability.sourcePath, { required: false }),
    evidenceIds: normalizedStrings(capability.evidenceIds)
  };
}

function subsystemOriginPriority(origin = "") {
  return {
    derived: 1,
    inferred: 2,
    declared: 3
  }[origin] || 0;
}

function mergeByIdentity(current = [], incoming = [], identity) {
  const merged = new Map();
  for (const record of [...current, ...incoming]) {
    const key = identity(record);
    const existing = merged.get(key);
    if (!existing || subsystemOriginPriority(record.origin) >= subsystemOriginPriority(existing.origin)) {
      merged.set(key, record);
    }
  }
  return [...merged.values()].sort((left, right) => identity(left).localeCompare(identity(right)));
}

function mergeSubsystemAnchors(current = [], incoming = []) {
  return mergeByIdentity(current, incoming, (anchor) => `${anchor.kind}:${anchor.path}:${anchor.relation}`);
}

function mergeSubsystemCapabilities(current = [], incoming = []) {
  return mergeByIdentity(current, incoming, (capability) => capability.id);
}

function normalizeSubsystemDefinition(definition = {}, {
  defaultOrigin = "declared",
  requireAnchors = true
} = {}) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError("Subsystem definitions must be objects.");
  }
  const id = String(definition.id || "").trim();
  const title = String(definition.title || id).trim();
  if (!id || !title) {
    throw new TypeError("Subsystem definitions require stable identity and a title.");
  }
  const origin = normalizedEnum(definition.origin, SUBSYSTEM_ORIGINS, defaultOrigin, "Subsystem origin");
  const anchors = (Array.isArray(definition.anchors) ? definition.anchors : [])
    .map((anchor) => normalizeSubsystemAnchor(anchor, { defaultOrigin: origin }));
  if (requireAnchors && anchors.length === 0) {
    throw new TypeError(`Subsystem ${id} requires at least one physical ownership or support anchor.`);
  }
  const capabilities = (Array.isArray(definition.capabilities) ? definition.capabilities : [])
    .map((capability) => normalizeSubsystemCapability(capability, { defaultOrigin: origin }));
  const defaultStatus = origin === "derived" ? "current" : origin === "inferred" ? "proposed" : "accepted";
  return {
    id,
    title,
    description: String(definition.description || "").trim(),
    parentId: String(definition.parentId || "").trim(),
    packageId: String(definition.packageId || "").trim(),
    executionSide: normalizedEnum(definition.executionSide, EXECUTION_SIDES, "unknown", "Subsystem execution side"),
    origin,
    meaningOrigin: normalizedEnum(
      definition.meaningOrigin,
      SUBSYSTEM_ORIGINS,
      origin,
      "Subsystem meaning origin"
    ),
    status: normalizedEnum(definition.status, SUBSYSTEM_STATUSES, defaultStatus, "Subsystem status"),
    authoredBy: String(definition.authoredBy || (origin === "inferred" ? "codex" : origin === "declared" ? "user" : "adapter")).trim(),
    anchors: mergeSubsystemAnchors([], anchors),
    capabilities: mergeSubsystemCapabilities([], capabilities)
  };
}

function assertExclusiveSubsystemOwnership(definitions = []) {
  const ownerByAnchor = new Map();
  for (const definition of definitions) {
    for (const anchor of definition.anchors || []) {
      if (anchor.relation !== "owns") {
        continue;
      }
      const key = `${anchor.kind}:${anchor.path}`;
      const existing = ownerByAnchor.get(key);
      if (existing && existing !== definition.id) {
        throw new TypeError(
          `Subsystem ownership conflict: ${anchor.path} is owned by both ${existing} and ${definition.id}.`
        );
      }
      ownerByAnchor.set(key, definition.id);
    }
  }
  return definitions;
}

function subsystemAnchorMatchesFile(anchor = {}, filePath = "") {
  const normalizedPath = String(filePath || "");
  return anchor.kind === "file"
    ? normalizedPath === anchor.path
    : normalizedPath.startsWith(`${anchor.path}/`);
}

function subsystemAnchorSpecificity(anchor = {}) {
  const segments = String(anchor.path || "").split("/").filter(Boolean).length;
  return segments * 2 + (anchor.kind === "file" ? 1 : 0);
}

export {
  assertExclusiveSubsystemOwnership,
  mergeSubsystemAnchors,
  mergeSubsystemCapabilities,
  normalizeSourcePath,
  normalizeSubsystemAnchor,
  normalizeSubsystemCapability,
  normalizeSubsystemDefinition,
  SUBSYSTEM_ANCHOR_KINDS,
  SUBSYSTEM_ANCHOR_RELATIONS,
  SUBSYSTEM_CAPABILITY_DIRECTIONS,
  SUBSYSTEM_ORIGINS,
  SUBSYSTEM_STATUSES,
  subsystemAnchorMatchesFile,
  subsystemAnchorSpecificity,
  subsystemOriginPriority
};
