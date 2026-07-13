const SYSTEM_CONNECTION_KINDS = Object.freeze([
  "import",
  "injection",
  "declaration"
]);

const SYSTEM_CONNECTION_KIND_SET = new Set(SYSTEM_CONNECTION_KINDS);

function normalizeConnectionEndpoint(endpoint = {}) {
  return {
    subsystemId: String(endpoint.subsystemId || ""),
    fileId: String(endpoint.fileId || ""),
    externalId: String(endpoint.externalId || "")
  };
}

function normalizeSystemConnection(connection = {}) {
  const kind = String(connection.kind || "");
  if (!SYSTEM_CONNECTION_KIND_SET.has(kind)) {
    throw new TypeError(`Unsupported system connection kind: ${kind || "missing"}.`);
  }
  const source = normalizeConnectionEndpoint(connection.source);
  const target = normalizeConnectionEndpoint(connection.target);
  if (!source.subsystemId && !source.fileId) {
    throw new TypeError("System connection source must identify a subsystem or file.");
  }
  if (!target.subsystemId && !target.fileId && !target.externalId) {
    throw new TypeError("System connection target must identify a subsystem, file, or external reference.");
  }
  return {
    id: String(connection.id || ""),
    kind,
    origin: String(connection.origin || "derived"),
    source,
    target,
    reference: String(connection.reference || ""),
    symbols: [...new Set((connection.symbols || []).map(String).filter(Boolean))].sort(),
    evidenceIds: [...new Set((connection.evidenceIds || []).map(String).filter(Boolean))].sort(),
    line: Math.max(0, Number(connection.line) || 0)
  };
}

export {
  SYSTEM_CONNECTION_KINDS,
  normalizeSystemConnection
};
