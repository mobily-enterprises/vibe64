import path from "node:path";
import { lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";

const BACKUP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// A project area's writes hold its lock; a second writer is told it is busy.
async function withProjectAreaLock(stateRoot, name, busy, operation) {
  if (!path.isAbsolute(stateRoot) || path.resolve(stateRoot) === path.parse(stateRoot).root) {
    throw new Error("Project file areas require a project runtime directory.");
  }
  const lockRoot = path.join(stateRoot, "locks");
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  if (await realpath(lockRoot) !== lockRoot) throw new Error("Project lock directory must not contain links.");
  const release = await tryAcquireExclusiveFileLock(path.join(lockRoot, `${name}.lock`));
  if (!release) throw Object.assign(new Error(busy.message), { code: busy.code, statusCode: 409 });
  try { return await operation(); } finally { await release(); }
}

// Project Backups mutations share this lock with retention maintenance.
function withProjectBackupsLock(stateRoot, operation) {
  return withProjectAreaLock(stateRoot, "project-backups", {
    message: "Project backups are busy. Try again shortly.", code: "project_backups_busy"
  }, operation);
}

function withProjectDropZoneLock(stateRoot, operation) {
  return withProjectAreaLock(stateRoot, "project-drop-zone", {
    message: "Project Dropzone is busy. Try again shortly.", code: "project_drop_zone_busy"
  }, operation);
}

// Files expire individually. Never follow links or recursively remove a folder:
// an agent can write here directly, independently of a browser upload's lease.
async function maintainProjectBackups({ stateRoot, dryRun = false, now = Date.now(), signal } = {}) {
  const root = path.join(stateRoot, "backups");
  const result = { status: "success", reclaimedBytes: 0, eligibleBytes: 0, retainedBytes: 0, issues: [] };
  let rootInfo;
  try { rootInfo = await lstat(root); } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  if (!rootInfo.isDirectory() || await realpath(root) !== root) {
    return { ...result, status: "partial", issues: [{ code: "project_backups_path_unverified" }] };
  }
  const inspect = async () => {
    let entries = 0;
    const cutoff = Number(now) - BACKUP_RETENTION_MS;
    if (!Number.isFinite(cutoff)) throw new Error("Invalid backup maintenance time.");
    async function visit(directory) {
      signal?.throwIfAborted();
      if (await realpath(directory) !== directory) throw new Error("project_backups_path_changed");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        signal?.throwIfAborted();
        if (++entries > 100_000) throw new Error("project_backups_scan_limit");
        const target = path.join(directory, entry.name);
        let info;
        try { info = await lstat(target); } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        if (info.isDirectory() && info.dev === rootInfo.dev) {
          await visit(target);
        } else if (info.isFile() && info.dev === rootInfo.dev && info.nlink === 1) {
          const bytes = info.blocks * 512;
          if (Math.max(info.mtimeMs, info.ctimeMs) > cutoff) { result.retainedBytes += bytes; continue; }
          // Recheck parents and identity after traversal, before unlinking. A
          // newly copied old file gets a fresh ctime and a full retention window.
          if (await realpath(directory) !== directory) throw new Error("project_backups_path_changed");
          const current = await lstat(target).catch(error => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (!current || current.dev !== info.dev || current.ino !== info.ino ||
              current.mtimeMs !== info.mtimeMs || current.ctimeMs !== info.ctimeMs) continue;
          result.eligibleBytes += bytes;
          if (!dryRun) { await unlink(target); result.reclaimedBytes += bytes; }
          else result.retainedBytes += bytes;
        } else {
          result.issues.push({ code: "project_backups_entry_unverified" });
        }
      }
    }
    await visit(root);
    if (result.issues.length) result.status = "partial";
    return result;
  };
  return dryRun ? inspect() : withProjectBackupsLock(stateRoot, inspect);
}

export { BACKUP_RETENTION_MS, maintainProjectBackups, withProjectBackupsLock, withProjectDropZoneLock };
