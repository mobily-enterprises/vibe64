import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";

const CONNECTED_PROJECTS_FILE = "vibe64.connections.json";
const CONNECTED_PROJECTS_LIMIT = 64;

function invalid(message) {
  throw vibe64Error(`${CONNECTED_PROJECTS_FILE}: ${message}`, "vibe64_connections_invalid");
}

function normalizeConnectedProjects(value) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => key !== "projects") ||
      !Array.isArray(value.projects) || value.projects.length > CONNECTED_PROJECTS_LIMIT) {
    invalid(`Expected a projects array with at most ${CONNECTED_PROJECTS_LIMIT} entries.`);
  }
  const repositories = new Set();
  return { projects: value.projects.map((entry) => {
    if (!isPlainObject(entry) || Object.keys(entry).some((key) => !["name", "repository", "relationship"].includes(key))) {
      invalid("Each project must contain only name, repository and relationship.");
    }
    if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 100 || /[\x00-\x1f\x7f]/u.test(entry.name)) {
      invalid("Each project needs a name of 1–100 characters on one line.");
    }
    const match = typeof entry.repository === "string" && entry.repository.length <= 512 &&
      entry.repository.match(/^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/iu);
    if (!match || [".", ".."].includes(match[2])) {
      invalid("Use a GitHub HTTPS repository URL without credentials, query or fragment.");
    }
    const repository = `https://github.com/${match[1]}/${match[2]}`.toLowerCase();
    if (repositories.has(repository)) invalid("A repository may appear only once, regardless of its display name.");
    repositories.add(repository);
    if (!["dependency", "composition"].includes(entry.relationship)) invalid("Relationship must be dependency or composition.");
    return { name: entry.name.trim(), repository, relationship: entry.relationship };
  }) };
}

function connectionsPath(sourceRoot) {
  if (!sourceRoot || !path.isAbsolute(sourceRoot)) invalid("An absolute project source root is required.");
  return path.join(sourceRoot, CONNECTED_PROJECTS_FILE);
}

async function readConnectedProjects(sourceRoot) {
  let file;
  try {
    const filePath = connectionsPath(sourceRoot);
    const entry = await lstat(filePath);
    if (!entry.isFile()) invalid("Expected an ordinary connection file, not a symbolic link or directory.");
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) invalid("Expected an ordinary file no larger than 64 KiB.");
    const text = await file.readFile("utf8");
    const value = normalizeConnectedProjects(JSON.parse(text));
    return { ...value, exists: true, revision: createHash("sha256").update(text).digest("hex") };
  } catch (error) {
    if (error.code === "ENOENT") return { projects: [], exists: false, revision: "" };
    if (error instanceof SyntaxError) invalid("Invalid JSON. Repair the file before saving settings.");
    if (error.code === "ELOOP") invalid("The connection file must not be a symbolic link.");
    throw error;
  } finally {
    await file?.close();
  }
}

// The project service holds the session write lock and project source lock.
async function saveConnectedProjects(sourceRoot, value, expectedRevision) {
  const normalized = normalizeConnectedProjects(value);
  const current = await readConnectedProjects(sourceRoot);
  if (typeof expectedRevision !== "string" || current.revision !== expectedRevision) {
    throw vibe64Error("Connected projects changed. Refresh and review the current list before saving.", "vibe64_connections_changed");
  }
  await writeJsonFileAtomic(connectionsPath(sourceRoot), normalized, { directoryMode: 0o2770, fileMode: 0o660 });
  return readConnectedProjects(sourceRoot);
}

export { CONNECTED_PROJECTS_FILE, CONNECTED_PROJECTS_LIMIT, normalizeConnectedProjects, readConnectedProjects, saveConnectedProjects };
