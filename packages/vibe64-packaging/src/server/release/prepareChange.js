// Preparing a release is an ordinary source change: the package's version and a
// CHANGELOG.md entry, which the person reviews and Saves like any other change.
// Releasing later only tags that saved commit. `Version from: external` packages
// (Changesets, release-please and the like) are only ever read, never written.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { publishError } from "../errors.js";
import { pathWithin } from "../paths.js";
import { compareSemver, isSemver, pep440FromSemver } from "./version.js";

const CHANGELOG = "CHANGELOG.md";
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function prepareError(message, details) {
  return publishError("VIBE64_PUBLISH_PREPARE_INVALID", message, details);
}

function packageRoot(projectRoot, entry) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) throw prepareError("The project root must be an absolute path.");
  return path.join(projectRoot, entry?.workdir || ".");
}

function relativeTo(projectRoot, file) {
  return path.relative(projectRoot, file).split(path.sep).join("/");
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw prepareError(`${label} is not valid JSON.`);
  }
}

// The `[project]` table's static `version = "..."` line.
function pyprojectVersionLine(text) {
  const lines = text.split("\n");
  let inProject = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const table = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (table) {
      inProject = table[1].trim() === "project";
      continue;
    }
    if (!inProject) continue;
    const match = /^(\s*version\s*=\s*)(["'])([^"']+)\2(.*)$/u.exec(line);
    if (match) return { index, prefix: match[1], quote: match[2], version: match[3], rest: match[4], lines };
    if (/^\s*dynamic\s*=.*["']version["']/u.test(line)) {
      throw prepareError("pyproject.toml computes its version dynamically; declare `Version from: external` for this package.");
    }
  }
  throw prepareError("pyproject.toml has no static version in its [project] table.");
}

const SOURCES = Object.freeze({
  "package.json": Object.freeze({
    file: "package.json",
    read(text) {
      const manifest = parseJson(text, "package.json");
      if (typeof manifest.version !== "string") throw prepareError("package.json has no version.");
      return manifest.version;
    },
    spell: (version) => version,
    write(text, from, to) {
      const pattern = new RegExp(`("version"\\s*:\\s*")${from.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(")`, "u");
      const next = text.replace(pattern, `$1${to}$2`);
      const before = parseJson(text, "package.json");
      const after = parseJson(next, "package.json");
      if (after.version !== to || JSON.stringify({ ...after, version: from }) !== JSON.stringify(before)) {
        throw prepareError("package.json's version could not be changed on its own.");
      }
      return next;
    }
  }),
  "pyproject.toml": Object.freeze({
    file: "pyproject.toml",
    read: (text) => pyprojectVersionLine(text).version,
    spell: pep440FromSemver,
    write(text, from, to) {
      const found = pyprojectVersionLine(text);
      if (found.version !== from) throw prepareError("pyproject.toml changed while the release was prepared.");
      found.lines[found.index] = `${found.prefix}${found.quote}${to}${found.quote}${found.rest}`;
      return found.lines.join("\n");
    }
  })
});

function versionSource(entry) {
  const source = entry?.versionFrom;
  if (source === "external") return null;
  if (!SOURCES[source]) throw prepareError(`Package ${entry?.id} has no version source Vibe64 can read.`);
  return SOURCES[source];
}

// The version a package declares in its source right now, as written there
// (PEP 440 for pyproject.toml). External packages are read from the packer's
// own manifest.
async function readSourceVersion({ projectRoot, entry }) {
  const root = packageRoot(projectRoot, entry);
  const source = versionSource(entry) || SOURCES[entry.packer === "python-dist" ? "pyproject.toml" : "package.json"];
  const text = await readOptional(path.join(root, source.file));
  if (text === null) throw prepareError(`Package ${entry.id} has no ${source.file} in ${entry.workdir || "."}.`);
  return source.read(text);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function changelogHeading(version, date) {
  return `## ${version} - ${date}`;
}

// Inserts the new entry above the newest released entry (below an "Unreleased"
// section and the title), or creates the file.
function nextChangelog(text, { version, date, notes }) {
  const entry = `${changelogHeading(version, date)}\n\n${notes}\n`;
  if (text === null || !text.trim()) return `# Changelog\n\n${entry}`;
  if (new RegExp(`^##\\s+\\[?${escapeRegExp(version)}\\]?(?:\\s|$)`, "mu").test(text)) {
    throw prepareError(`CHANGELOG.md already has an entry for ${version}.`);
  }
  const lines = text.split("\n");
  const firstRelease = lines.findIndex((line) => /^##\s+\[?\d/u.test(line));
  if (firstRelease === -1) return `${text.replace(/\n*$/u, "")}\n\n${entry}`;
  return [...lines.slice(0, firstRelease), ...entry.split("\n"), ...lines.slice(firstRelease)].join("\n");
}

function lockfileWithVersion(text, version) {
  const lock = parseJson(text, "package-lock.json");
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  const indent = /^\{\n(\s+)"/u.exec(text)?.[1] || "  ";
  return `${JSON.stringify(lock, null, indent)}\n`;
}

function cleanNotes(notes) {
  if (typeof notes !== "string" || !notes.trim()) throw prepareError("Release notes are needed for the changelog.");
  if (/^#{1,2}\s/mu.test(notes)) throw prepareError("Release notes use ### headings or lists, not # or ## headings.");
  return notes.replace(/\r\n?/gu, "\n").trim();
}

// Computes the exact change without writing it: each file's current and next text.
async function prepareReleaseChange({ projectRoot, entry, version, notes, date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!entry?.id) throw prepareError("A release change needs the Packaging package.");
  if (!isSemver(version)) throw prepareError(`Version ${version} is not a semantic version such as 1.5.0.`);
  if (!DATE.test(date)) throw prepareError("The release date must be YYYY-MM-DD.");
  const source = versionSource(entry);
  if (!source) {
    throw publishError("VIBE64_PUBLISH_VERSION_EXTERNAL", `Package ${entry.id} takes its version from its own release tool; Vibe64 only reads it.`);
  }
  const root = packageRoot(projectRoot, entry);
  const manifestPath = path.join(root, source.file);
  const manifest = await readOptional(manifestPath);
  if (manifest === null) throw prepareError(`Package ${entry.id} has no ${source.file} in ${entry.workdir || "."}.`);
  const current = source.read(manifest);
  const spelled = source.spell(version);
  const currentSemver = entry.versionFrom === "package.json" || /^\d+\.\d+\.\d+$/u.test(current) ? current : null;
  if (currentSemver && isSemver(currentSemver) && compareSemver(version, currentSemver) <= 0) {
    throw prepareError(`Version ${version} must be newer than the current ${currentSemver}.`);
  }
  if (!currentSemver && current === spelled) throw prepareError(`Version ${spelled} is already the current version.`);
  const files = [{ path: relativeTo(projectRoot, manifestPath), before: manifest, after: source.write(manifest, current, spelled) }];
  if (entry.versionFrom === "package.json") {
    const lockPath = path.join(root, "package-lock.json");
    const lock = await readOptional(lockPath);
    if (lock !== null) files.push({ path: relativeTo(projectRoot, lockPath), before: lock, after: lockfileWithVersion(lock, spelled) });
  }
  const changelogPath = path.join(root, CHANGELOG);
  const changelog = await readOptional(changelogPath);
  files.push({
    path: relativeTo(projectRoot, changelogPath),
    before: changelog,
    after: nextChangelog(changelog, { version, date, notes: cleanNotes(notes) })
  });
  return { package: entry.id, previousVersion: current, version, sourceVersion: spelled, date, files };
}

// Writes a prepared change only if every file still holds what it was prepared from.
async function applyReleaseChange({ projectRoot, change } = {}) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) throw prepareError("The project root must be an absolute path.");
  const resolved = change.files.map((file) => {
    const absolute = path.resolve(projectRoot, file.path);
    if (!pathWithin(projectRoot, absolute, { allowRoot: false })) throw prepareError(`${file.path} is outside the project.`);
    return { ...file, absolute };
  });
  for (const file of resolved) {
    if (await readOptional(file.absolute) !== file.before) {
      throw publishError("VIBE64_PUBLISH_PREPARE_STALE", `${file.path} changed after the release was prepared. Prepare it again.`);
    }
  }
  for (const file of resolved) await writeFile(file.absolute, file.after, "utf8");
  return { paths: resolved.map((file) => file.path) };
}

export { applyReleaseChange, nextChangelog, prepareReleaseChange, readSourceVersion };
