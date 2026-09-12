import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH
} from "@local/vibe64-genesis/server";
import {
  isMissingPathError,
  isPlainObject,
  vibe64Error
} from "@local/vibe64-core/server/core";

const GENESIS_MACHINE_CITY_SCHEMA = "genesis.machine-city.v1";
const GENESIS_PROGRAM_CITY_SCHEMA = "genesis.program-city.v1";
const GENESIS_CITY_SCHEMA_VERSION = 1;

const CITY_DEFINITIONS = Object.freeze({
  machine: Object.freeze({
    path: GENESIS_MACHINE_CITY_PATH,
    schema: GENESIS_MACHINE_CITY_SCHEMA
  }),
  program: Object.freeze({
    path: GENESIS_PROGRAM_CITY_PATH,
    schema: GENESIS_PROGRAM_CITY_SCHEMA
  })
});

function genesisCityError(kind, message, code = "vibe64_invalid_genesis_city") {
  const definition = CITY_DEFINITIONS[kind];
  const title = kind === "machine"
    ? "Machine City"
    : kind === "program"
      ? "Program City"
      : "Genesis City";
  const error = vibe64Error(
    `${title} ${message}`,
    code
  );
  error.details = {
    cityKind: kind,
    path: definition?.path || ""
  };
  return error;
}

function cityDefinition(kind) {
  const definition = CITY_DEFINITIONS[kind];
  if (!definition) {
    throw genesisCityError(
      kind,
      `kind is not supported: ${String(kind || "")}`,
      "vibe64_invalid_genesis_city_kind"
    );
  }
  return definition;
}

function requireCondition(condition, kind, message) {
  if (!condition) {
    throw genesisCityError(kind, message);
  }
}

function requireRecord(value, kind, label) {
  requireCondition(isPlainObject(value), kind, `${label} must be an object.`);
}

function requireArray(value, kind, label) {
  requireCondition(Array.isArray(value), kind, `${label} must be an array.`);
}

function requireString(value, kind, label) {
  requireCondition(typeof value === "string", kind, `${label} must be a string.`);
}

function requireOptionalString(value, kind, label) {
  requireCondition(value === null || typeof value === "string", kind, `${label} must be a string or null.`);
}

function requireBoolean(value, kind, label) {
  requireCondition(typeof value === "boolean", kind, `${label} must be a boolean.`);
}

function requireNonNegativeInteger(value, kind, label) {
  requireCondition(
    Number.isInteger(value) && value >= 0,
    kind,
    `${label} must be a non-negative integer.`
  );
}

function requireStringArray(value, kind, label) {
  requireArray(value, kind, label);
  value.forEach((entry, index) => requireString(entry, kind, `${label}[${index}]`));
}

function requireDiagnostics(value, kind) {
  requireArray(value, kind, "diagnostics");
  value.forEach((entry, index) => requireRecord(entry, kind, `diagnostics[${index}]`));
}

function requireUniqueIds(records, kind, label) {
  const seen = new Set();
  records.forEach((record, index) => {
    requireRecord(record, kind, `${label}[${index}]`);
    requireString(record.id, kind, `${label}[${index}].id`);
    requireCondition(!seen.has(record.id), kind, `${label} contains duplicate id ${record.id}.`);
    seen.add(record.id);
  });
  return seen;
}

function validateDistricts(districts, kind) {
  requireArray(districts, kind, "districts");
  const ids = requireUniqueIds(districts, kind, "districts");
  districts.forEach((district, index) => {
    const label = `districts[${index}]`;
    requireString(district.path, kind, `${label}.path`);
    requireString(district.title, kind, `${label}.title`);
    requireOptionalString(district.parentId, kind, `${label}.parentId`);
    if (district.parentId !== null) {
      requireCondition(ids.has(district.parentId), kind, `${label}.parentId does not identify a district.`);
    }
  });
  return ids;
}

function validateMachineCity(city) {
  const kind = "machine";
  requireString(city.codeHash, kind, "codeHash");
  requireStringArray(city.stackComponents, kind, "stackComponents");
  requireStringArray(city.indexers, kind, "indexers");
  requireDiagnostics(city.diagnostics, kind);
  const districtIds = validateDistricts(city.districts, kind);

  requireArray(city.buildings, kind, "buildings");
  const buildingIds = requireUniqueIds(city.buildings, kind, "buildings");
  city.buildings.forEach((building, index) => {
    const label = `buildings[${index}]`;
    ["path", "title", "districtId", "language", "role", "hash"].forEach((field) => {
      requireString(building[field], kind, `${label}.${field}`);
    });
    requireCondition(districtIds.has(building.districtId), kind, `${label}.districtId does not identify a district.`);
    requireNonNegativeInteger(building.mode, kind, `${label}.mode`);
    requireNonNegativeInteger(building.bytes, kind, `${label}.bytes`);
    requireNonNegativeInteger(building.lines, kind, `${label}.lines`);
    requireStringArray(building.extractors, kind, `${label}.extractors`);
    requireStringArray(building.functionIds, kind, `${label}.functionIds`);
    requireNonNegativeInteger(building.publicFunctionCount, kind, `${label}.publicFunctionCount`);
    requireNonNegativeInteger(building.internalFunctionCount, kind, `${label}.internalFunctionCount`);
  });

  requireArray(city.functions, kind, "functions");
  const functionIds = requireUniqueIds(city.functions, kind, "functions");
  city.functions.forEach((entry, index) => {
    const label = `functions[${index}]`;
    [
      "name",
      "qualifiedName",
      "kind",
      "visibility",
      "path",
      "fileId",
      "role",
      "language",
      "extractor"
    ].forEach((field) => requireString(entry[field], kind, `${label}.${field}`));
    requireOptionalString(entry.container, kind, `${label}.container`);
    requireCondition(buildingIds.has(entry.fileId), kind, `${label}.fileId does not identify a building.`);
    requireNonNegativeInteger(entry.line, kind, `${label}.line`);
    requireNonNegativeInteger(entry.column, kind, `${label}.column`);
    requireStringArray(entry.parameters, kind, `${label}.parameters`);
    requireBoolean(entry.async, kind, `${label}.async`);
    requireBoolean(entry.generator, kind, `${label}.generator`);
    requireBoolean(entry.static, kind, `${label}.static`);
  });
  city.buildings.forEach((building, index) => {
    building.functionIds.forEach((functionId) => {
      requireCondition(
        functionIds.has(functionId),
        kind,
        `buildings[${index}].functionIds contains an unknown function id.`
      );
    });
  });
}

function validateProgramCity(city) {
  const kind = "program";
  requireString(city.programHash, kind, "programHash");
  requireDiagnostics(city.diagnostics, kind);
  const districtIds = validateDistricts(city.districts, kind);

  requireArray(city.buildings, kind, "buildings");
  const buildingIds = requireUniqueIds(city.buildings, kind, "buildings");
  city.buildings.forEach((building, index) => {
    const label = `buildings[${index}]`;
    [
      "name",
      "title",
      "description",
      "publicContract",
      "implementationMap",
      "path"
    ].forEach((field) => requireString(building[field], kind, `${label}.${field}`));
    requireOptionalString(building.subsystem, kind, `${label}.subsystem`);
    requireOptionalString(building.districtId, kind, `${label}.districtId`);
    requireCondition(building.districtId === null || districtIds.has(building.districtId), kind, `${label}.districtId does not identify a district.`);
    requireStringArray(building.sources, kind, `${label}.sources`);
    requireStringArray(building.sourceFileIds, kind, `${label}.sourceFileIds`);
  });

  requireArray(city.links, kind, "links");
  city.links.forEach((link, index) => {
    const label = `links[${index}]`;
    requireRecord(link, kind, label);
    requireCondition(link.kind === "implemented-by", kind, `${label}.kind must be implemented-by.`);
    requireString(link.fromId, kind, `${label}.fromId`);
    requireString(link.toId, kind, `${label}.toId`);
    requireCondition(buildingIds.has(link.fromId), kind, `${label}.fromId does not identify a Program building.`);
  });
}

function validateGenesisCity(city, kind) {
  const definition = cityDefinition(kind);
  requireRecord(city, kind, "document");
  requireCondition(city.schema === definition.schema, kind, `schema must be ${definition.schema}.`);
  requireCondition(
    city.schemaVersion === GENESIS_CITY_SCHEMA_VERSION,
    kind,
    `schemaVersion must be ${GENESIS_CITY_SCHEMA_VERSION}.`
  );
  requireString(city.status, kind, "status");
  if (kind === "machine") {
    validateMachineCity(city);
  } else {
    validateProgramCity(city);
  }
  return city;
}

async function readGenesisCity(projectRoot, kind) {
  const definition = cityDefinition(kind);
  const filePath = path.join(projectRoot, definition.path);
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        city: null,
        exists: false,
        kind,
        path: definition.path
      };
    }
    throw error;
  }

  let city;
  try {
    city = JSON.parse(source);
  } catch {
    throw genesisCityError(kind, "contains invalid JSON.");
  }
  return {
    city: validateGenesisCity(city, kind),
    exists: true,
    kind,
    path: definition.path
  };
}

function requireGenesisCity(record, kind) {
  if (!record?.exists || !record.city) {
    throw genesisCityError(
      kind,
      "has not been generated. Refresh the Genesis Cities first.",
      "vibe64_genesis_city_missing"
    );
  }
  return record.city;
}

export {
  GENESIS_CITY_SCHEMA_VERSION,
  GENESIS_MACHINE_CITY_SCHEMA,
  GENESIS_PROGRAM_CITY_SCHEMA,
  readGenesisCity,
  requireGenesisCity,
  validateGenesisCity
};
