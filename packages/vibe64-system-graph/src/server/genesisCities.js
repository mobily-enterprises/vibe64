import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH,
  MACHINE_CITY_SCHEMA,
  PROGRAM_CITY_SCHEMA,
  validateCityDocument
} from "@local/vibe64-genesis/server";
import {
  isMissingPathError,
  vibe64Error
} from "@local/vibe64-core/server/core";

// Status and the selected view share immutable, validated snapshots. Keep only
// two files; large indexes must not accumulate across projects or sessions.
const cityReads = new Map();

const CITY_DEFINITIONS = Object.freeze({
  machine: Object.freeze({
    path: GENESIS_MACHINE_CITY_PATH,
    schema: MACHINE_CITY_SCHEMA,
    title: "Machine City"
  }),
  program: Object.freeze({
    path: GENESIS_PROGRAM_CITY_PATH,
    schema: PROGRAM_CITY_SCHEMA,
    title: "Program City"
  })
});

function cityError(kind, message, code = "vibe64_invalid_genesis_city") {
  const error = vibe64Error(message, code);
  error.details = {
    cityKind: kind,
    path: CITY_DEFINITIONS[kind]?.path || ""
  };
  return error;
}

function genesisCityError(kind, message, code) {
  const title = CITY_DEFINITIONS[kind]?.title || "Genesis City";
  return cityError(kind, `${title} ${message}`, code);
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

// Genesis owns the City document formats and their validation; Vibe64 only
// maps its rejection onto the System Graph error contract.
function validateGenesisCity(city, kind) {
  const definition = cityDefinition(kind);
  try {
    return validateCityDocument(city, kind);
  } catch (error) {
    if (error?.code === "CITY_INVALID") throw cityError(kind, error.message);
    if (error?.code === "ARCHITECTURE_INVALID") {
      throw cityError(kind, `${definition.title} architecture is invalid: ${error.message}`);
    }
    throw error;
  }
}

async function readGenesisCity(projectRoot, kind) {
  const definition = cityDefinition(kind);
  const filePath = path.resolve(projectRoot, definition.path);
  const identity = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
  let revision;
  try {
    revision = identity(await stat(filePath, { bigint: true }));
  } catch (error) {
    cityReads.delete(filePath);
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
  const existing = cityReads.get(filePath);
  if (existing?.revision === revision) {
    cityReads.delete(filePath);
    cityReads.set(filePath, existing);
    return existing.promise;
  }
  const pending = { revision, promise: null };
  pending.promise = (async () => {
    const source = await readFile(filePath, "utf8");
    let city;
    try { city = JSON.parse(source); }
    catch { throw genesisCityError(kind, "contains invalid JSON."); }
    validateGenesisCity(city, kind);
    if (identity(await stat(filePath, { bigint: true })) !== revision) {
      throw genesisCityError(kind, "changed while loading. Reload to read the new snapshot.");
    }
    return { city, exists: true, kind, path: definition.path };
  })();
  cityReads.delete(filePath);
  cityReads.set(filePath, pending);
  while (cityReads.size > 2) cityReads.delete(cityReads.keys().next().value);
  try {
    return await pending.promise;
  } catch (error) {
    if (cityReads.get(filePath) === pending) cityReads.delete(filePath);
    throw error;
  }
}

function requireGenesisCity(record, kind) {
  if (!record?.exists || !record.city) {
    throw genesisCityError(
      kind,
      "has not been generated. Refresh analysis first.",
      "vibe64_genesis_city_missing"
    );
  }
  return record.city;
}

export {
  readGenesisCity,
  requireGenesisCity,
  validateGenesisCity
};
