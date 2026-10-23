// Reads an npm tarball (gzip + ustar/pax, as `npm pack` writes it) into its file
// list, so a dry run can show exactly what a release adds, removes or changes.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { publishError } from "../../errors.js";

const BLOCK = 512;
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

function text(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function octal(buffer, start, length) {
  const value = text(buffer, start, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function paxRecords(buffer) {
  const records = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(buffer.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isInteger(length) || length <= 0) break;
    const record = buffer.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}

function stripPackageRoot(name) {
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

// [{ path, size, sha256 }] for every regular file, with npm's leading
// `package/` folder removed, sorted by path.
function listNpmTarball(tarball) {
  let tar;
  try {
    tar = gunzipSync(tarball, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw publishError("VIBE64_PUBLISH_ARTIFACT_INVALID", "The npm tarball is not a gzip archive.");
  }
  const files = [];
  let offset = 0;
  let pending = {};
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      pending = { ...pending, ...paxRecords(body) };
      continue;
    }
    if (type === "L") {
      pending = { ...pending, path: text(body, 0, body.length) };
      continue;
    }
    if (type === "g") continue;
    const prefix = text(header, 345, 155);
    const name = pending.path || (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    pending = {};
    if (type !== "0" && type !== "\0") continue;
    files.push({
      path: stripPackageRoot(name),
      size,
      sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
      body
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function npmTarballManifest(files) {
  const entry = files.find((file) => file.path === "package.json");
  if (!entry) throw publishError("VIBE64_PUBLISH_ARTIFACT_INVALID", "The npm tarball has no package.json.");
  try {
    return JSON.parse(entry.body.toString("utf8"));
  } catch {
    throw publishError("VIBE64_PUBLISH_ARTIFACT_INVALID", "The npm tarball's package.json is not valid JSON.");
  }
}

// What changes between the published contents and this release's contents.
function diffFileLists(previous = [], next = []) {
  const before = new Map(previous.map((file) => [file.path, file]));
  const after = new Map(next.map((file) => [file.path, file]));
  return {
    added: [...after.keys()].filter((name) => !before.has(name)).sort(),
    removed: [...before.keys()].filter((name) => !after.has(name)).sort(),
    changed: [...after.keys()].filter((name) => before.has(name) && before.get(name).sha256 !== after.get(name).sha256).sort()
  };
}

export { diffFileLists, listNpmTarball, npmTarballManifest };
