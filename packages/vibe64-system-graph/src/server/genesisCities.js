import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import * as genesisServer from "@local/vibe64-genesis/server";
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

import { createSnapshotCache } from "./snapshotCache.js";

// Status and the selected view share immutable, validated snapshots. Keep only
// two files, and only while they are read; large indexes must not accumulate
// across projects or sessions, nor stay loaded when nobody looks at them.
const cityReads = createSnapshotCache({ capacity: 2 });

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
  let revisionStat;
  try {
    revisionStat = await stat(filePath, { bigint: true });
    revision = identity(revisionStat);
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
  return cityReads.read(filePath, revision, async () => {
    const source = await readFile(filePath, "utf8");
    let city;
    try { city = JSON.parse(source); }
    catch { throw genesisCityError(kind, "contains invalid JSON."); }
    validateGenesisCity(city, kind);
    if (identity(await stat(filePath, { bigint: true })) !== revision) {
      throw genesisCityError(kind, "changed while loading. Reload to read the new snapshot.");
    }
    const builtAt = new Date(Number(revisionStat.mtimeMs)).toISOString();
    return { builtAt, city, exists: true, kind, path: definition.path };
  });
}

// A scan replaces both Cities, so their loaded copies have no further use.
function releaseGenesisCities(projectRoot) {
  for (const definition of Object.values(CITY_DEFINITIONS)) cityReads.delete(path.resolve(projectRoot, definition.path));
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

// The call web is the separate Genesis artifact a Machine City summarises.
// Only the summary's exact bytes are read: a file another scan replaced in the
// meantime is refused, never joined to this snapshot. Genesis validates it.
// It is read only as a regular file, never through a link or from a FIFO,
// and only up to its size limit.
const CALL_WEB_PATH = ".genesis/call-web.json";
const CALL_WEB_MAX_BYTES = 64 * 1024 * 1024;

function callWebError(message, code = "vibe64_invalid_genesis_call_web") {
  const error = vibe64Error(`The call web ${message}`, code);
  error.details = { path: CALL_WEB_PATH };
  return error;
}

function validateGenesisCallWeb(document, files) {
  const { validateCallWeb } = genesisServer;
  if (typeof validateCallWeb !== "function") {
    throw callWebError("cannot be read by this Genesis version.", "vibe64_genesis_call_web_unsupported");
  }
  try {
    return validateCallWeb(document, { files });
  } catch (error) {
    if (error?.code === "CALL_WEB_INVALID") throw callWebError(`is invalid: ${error.message}`);
    throw error;
  }
}

async function readGenesisCallWeb(projectRoot, architecture, { validate = validateGenesisCallWeb } = {}) {
  const summary = architecture?.callWeb;
  if (!summary) return null;
  if (summary.path !== CALL_WEB_PATH) throw callWebError(`must be ${CALL_WEB_PATH}.`);
  let handle;
  try {
    handle = await open(path.resolve(projectRoot, CALL_WEB_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (isMissingPathError(error)) throw callWebError("is missing. Refresh analysis.", "vibe64_genesis_call_web_missing");
    if (error?.code === "ELOOP") throw callWebError("must be a regular file.");
    throw error;
  }
  let source;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw callWebError("must be a regular file.");
    if (info.size > CALL_WEB_MAX_BYTES) throw callWebError("is larger than 64 MiB.");
    source = Buffer.alloc(info.size);
    let length = 0;
    while (length < source.length) {
      const { bytesRead } = await handle.read(source, length, source.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    source = source.subarray(0, length);
  } finally {
    await handle.close();
  }
  if (`sha256:${createHash("sha256").update(source).digest("hex")}` !== summary.identity) {
    throw callWebError("changed since this scan. Reload Architecture.", "vibe64_genesis_call_web_changed");
  }
  let document;
  try { document = JSON.parse(source.toString("utf8")); }
  catch { throw callWebError("contains invalid JSON."); }
  return validate(document, architecture.files);
}

export {
  CALL_WEB_PATH,
  readGenesisCallWeb,
  readGenesisCity,
  releaseGenesisCities,
  requireGenesisCity,
  validateGenesisCity
};
