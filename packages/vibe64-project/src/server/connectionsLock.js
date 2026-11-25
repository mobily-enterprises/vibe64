// The pin of each composition connection: which commit of the connected repository the project's
// source was saved with. Save writes it from the session's copies, into the same commit as the
// session's own work, so the project's main names exactly what it was saved with and whatever is
// built from a saved commit (Staging, Production) assembles that commit. The pin is Git's, the
// same for every package type. A dependency connection has none: the project's own manifest and
// lock name the published version it installs.
import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeSourceFileAtomic } from "./projectEnvironmentFiles.js";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { CONNECTIONS_LOCK_FILE, CONNECTIONS_LOCK_SCHEMA } from "@local/vibe64-genesis/shared/connectedPackageTypes";

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PIN_KEYS = Object.freeze(["name", "repository", "commit", "tree"]);

function lockPath(sourceRoot) {
  if (!sourceRoot || !path.isAbsolute(sourceRoot)) {
    throw vibe64Error("An absolute project source root is required.", "vibe64_connections_lock_invalid");
  }
  return path.join(sourceRoot, CONNECTIONS_LOCK_FILE);
}

function invalidLock(reason) {
  return vibe64Error(
    `${CONNECTIONS_LOCK_FILE} ${reason} Vibe64 writes it on Save: restore it from Git, or delete it and Save again to write it from this session's copies.`,
    "vibe64_connections_lock_invalid"
  );
}

function validPin(entry) {
  return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) &&
    Object.keys(entry).length === PIN_KEYS.length &&
    PIN_KEYS.every(key => typeof entry[key] === "string" && entry[key].length > 0) &&
    GIT_OBJECT_ID.test(entry.commit) && GIT_OBJECT_ID.test(entry.tree);
}

/** The lock's text, or null when there is none. A folder or link in its place is refused. */
async function readLockText(sourceRoot) {
  const filePath = lockPath(sourceRoot);
  const entry = await lstat(filePath).catch(error => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!entry) return null;
  if (!entry.isFile()) throw invalidLock("must be an ordinary file, not a symbolic link or folder.");
  return readFile(filePath, "utf8");
}

/**
 * The pins the project's source records, in its list order: [] when it has none.
 * @param {string} sourceRoot
 * @returns {Promise<Array<{ name: string, repository: string, commit: string, tree: string }>>}
 */
async function readConnectionsLock(sourceRoot) {
  const text = await readLockText(sourceRoot);
  if (text === null) return [];
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalidLock("is not valid JSON.");
  }
  if (value?.schema !== CONNECTIONS_LOCK_SCHEMA || !Array.isArray(value.repositories) || Object.keys(value).length !== 2 ||
      !value.repositories.every(validPin)) {
    throw invalidLock(`is not a ${CONNECTIONS_LOCK_SCHEMA} lock.`);
  }
  return value.repositories.map(entry => Object.fromEntries(PIN_KEYS.map(key => [key, entry[key]])));
}

/**
 * The lock a Save writes: one pin per composition connection, in the list's order, from this
 * session's copy where it has one (`commits` by GitHub owner/name), else as the lock already names
 * it. A composition that has neither is not pinned yet.
 * @param {object} input
 * @param {Array<{ name: string, repository: string, fullName: string }>} input.compositions
 * @param {Array<object>} input.previous the pins the lock names now
 * @param {Record<string, { commit: string, tree?: string }>} input.copies
 */
function plannedPins({ compositions, previous, copies }) {
  return compositions.flatMap(composition => {
    const copy = copies[composition.fullName];
    const earlier = previous.find(pin => pin.repository === composition.repository);
    if (copy) return [{ name: composition.name, repository: composition.repository, commit: copy.commit, tree: copy.tree || "" }];
    return earlier ? [{ ...earlier, name: composition.name }] : [];
  });
}

/** Whether these pins differ from the ones the lock names, by name, repository and commit. */
function pinsDiffer(pins, previous) {
  const key = (pin) => `${pin.name}\0${pin.repository}\0${pin.commit}`;
  return pins.map(key).join("\n") !== previous.map(key).join("\n");
}

/**
 * Writes the lock with these pins, or removes it when there are none. Unchanged text is not
 * rewritten.
 * @param {string} sourceRoot
 * @param {Array<{ name: string, repository: string, commit: string, tree: string }>} pins
 * @returns {Promise<{ changed: boolean }>}
 */
async function writeConnectionsLock(sourceRoot, pins) {
  if (!pins.every(validPin)) throw invalidLock("would name a commit or tree that is not a Git object id.");
  const existing = await readLockText(sourceRoot);
  if (!pins.length) {
    if (existing === null) return { changed: false };
    await rm(lockPath(sourceRoot), { force: true });
    return { changed: true };
  }
  const text = `${JSON.stringify({ schema: CONNECTIONS_LOCK_SCHEMA, repositories: pins }, null, 2)}\n`;
  if (existing === text) return { changed: false };
  const modes = vibe64SharedModes();
  await writeSourceFileAtomic(sourceRoot, lockPath(sourceRoot), text, { directoryMode: modes.inheritingDirectory, fileMode: modes.file });
  return { changed: true };
}

/** The composition connections of a list whose entries carry `fullName` (GitHub owner/name). */
function compositionsOf(connections) {
  return connections.filter(connection => connection.relationship === "composition")
    .map(({ name, repository, fullName }) => ({ name, repository, fullName }));
}

/**
 * What Save would pin, given each copy's saved commit (`commits` by owner/name): the composition
 * connections (as owner/name), whether the lock would change, and each pin it would record that the
 * lock does not name yet (`pinsToRecord`, owner/name and commit).
 * @param {{ sourceRoot: string, connections: Array<object>, commits: Record<string, string> }} input
 */
async function planCompositionPins({ sourceRoot, connections, commits }) {
  const compositions = compositionsOf(connections);
  const previous = await readConnectionsLock(sourceRoot);
  const copies = Object.fromEntries(Object.entries(commits).map(([fullName, commit]) => [fullName, { commit }]));
  return {
    compositions: compositions.map(composition => composition.fullName),
    changed: pinsDiffer(plannedPins({ compositions, previous, copies }), previous),
    pinsToRecord: compositions
      .filter(({ fullName, repository }) => commits[fullName] &&
        commits[fullName] !== previous.find(pin => pin.repository === repository)?.commit)
      .map(({ fullName }) => ({ fullName, commit: commits[fullName] }))
  };
}

/**
 * Writes the lock: each composition's copy pins its saved commit and tree (`pins` by owner/name);
 * a composition the session has no copy of keeps its earlier pin.
 * @param {{ sourceRoot: string, connections: Array<object>, pins: Array<{ fullName: string, commit: string, tree: string }> }} input
 */
async function recordCompositionPins({ sourceRoot, connections, pins }) {
  const previous = await readConnectionsLock(sourceRoot);
  const copies = Object.fromEntries(pins.map(({ fullName, commit, tree }) => [fullName, { commit, tree }]));
  return writeConnectionsLock(sourceRoot, plannedPins({ compositions: compositionsOf(connections), previous, copies }));
}

export { CONNECTIONS_LOCK_FILE, planCompositionPins, readConnectionsLock, recordCompositionPins, writeConnectionsLock };
