// Verified toolchain downloads: a pinned URL, a pinned checksum, a size cap, and
// an atomic rename only after the bytes match. Archives are unpacked into a
// staging folder that is renamed into place: tarballs with the system `tar`,
// zips here in Node, since many hosts have no `unzip`.
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inflateRawSync } from "node:zlib";

import { publishError } from "../errors.js";
import { BUILD_ENVIRONMENT_PASSTHROUGH, spawnCommand } from "../stages.js";

function toolchainError(message, details) {
  return publishError("VIBE64_PUBLISH_TOOLCHAIN_FAILED", message, details);
}

async function exists(file) {
  return Boolean(await stat(file).catch(() => null));
}

// archive: { url, file, size, sha256 | sha1 }. Returns the verified local path.
async function downloadVerified(archive, directory, { fetchImpl = fetch, signal } = {}) {
  const algorithm = archive.sha256 ? "sha256" : "sha1";
  const expected = archive.sha256 || archive.sha1;
  if (!/^[0-9a-f]{40,64}$/u.test(expected || "") || !archive.file || !archive.url) {
    throw toolchainError("A toolchain archive needs a pinned URL, file name and checksum.");
  }
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, archive.file);
  if (await exists(target)) return target;
  const partial = `${target}.partial-${randomUUID()}`;
  let response;
  try {
    response = await fetchImpl(archive.url, { redirect: "follow", signal });
  } catch (error) {
    throw toolchainError(`Could not download ${archive.file}: ${error?.cause?.code || error?.name || "network error"}.`);
  }
  if (!response.ok || !response.body) throw toolchainError(`Downloading ${archive.file} failed with HTTP ${response.status}.`);
  const hash = createHash(algorithm);
  let size = 0;
  const limit = archive.size ? archive.size : 2 * 1024 * 1024 * 1024;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > limit) return callback(toolchainError(`${archive.file} is larger than expected.`));
      hash.update(chunk);
      return callback(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial, { mode: 0o644 }));
    const actual = hash.digest("hex");
    if (actual !== expected || (archive.size && size !== archive.size)) {
      throw toolchainError(`${archive.file} does not match its pinned checksum; nothing was installed.`, { expected, actual, size });
    }
    await rename(partial, target);
    return target;
  } finally {
    await rm(partial, { force: true });
  }
}

function toolEnvironment(baseEnvironment = process.env, extra = {}) {
  const environment = {};
  for (const name of BUILD_ENVIRONMENT_PASSTHROUGH) {
    if (typeof baseEnvironment[name] === "string") environment[name] = baseEnvironment[name];
  }
  return { ...environment, ...extra };
}

async function runOrFail(argv, { cwd, env, label, runCommand = spawnCommand }) {
  const result = await runCommand({ command: argv[0], args: argv.slice(1), cwd, env });
  if (result?.ok !== true) {
    throw toolchainError(`${label} failed${result?.exitCode == null ? "" : ` with exit code ${result.exitCode}`}.`, {
      output: `${result?.stdout || ""}${result?.stderr || ""}${result?.error || ""}`.slice(-8000)
    });
  }
  return result;
}

// Extracts a (non-zip64) zip into `directory`, keeping Unix file modes and
// relative symlinks. Entries that would land outside `directory` are refused.
async function extractZip(archiveFile, directory) {
  const zip = await readFile(archiveFile);
  const name = path.basename(archiveFile);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw toolchainError(`${name} is not a zip archive.`);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const root = path.resolve(directory);
  const inside = (target) => target === root || target.startsWith(`${root}${path.sep}`);
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw toolchainError(`${name} has a damaged central directory.`);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const mode = zip.readUInt32LE(offset + 38) >>> 16;
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    const target = path.resolve(root, entryName);
    if (path.isAbsolute(entryName) || !inside(target)) throw toolchainError(`${name} has an entry outside its folder: ${entryName}`);
    if (entryName.endsWith("/")) {
      await mkdir(target, { recursive: true });
      continue;
    }
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const stored = zip.subarray(start, start + compressedSize);
    if (method !== 0 && method !== 8) throw toolchainError(`${name} uses an unsupported compression for ${entryName}.`);
    const bytes = method === 8 ? inflateRawSync(stored) : stored;
    await mkdir(path.dirname(target), { recursive: true });
    if ((mode & 0o170000) === 0o120000) {
      const link = bytes.toString("utf8");
      if (path.isAbsolute(link) || !inside(path.resolve(path.dirname(target), link))) throw toolchainError(`${name} has a link outside its folder: ${entryName}`);
      await symlink(link, target);
      continue;
    }
    await writeFile(target, bytes);
    if (mode & 0o777) await chmod(target, mode & 0o777);
  }
}

// Unpacks an archive into `<destination>` atomically; `inner` names the one top
// folder of the archive whose contents become the destination.
async function unpackInto(archiveFile, destination, { inner, kind, baseEnvironment, runCommand } = {}) {
  if (await exists(destination)) return destination;
  const staging = `${destination}.staging-${randomUUID()}`;
  await mkdir(staging, { recursive: true });
  try {
    if (kind === "zip") {
      await extractZip(archiveFile, staging);
    } else {
      const env = toolEnvironment(baseEnvironment, { HOME: staging });
      await runOrFail(["tar", "-xzf", archiveFile, "-C", staging, "--no-same-owner"], { cwd: staging, env, label: `Unpacking ${path.basename(archiveFile)}`, runCommand });
    }
    const source = path.join(staging, inner);
    if (!await exists(source)) throw toolchainError(`${path.basename(archiveFile)} has no ${inner} folder.`);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export { downloadVerified, exists, extractZip, runOrFail, toolEnvironment, toolchainError, unpackInto };
