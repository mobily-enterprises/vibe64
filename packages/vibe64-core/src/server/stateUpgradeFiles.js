import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncDirectory } from "./atomicFile.js";
import { isPlainObject } from "./isPlainObject.js";
import { sha256Hex } from "./sha256Hex.js";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function readUpgradeFile(filePath) {
  try {
    if (!(await lstat(filePath)).isFile()) throw new Error(`Upgrade requires a regular file: ${filePath}`);
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function verifyUpgradeParents(root, filePath) {
  const relative = path.relative(root, path.dirname(filePath));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("State upgrade path is outside its state directory.");
  }
  let current = root;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    try {
      if (!(await lstat(current)).isDirectory()) throw new Error(`State upgrade requires a regular directory: ${current}`);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}
function parse(source, label) {
  if (source === null) return null;
  try {
    const value = JSON.parse(source);
    if (isPlainObject(value)) return value;
  } catch { /* Do not log saved content. */ }
  throw new Error(`${label} is invalid. Inspect it before upgrading state.`);
}
async function fileDigest(filePath) {
  try {
    if (!(await lstat(filePath)).isFile()) throw new Error(`Upgrade requires a regular file: ${filePath}`);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
/**
 * Replaces destination with a copy of source, durably: the copy's data reaches the disk before it is renamed over
 * destination, and its folder after, with each folder made for it, so a power cut leaves the old file or the whole new
 * one, and a backup or manifest this returned for is on the disk.
 */
async function atomicCopy(source, destination) {
  const folder = path.dirname(destination);
  const made = await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, "", { flag: "wx", mode: 0o600 });
    await copyFile(source, temporary);
    await chmod(temporary, 0o600);
    const copy = await open(temporary, "r");
    try {
      await copy.sync();
    } finally {
      await copy.close();
    }
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  await syncFolders(folder, made);
}

/** Syncs folder, and each parent holding a folder mkdir just made (made: the first it made, or undefined). */
async function syncFolders(folder, made) {
  await syncDirectory(folder);
  if (made) for (let child = folder; child.startsWith(made); child = path.dirname(child)) await syncDirectory(path.dirname(child));
}

/**
 * This run's backup folder and the earlier runs' ones, for an upgrade that prepares again from what the state holds
 * whenever it runs: backupRoot the first time, and after a run that stopped part way a new retry-N folder inside it,
 * rather than resuming the stopped run's prepared files, which the previous release (put back by a rollout's
 * rollback while nothing is recorded) may have made stale by writing since. Earlier backups are kept.
 * @param {string} backupRoot
 * @returns {Promise<{ current: string, earlier: string[] }>}
 */
/**
 * An update that holds none of a file's text, for an upgrade whose files together are too big to hold: its contents
 * written to temporaryRoot now when the preparation is staged, or left unstaged for a check that publishes nothing,
 * with the digest of what was read (original: the file's text or bytes, null for none).
 * @param {{ temporaryRoot: string, stage: boolean, filePath: string, original: string | Buffer | null, contents: string | Buffer }} file
 */
export async function stagedUpgradeFile({ temporaryRoot, stage, filePath, original, contents }) {
  const originalDigest = original === null ? null : sha256Hex(original);
  if (!stage) return { filePath, originalDigest, unstaged: true };
  const replacementPath = path.join(temporaryRoot, randomUUID());
  await writeFile(replacementPath, contents, { flag: "wx", mode: 0o600 });
  return { filePath, originalDigest, replacementPath };
}

export async function stateUpgradeRunBackupRoots(backupRoot) {
  const earlier = [];
  for (let attempt = 1; ; attempt += 1) {
    const candidate = attempt === 1 ? backupRoot : path.join(backupRoot, `retry-${attempt}`);
    try {
      await lstat(candidate);
    } catch (error) {
      if (error.code === "ENOENT") return { current: candidate, earlier };
      throw error;
    }
    earlier.push(candidate);
  }
}

/**
 * What everything below some state folders is now: each entry's path, type and mode, identity (device and inode), size,
 * and modification and change times to the nanosecond, as lstat gives them, never following a link. Any write, rename,
 * new or removed entry or change of mode below one changes it; reading changes nothing. One lstat per entry, far less
 * than reading what the entries hold.
 * @param {string} systemRoot
 * @param {string[]} folders absolute folders inside systemRoot, outside its upgrades folder
 */
async function stateFingerprint(systemRoot, folders) {
  const hash = createHash("sha256");
  const line = (entryPath, info) => hash.update(info
    ? `${entryPath}\0${info.mode}\0${info.dev}\0${info.ino}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\n`
    : `${entryPath}\0missing\n`);
  const status = (entryPath) => lstat(entryPath, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const visit = async (directory) => {
    const names = (await readdir(directory)).sort();
    const infos = await Promise.all(names.map((name) => status(path.join(directory, name))));
    for (const [index, name] of names.entries()) line(path.join(directory, name), infos[index]);
    for (const [index, name] of names.entries()) if (infos[index]?.isDirectory()) await visit(path.join(directory, name));
  };
  for (const folder of folders) {
    const relative = path.relative(systemRoot, folder || "");
    if (!path.isAbsolute(folder || "") || !relative || relative.startsWith("..") || path.isAbsolute(relative) ||
        relative === "upgrades" || relative.startsWith(`upgrades${path.sep}`)) {
      throw new Error("A state upgrade's inputs must be folders of its own state.");
    }
    const info = await status(folder);
    line(folder, info);
    if (info?.isDirectory()) await visit(folder);
  }
  return hash.digest("hex");
}

/**
 * One upgrade's hand-over from its check to its apply inside one apply (runStateUpgrades): the preparation its check
 * made, kept for an apply whose inputs have not changed since, so the apply publishes it instead of reading everything
 * again. Whatever is not taken goes with discard().
 */
export function createStateUpgradePlan() {
  const kept = new Map();
  const remove = (preparation) => rm(preparation.temporaryRoot, { recursive: true, force: true });
  async function keep(backupRoot, preparation) {
    if (kept.has(backupRoot)) await remove(kept.get(backupRoot));
    kept.set(backupRoot, preparation);
  }
  function take(backupRoot) {
    const preparation = kept.get(backupRoot) || null;
    kept.delete(backupRoot);
    return preparation;
  }
  async function discard() {
    const preparations = [...kept.values()];
    kept.clear();
    for (const preparation of preparations) await remove(preparation);
  }
  return Object.freeze({
    keep,
    take,
    discard
  });
}

/**
 * A single upgrade-owned manifest retains both sides of every file replacement.
 * This is intentionally separate from the general runner's lock and ledger.
 *
 * Each update names its `filePath` and either its new `contents` (null removes the file) or a `replacementPath` staged in
 * `temporaryRoot`, with what it read of the file: `original` (its text, null for none) or `originalDigest` (its sha256,
 * null for none), which an upgrade that must not hold every file's text gives instead.
 * `prepareUpdates(temporaryRoot, { stage })` returns the updates, or `{ updates, reusable }`. `stage` is false only for a
 * check whose preparation nothing publishes (a standalone check): the upgrade still reads and inspects everything an
 * apply would, refusing what an apply refuses, but may leave a replacement it would only discard unbuilt (an archive's
 * repacking), as `{ filePath, unstaged: true }`, which is counted and never published. An upgrade that names its `inputs`
 * (an async function giving the folders of its state its preparation reads, and nothing else) and is given a `plan`
 * (the runner gives one to the check and the apply of each upgrade it applies) prepares once: its check keeps what it
 * prepared with a fingerprint of those folders, and its apply publishes that when the fingerprint is unchanged (an
 * earlier upgrade of the same apply changed nothing there). It prepares again when they changed, or when its check's
 * preparation said `reusable: false` (it accepted, for the check, a state an apply refuses). Either way the apply
 * re-verifies each file it changes against what the check read, and backs it up, before the first change.
 */
export async function publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates, inputs = null, plan = null }) {
  const manifestPath = path.join(backupRoot, "manifest.json");
  await verifyUpgradeParents(systemRoot, manifestPath);
  let manifest = parse(await readUpgradeFile(manifestPath), "State upgrade backup manifest");
  const relativeFile = (filePath) => {
    const relative = path.relative(systemRoot, filePath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        relative.startsWith(`upgrades${path.sep}`)) throw new Error("State upgrade contains a path outside its owned state.");
    return relative;
  };
  const handsOver = typeof inputs === "function" && Boolean(plan);
  const fingerprint = async () => stateFingerprint(systemRoot, await inputs());
  async function prepare(withFingerprint) {
    const read = withFingerprint ? await fingerprint() : null;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-state-upgrade-"));
    try {
      const stage = apply || handsOver;
      const prepared = await prepareUpdates(temporaryRoot, { stage });
      const { updates, reusable = true } = Array.isArray(prepared) ? { updates: prepared } : prepared;
      const changed = updates.filter((entry) => entry.replacementPath || entry.unstaged || entry.original !== entry.contents);
      if (stage && changed.some((entry) => entry.unstaged)) {
        throw new Error("A state upgrade left a file unstaged for a preparation that is published.");
      }
      report("info", `${changed.length} state file(s) to change.`);
      for (const update of changed) {
        update.relative = relativeFile(update.filePath);
        await verifyUpgradeParents(systemRoot, update.filePath);
        update.before = await fileDigest(update.filePath);
        // What the preparation read: its text, or (an upgrade that keeps no file's text) its digest, null for none.
        const read = Object.hasOwn(update, "originalDigest") ? update.originalDigest
          : Object.hasOwn(update, "original") ? (update.original === null ? null : sha256Hex(update.original)) : update.before;
        if (update.before !== read) {
          throw new Error(`Application state changed during preparation: ${update.relative}. Stop all writers before retrying.`);
        }
        const beforePath = path.join(backupRoot, "before", update.relative);
        await verifyUpgradeParents(backupRoot, beforePath);
        const saved = await fileDigest(beforePath);
        if (saved && saved !== update.before) {
          throw new Error(`State backup differs from the original: ${update.relative}. Inspect it before retrying.`);
        }
      }
      return { changed, fingerprint: read, reusable: reusable !== false, temporaryRoot };
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }
  if (!manifest) {
    let preparation = null;
    if (handsOver && apply) {
      const checked = plan.take(backupRoot);
      if (checked) {
        if (checked.fingerprint === await fingerprint()) {
          preparation = checked;
          report("info", `Publishing the ${checked.changed.length} state file(s) the check prepared: nothing it read has changed since.`);
        } else {
          await rm(checked.temporaryRoot, { recursive: true, force: true });
          report("info", "What the check read has changed since (an earlier upgrade wrote there): preparing again.");
        }
      }
    }
    preparation ||= await prepare(handsOver && !apply);
    const { changed, temporaryRoot } = preparation;
    try {
      if (!apply && handsOver && preparation.reusable) {
        // Each file's digest stands for what the check read of it from here on.
        for (const update of changed) delete update.original;
        await plan.keep(backupRoot, preparation);
        preparation = null;
        return;
      }
      if (!apply || !changed.length) return;
      // No application file changes before every before/after copy is durable.
      manifest = { version: 1, files: [] };
      for (const update of changed) {
        const { relative, before } = update;
        if (await fileDigest(update.filePath) !== before) {
          throw new Error(`Application state changed during preparation: ${relative}. Stop all writers before retrying.`);
        }
        const beforePath = path.join(backupRoot, "before", relative);
        await verifyUpgradeParents(backupRoot, beforePath);
        if (before !== null) {
          const saved = await fileDigest(beforePath);
          if (saved && saved !== before) {
            throw new Error(`State backup differs from the original: ${relative}. Inspect it before retrying.`);
          }
          if (!saved) await atomicCopy(update.filePath, beforePath);
          if (await fileDigest(beforePath) !== before) throw new Error(`State backup could not be verified: ${relative}.`);
        }
        const afterPath = path.join(backupRoot, "after", relative);
        await verifyUpgradeParents(backupRoot, afterPath);
        let after = null;
        if (update.contents !== null) {
          const staged = update.replacementPath || path.join(temporaryRoot, randomUUID());
          if (!update.replacementPath) await writeFile(staged, update.contents, { mode: 0o600, flag: "wx" });
          await atomicCopy(staged, afterPath);
          after = await fileDigest(afterPath);
        }
        manifest.files.push({ path: relative, before, after });
      }
      const stagedManifest = path.join(temporaryRoot, "manifest.json");
      await writeFile(stagedManifest, json(manifest), { mode: 0o600 });
      await atomicCopy(stagedManifest, manifestPath);
    } finally {
      // A preparation kept for the apply stays until the apply takes it or the runner discards it.
      if (preparation) await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length ||
      new Set(manifest.files.map((entry) => entry?.path)).size !== manifest.files.length) {
    throw new Error(
      "State upgrade backup manifest is unsupported."
    );
  }
  // Preflight every original, replacement and destination before resuming writes.
  for (const entry of manifest.files) {
    if (!isPlainObject(entry) || typeof entry.path !== "string" || relativeFile(path.join(systemRoot, entry.path)) !== entry.path ||
        [entry.before, entry.after].some((value) => value !== null && !/^[a-f0-9]{64}$/u.test(value))) {
      throw new Error(
        "State upgrade backup manifest has an invalid file entry."
      );
    }
    await verifyUpgradeParents(systemRoot, path.join(systemRoot, entry.path));
    for (const side of ["before", "after"]) {
      await verifyUpgradeParents(backupRoot, path.join(backupRoot, side, entry.path));
      if (await fileDigest(path.join(backupRoot, side, entry.path)) !== entry[side]) {
        throw new Error(`State upgrade ${side} copy is missing or changed: ${entry.path}. Restore the backup before retrying.`);
      }
    }
    const current = await fileDigest(path.join(systemRoot, entry.path));
    if (current !== entry.before && current !== entry.after) {
      throw new Error(`Application state differs from both upgrade copies: ${entry.path}. Inspect it before retrying.`);
    }
  }
  report("info", `Verified ${manifest.files.length} backed-up state changes${apply ? "; finishing publication" : "; ready to resume"}.`);
  if (!apply) return;
  // Preserve the owner's publication order and prepared bytes on every retry.
  for (const entry of manifest.files) {
    const destination = path.join(systemRoot, entry.path);
    if (await fileDigest(destination) === entry.after) continue;
    if (entry.after === null) {
      await rm(destination);
      await syncFolders(path.dirname(destination));
    } else {
      await atomicCopy(path.join(backupRoot, "after", entry.path), destination);
    }
    report("info", `Published state: ${entry.path}`);
  }
}

