import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function readUpgradeFile(filePath) {
  try {
    if (!(await lstat(filePath)).isFile()) throw new Error(`Upgrade requires a regular file: ${filePath}`);
    return await readFile(filePath, "utf8");
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function verifyUpgradeParents(root, filePath) {
  const relative = path.relative(root, path.dirname(filePath));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("State upgrade path is outside its state directory.");
  let current = root;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    try {
      if (!(await lstat(current)).isDirectory()) throw new Error(`State upgrade requires a regular directory: ${current}`);
    } catch (error) { if (error.code === "ENOENT") return; throw error; }
  }
}
function parse(source, label) {
  if (source === null) return null;
  try { const value = JSON.parse(source); if (object(value)) return value; } catch { /* Do not log saved content. */ }
  throw new Error(`${label} is invalid. Inspect it before upgrading state.`);
}
async function fileDigest(filePath) {
  try { if (!(await lstat(filePath)).isFile()) throw new Error(`Upgrade requires a regular file: ${filePath}`); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
async function atomicCopy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, "", { flag: "wx", mode: 0o600 });
    await copyFile(source, temporary);
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

// A single upgrade-owned manifest retains both sides of every file replacement.
// This is intentionally separate from the general runner's lock and ledger.
export async function publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates }) {
  const manifestPath = path.join(backupRoot, "manifest.json");
  await verifyUpgradeParents(systemRoot, manifestPath);
  let manifest = parse(await readUpgradeFile(manifestPath), "State upgrade backup manifest");
  const relativeFile = (filePath) => {
    const relative = path.relative(systemRoot, filePath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        relative.startsWith(`upgrades${path.sep}`)) throw new Error("State upgrade contains a path outside its owned state.");
    return relative;
  };
  if (!manifest) {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-state-upgrade-"));
    try {
      const updates = await prepareUpdates(temporaryRoot);
      const changed = updates.filter((entry) => entry.replacementPath || entry.original !== entry.contents);
      report("info", `${changed.length} state file(s) to change.`);
      for (const update of changed) {
        update.relative = relativeFile(update.filePath);
        await verifyUpgradeParents(systemRoot, update.filePath);
        update.before = await fileDigest(update.filePath);
        if (Object.hasOwn(update, "original") && update.before !== (update.original === null ? null : digest(update.original))) {
          throw new Error(`Application state changed during preparation: ${update.relative}. Stop all writers before retrying.`);
        }
        const beforePath = path.join(backupRoot, "before", update.relative);
        await verifyUpgradeParents(backupRoot, beforePath);
        const saved = await fileDigest(beforePath);
        if (saved && saved !== update.before) throw new Error(`State backup differs from the original: ${update.relative}. Inspect it before retrying.`);
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
          if (saved && saved !== before) throw new Error(`State backup differs from the original: ${relative}. Inspect it before retrying.`);
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
    } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length ||
      new Set(manifest.files.map((entry) => entry?.path)).size !== manifest.files.length) throw new Error("State upgrade backup manifest is unsupported.");
  // Preflight every original, replacement and destination before resuming writes.
  for (const entry of manifest.files) {
    if (!object(entry) || typeof entry.path !== "string" || relativeFile(path.join(systemRoot, entry.path)) !== entry.path ||
        [entry.before, entry.after].some((value) => value !== null && !/^[a-f0-9]{64}$/u.test(value))) throw new Error("State upgrade backup manifest has an invalid file entry.");
    await verifyUpgradeParents(systemRoot, path.join(systemRoot, entry.path));
    for (const side of ["before", "after"]) {
      await verifyUpgradeParents(backupRoot, path.join(backupRoot, side, entry.path));
      if (await fileDigest(path.join(backupRoot, side, entry.path)) !== entry[side]) throw new Error(`State upgrade ${side} copy is missing or changed: ${entry.path}. Restore the backup before retrying.`);
    }
    const current = await fileDigest(path.join(systemRoot, entry.path));
    if (current !== entry.before && current !== entry.after) throw new Error(`Application state differs from both upgrade copies: ${entry.path}. Inspect it before retrying.`);
  }
  report("info", `Verified ${manifest.files.length} backed-up state changes${apply ? "; finishing publication" : "; ready to resume"}.`);
  if (!apply) return;
  // Preserve the owner's publication order and prepared bytes on every retry.
  for (const entry of manifest.files) {
    const destination = path.join(systemRoot, entry.path);
    if (await fileDigest(destination) === entry.after) continue;
    if (entry.after === null) await rm(destination);
    else await atomicCopy(path.join(backupRoot, "after", entry.path), destination);
    report("info", `Published state: ${entry.path}`);
  }
}

