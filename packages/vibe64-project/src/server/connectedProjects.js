import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";

const CONNECTED_PROJECTS_FILE = "vibe64.connections.json";
const CONNECTED_PROJECTS_LIMIT = 64;
const CONNECTED_PROJECTS_MAX_BYTES = 64 * 1024;

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
    if (!isPlainObject(entry) || Object.keys(entry).some((key) => !["name", "repository", "relationship", "type", "script"].includes(key))) {
      invalid("Each project must contain name, repository and relationship, with optional type and script.");
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
    if (entry.type !== undefined && !["npm", "custom"].includes(entry.type)) invalid("Type must be npm or custom, or omitted to use the consuming Stack default.");
    if (entry.script !== undefined && (typeof entry.script !== "string" || !entry.script.trim() || entry.script.length > 1024 ||
        /[\\:\x00-\x1f\x7f]/u.test(entry.script) ||
        entry.script.split("/").some(part => ["", ".", "..", ".git"].includes(part.toLowerCase())))) {
      invalid("Script must be a project-relative path outside .git, without absolute paths or traversal.");
    }
    if (entry.type === "custom" && entry.script === undefined) invalid("A custom connection requires its project-relative script.");
    if (entry.type === "npm" && entry.script !== undefined) invalid("An npm connection cannot have a custom script.");
    return { name: entry.name.trim(), repository, relationship: entry.relationship,
      ...(entry.type === undefined ? {} : { type: entry.type }),
      ...(entry.script === undefined ? {} : { script: entry.script }) };
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
    if (!stat.isFile() || stat.size > CONNECTED_PROJECTS_MAX_BYTES) invalid("Expected an ordinary file no larger than 64 KiB.");
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
  // Match the shared atomic writer's formatted UTF-8 JSON before replacing a
  // readable file with content that this owner's reader would reject.
  if (Buffer.byteLength(`${JSON.stringify(normalized, null, 2)}\n`, "utf8") > CONNECTED_PROJECTS_MAX_BYTES) {
    invalid("The connection list exceeds 64 KiB. Shorten its entries before saving.");
  }
  await writeJsonFileAtomic(connectionsPath(sourceRoot), normalized, { directoryMode: 0o2770, fileMode: 0o660 });
  return readConnectedProjects(sourceRoot);
}

export { CONNECTED_PROJECTS_FILE, CONNECTED_PROJECTS_LIMIT, normalizeConnectedProjects, readConnectedProjects, saveConnectedProjects };
