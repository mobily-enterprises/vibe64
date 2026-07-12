import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  VIBE64_SYSTEM_DOCUMENT_FILE
} from "@local/vibe64-core/server/projectManifest";

import {
  assertSystemDocument,
  decodeSystemDocument,
  serializeSystemDocument
} from "./documentCodec.js";

const SYSTEM_DOCUMENT_FILENAME = VIBE64_SYSTEM_DOCUMENT_FILE;
const SYSTEM_DOCUMENT_MAX_BYTES = 64 * 1024 * 1024;

function contentHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function systemDocumentPath(sourceRoot = "") {
  const source = String(sourceRoot || "").trim();
  if (!source) {
    throw new TypeError("System document requires a source root.");
  }
  const root = path.resolve(source);
  return path.join(root, SYSTEM_DOCUMENT_FILENAME);
}

async function readSystemDocument(sourceRoot = "") {
  const documentPath = systemDocumentPath(sourceRoot);
  let fileStat;
  try {
    fileStat = await lstat(documentPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        bytes: 0,
        contentHash: "",
        document: null,
        documentPath,
        model: null
      };
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new TypeError(`${SYSTEM_DOCUMENT_FILENAME} must be a regular file.`);
  }
  if (fileStat.size > SYSTEM_DOCUMENT_MAX_BYTES) {
    throw new TypeError(`${SYSTEM_DOCUMENT_FILENAME} exceeds the ${SYSTEM_DOCUMENT_MAX_BYTES}-byte safety limit.`);
  }
  const source = await readFile(documentPath, "utf8");
  const document = assertSystemDocument(JSON.parse(source));
  return {
    exists: true,
    bytes: Buffer.byteLength(source),
    contentHash: contentHash(source),
    document,
    documentPath,
    model: decodeSystemDocument(document)
  };
}

async function writeSystemDocument(sourceRoot = "", model = {}) {
  const documentPath = systemDocumentPath(sourceRoot);
  const serialized = serializeSystemDocument(model);
  if (Buffer.byteLength(serialized) > SYSTEM_DOCUMENT_MAX_BYTES) {
    throw new TypeError(`Generated ${SYSTEM_DOCUMENT_FILENAME} exceeds the ${SYSTEM_DOCUMENT_MAX_BYTES}-byte safety limit.`);
  }
  const temporaryPath = path.join(
    path.dirname(documentPath),
    `.${SYSTEM_DOCUMENT_FILENAME}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644
    });
    await rename(temporaryPath, documentPath);
  } finally {
    await rm(temporaryPath, {
      force: true
    });
  }
  return {
    bytes: Buffer.byteLength(serialized),
    contentHash: contentHash(serialized),
    documentPath,
    model
  };
}

function systemDeclarationsDigest(declarations = []) {
  return contentHash(JSON.stringify(Array.isArray(declarations) ? declarations : []));
}

export {
  SYSTEM_DOCUMENT_FILENAME,
  SYSTEM_DOCUMENT_MAX_BYTES,
  contentHash,
  readSystemDocument,
  systemDeclarationsDigest,
  systemDocumentPath,
  writeSystemDocument
};
