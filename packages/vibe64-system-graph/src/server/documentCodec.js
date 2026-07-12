const SYSTEM_DOCUMENT_SCHEMA_VERSION = 1;

const ENTITY_KINDS = Object.freeze(["system", "subsystem", "component", "interface", "operation"]);
const RELATIONSHIP_KINDS = Object.freeze([
  "contains",
  "depends_on",
  "provides",
  "consumes",
  "handles",
  "implemented_by"
]);
const EXECUTION_SIDES = Object.freeze(["unknown", "client", "server", "shared", "external"]);
const ORIGINS = Object.freeze(["derived", "declared", "observed", "inferred"]);
const SEVERITIES = Object.freeze(["info", "low", "medium", "high"]);
const IMPORT_KINDS = Object.freeze(["import", "export", "require", "dynamic-import"]);
const IMPORT_CLASSIFICATIONS = Object.freeze([
  "unresolved",
  "local-file",
  "cross-package",
  "package-specifier",
  "external-package",
  "local-asset"
]);

function enumCode(values, value, fallback = 0) {
  const index = values.indexOf(String(value || ""));
  return index < 0 ? fallback : index;
}

function enumValue(values, code, fallback = "") {
  return values[Number(code)] || fallback || values[0] || "";
}

function collectStrings(value, target) {
  if (typeof value === "string") {
    if (value) {
      target.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, target);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const entry of Object.values(value)) {
    collectStrings(entry, target);
  }
}

function stringCodec(model = {}) {
  const values = new Set();
  for (const tableName of ["files", "entities", "relationships", "evidence", "findings", "diagnostics"]) {
    collectStrings(model[tableName], values);
  }
  const strings = [...values].sort((left, right) => left.localeCompare(right));
  const indexes = new Map(strings.map((value, index) => [value, index + 1]));
  return {
    strings,
    encode: (value = "") => indexes.get(String(value || "")) || 0,
    decode: (index = 0) => strings[Number(index) - 1] || ""
  };
}

function encodeImport(record, stringIndex) {
  return [
    enumCode(IMPORT_KINDS, record.kind),
    stringIndex(record.specifier),
    enumCode(IMPORT_CLASSIFICATIONS, record.classification),
    stringIndex(record.targetFile),
    stringIndex(record.targetPackageId),
    Math.max(0, Number(record.line) || 0)
  ];
}

function decodeImport(record, stringValue) {
  return {
    kind: enumValue(IMPORT_KINDS, record[0], "import"),
    specifier: stringValue(record[1]),
    classification: enumValue(IMPORT_CLASSIFICATIONS, record[2], "unresolved"),
    targetFile: stringValue(record[3]),
    targetPackageId: stringValue(record[4]),
    line: Math.max(0, Number(record[5]) || 0)
  };
}

function encodeFile(file, stringIndex) {
  return [
    stringIndex(file.id),
    stringIndex(file.path),
    stringIndex(file.hash),
    Math.max(0, Number(file.bytes) || 0),
    Math.max(0, Number(file.lines) || 0),
    stringIndex(file.packageId),
    enumCode(EXECUTION_SIDES, file.executionSide),
    (file.imports || []).map((record) => encodeImport(record, stringIndex)),
    (file.implementedEntityIds || []).map(stringIndex)
  ];
}

function decodeFile(file, stringValue) {
  return {
    id: stringValue(file[0]),
    path: stringValue(file[1]),
    hash: stringValue(file[2]),
    bytes: Math.max(0, Number(file[3]) || 0),
    lines: Math.max(0, Number(file[4]) || 0),
    packageId: stringValue(file[5]),
    executionSide: enumValue(EXECUTION_SIDES, file[6], "unknown"),
    imports: (file[7] || []).map((record) => decodeImport(record, stringValue)),
    implementedEntityIds: (file[8] || []).map(stringValue).filter(Boolean)
  };
}

function encodeEntityMetadata(metadata = {}, stringIndex) {
  return [
    stringIndex(metadata.packageId),
    stringIndex(metadata.method),
    stringIndex(metadata.path),
    stringIndex(metadata.summary),
    stringIndex(metadata.sourcePath),
    Math.max(0, Number(metadata.sourceLine) || 0),
    metadata.inputKnown === true ? 1 : 0,
    metadata.outputKnown === true ? 1 : 0,
    stringIndex(metadata.descriptorPath),
    (metadata.executionSides || []).map((side) => enumCode(EXECUTION_SIDES, side))
  ];
}

function decodeEntityMetadata(metadata = [], stringValue) {
  return {
    packageId: stringValue(metadata[0]),
    method: stringValue(metadata[1]),
    path: stringValue(metadata[2]),
    summary: stringValue(metadata[3]),
    sourcePath: stringValue(metadata[4]),
    sourceLine: Math.max(0, Number(metadata[5]) || 0),
    inputKnown: metadata[6] === 1,
    outputKnown: metadata[7] === 1,
    descriptorPath: stringValue(metadata[8]),
    executionSides: (metadata[9] || []).map((code) => enumValue(EXECUTION_SIDES, code, "unknown"))
  };
}

function encodeEntity(entity, stringIndex) {
  return [
    stringIndex(entity.id),
    enumCode(ENTITY_KINDS, entity.kind),
    enumCode(ORIGINS, entity.origin),
    stringIndex(entity.title),
    stringIndex(entity.parentId),
    enumCode(EXECUTION_SIDES, entity.executionSide),
    stringIndex(entity.description),
    encodeEntityMetadata(entity.metadata, stringIndex)
  ];
}

function decodeEntity(entity, stringValue) {
  return {
    id: stringValue(entity[0]),
    kind: enumValue(ENTITY_KINDS, entity[1], "component"),
    origin: enumValue(ORIGINS, entity[2], "derived"),
    title: stringValue(entity[3]),
    parentId: stringValue(entity[4]),
    executionSide: enumValue(EXECUTION_SIDES, entity[5], "unknown"),
    description: stringValue(entity[6]),
    metadata: decodeEntityMetadata(entity[7], stringValue)
  };
}

function encodeRelationship(relationship, stringIndex) {
  return [
    stringIndex(relationship.id),
    enumCode(RELATIONSHIP_KINDS, relationship.kind),
    enumCode(ORIGINS, relationship.origin),
    stringIndex(relationship.from),
    stringIndex(relationship.to),
    stringIndex(relationship.value),
    stringIndex(relationship.packageId),
    (relationship.evidenceIds || []).map(stringIndex)
  ];
}

function decodeRelationship(relationship, stringValue) {
  return {
    id: stringValue(relationship[0]),
    kind: enumValue(RELATIONSHIP_KINDS, relationship[1], "contains"),
    origin: enumValue(ORIGINS, relationship[2], "derived"),
    from: stringValue(relationship[3]),
    to: stringValue(relationship[4]),
    value: stringValue(relationship[5]),
    packageId: stringValue(relationship[6]),
    evidenceIds: (relationship[7] || []).map(stringValue).filter(Boolean)
  };
}

function encodeEvidence(evidence, stringIndex) {
  return [
    stringIndex(evidence.id),
    stringIndex(evidence.path),
    Math.max(0, Number(evidence.line) || 0),
    Math.max(0, Number(evidence.column) || 0),
    stringIndex(evidence.kind)
  ];
}

function decodeEvidence(evidence, stringValue) {
  return {
    id: stringValue(evidence[0]),
    path: stringValue(evidence[1]),
    line: Math.max(0, Number(evidence[2]) || 0),
    column: Math.max(0, Number(evidence[3]) || 0),
    kind: stringValue(evidence[4])
  };
}

function encodeFinding(finding, stringIndex) {
  return [
    stringIndex(finding.id),
    stringIndex(finding.rule),
    enumCode(SEVERITIES, finding.severity),
    stringIndex(finding.title),
    stringIndex(finding.message),
    stringIndex(finding.repair),
    (finding.entityIds || []).map(stringIndex),
    (finding.evidenceIds || []).map(stringIndex),
    stringIndex(finding.status)
  ];
}

function decodeFinding(finding, stringValue) {
  return {
    id: stringValue(finding[0]),
    rule: stringValue(finding[1]),
    severity: enumValue(SEVERITIES, finding[2], "info"),
    title: stringValue(finding[3]),
    message: stringValue(finding[4]),
    repair: stringValue(finding[5]),
    entityIds: (finding[6] || []).map(stringValue).filter(Boolean),
    evidenceIds: (finding[7] || []).map(stringValue).filter(Boolean),
    status: stringValue(finding[8]) || "open"
  };
}

function encodeDiagnostic(diagnostic, stringIndex) {
  return [
    stringIndex(diagnostic.code),
    stringIndex(diagnostic.message),
    stringIndex(diagnostic.path),
    Math.max(0, Number(diagnostic.line) || 0)
  ];
}

function decodeDiagnostic(diagnostic, stringValue) {
  return {
    code: stringValue(diagnostic[0]),
    message: stringValue(diagnostic[1]),
    path: stringValue(diagnostic[2]),
    line: Math.max(0, Number(diagnostic[3]) || 0)
  };
}

function encodeSystemDocument(model = {}) {
  const codec = stringCodec(model);
  return {
    schemaVersion: SYSTEM_DOCUMENT_SCHEMA_VERSION,
    adapter: model.adapter || {},
    input: model.input || {},
    declarations: Array.isArray(model.declarations) ? model.declarations : [],
    strings: codec.strings,
    files: (model.files || []).map((file) => encodeFile(file, codec.encode)),
    entities: (model.entities || []).map((entity) => encodeEntity(entity, codec.encode)),
    relationships: (model.relationships || []).map((relationship) => encodeRelationship(relationship, codec.encode)),
    evidence: (model.evidence || []).map((entry) => encodeEvidence(entry, codec.encode)),
    findings: (model.findings || []).map((finding) => encodeFinding(finding, codec.encode)),
    coverage: model.coverage || {},
    diagnostics: (model.diagnostics || []).map((diagnostic) => encodeDiagnostic(diagnostic, codec.encode)),
    provenance: model.provenance || {}
  };
}

function assertSystemDocument(document = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("System document must be an object.");
  }
  if (document.schemaVersion !== SYSTEM_DOCUMENT_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported System document schema version: ${document.schemaVersion || "missing"}.`);
  }
  for (const tableName of ["strings", "files", "entities", "relationships", "evidence", "findings", "diagnostics"]) {
    if (!Array.isArray(document[tableName])) {
      throw new TypeError(`System document ${tableName} must be an array.`);
    }
  }
  return document;
}

function decodeSystemDocument(document = {}) {
  const validated = assertSystemDocument(document);
  const stringValue = (index = 0) => validated.strings[Number(index) - 1] || "";
  return {
    schemaVersion: validated.schemaVersion,
    adapter: validated.adapter || {},
    input: validated.input || {},
    declarations: Array.isArray(validated.declarations) ? validated.declarations : [],
    files: validated.files.map((file) => decodeFile(file, stringValue)),
    entities: validated.entities.map((entity) => decodeEntity(entity, stringValue)),
    relationships: validated.relationships.map((relationship) => decodeRelationship(relationship, stringValue)),
    evidence: validated.evidence.map((entry) => decodeEvidence(entry, stringValue)),
    findings: validated.findings.map((finding) => decodeFinding(finding, stringValue)),
    coverage: validated.coverage || {},
    diagnostics: validated.diagnostics.map((diagnostic) => decodeDiagnostic(diagnostic, stringValue)),
    provenance: validated.provenance || {}
  };
}

function serializeSystemDocument(model = {}) {
  return `${JSON.stringify(encodeSystemDocument(model))}\n`;
}

export {
  ENTITY_KINDS,
  EXECUTION_SIDES,
  RELATIONSHIP_KINDS,
  SYSTEM_DOCUMENT_SCHEMA_VERSION,
  assertSystemDocument,
  decodeSystemDocument,
  encodeSystemDocument,
  serializeSystemDocument
};
