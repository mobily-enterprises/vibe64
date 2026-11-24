import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./files.mjs";

// Writing an update's manifests and installing it, each undoable: manifest
// writes are atomic per file and restorable, and `npm install` runs against a
// moved-aside node_modules that a rollback puts back.

async function writeManifestUpdates(updates = []) {
  const temporaryPaths = [];
  const committed = [];
  try {
    for (const [index, update] of updates.entries()) {
      const temporaryPath = `${update.manifest.absolutePath}.jskit-${process.pid}-${index}.tmp`;
      await writeFile(temporaryPath, update.contents, "utf8");
      temporaryPaths.push(temporaryPath);
    }
    for (const [index, update] of updates.entries()) {
      await rename(temporaryPaths[index], update.manifest.absolutePath);
      committed.push(update);
    }
  } catch (error) {
    for (const update of committed) {
      await writeFile(update.manifest.absolutePath, update.manifest.contents, "utf8");
    }
    throw error;
  } finally {
    await Promise.all(temporaryPaths.map((temporaryPath) => rm(temporaryPath, { force: true })));
  }
}

async function readOptionalFile(absolutePath) {
  try {
    return Object.freeze({
      contents: await readFile(absolutePath, "utf8"),
      exists: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({
        contents: "",
        exists: false
      });
    }
    throw error;
  }
}

async function restoreProjectFiles(updates, packageLockPath, packageLockSnapshot) {
  const rollbackUpdates = updates.map((update) => Object.freeze({
    contents: update.manifest.contents,
    manifest: Object.freeze({
      ...update.manifest,
      contents: update.contents
    })
  }));
  await writeManifestUpdates(rollbackUpdates);
  if (packageLockSnapshot.exists) {
    const temporaryPath = `${packageLockPath}.jskit-${process.pid}-rollback.tmp`;
    try {
      await writeFile(temporaryPath, packageLockSnapshot.contents, "utf8");
      await rename(temporaryPath, packageLockPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return;
  }
  await rm(packageLockPath, { force: true });
}

async function spawnNpmInstall(projectRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install failed (code=${code}, signal=${signal || "none"}).`));
    });
  });
}

async function runNpmInstall(projectRoot) {
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  const hadNodeModules = await fileExists(nodeModulesPath);
  const backupRoot = hadNodeModules
    ? await mkdtemp(path.join(projectRoot, ".jskit-update-"))
    : null;
  // Preserve the dependency directory name so development watchers keep excluding it.
  const backupPath = backupRoot ? path.join(backupRoot, "node_modules") : null;
  if (hadNodeModules) {
    try {
      await rename(nodeModulesPath, backupPath);
    } catch (error) {
      await rm(backupRoot, { force: true, recursive: true });
      throw error;
    }
  }

  let settled = false;
  const transaction = Object.freeze({
    async commit() {
      if (settled) {
        return;
      }
      if (backupRoot) {
        await rm(backupRoot, { force: true, recursive: true });
      }
      settled = true;
    },
    async rollback() {
      if (settled) {
        return;
      }
      try {
        await rm(nodeModulesPath, { force: true, recursive: true });
        if (backupPath) {
          await rename(backupPath, nodeModulesPath);
        }
      } catch (error) {
        if (backupPath) {
          throw new Error(`Could not restore node_modules; backup retained at ${backupPath}.`, { cause: error });
        }
        throw error;
      }
      if (backupRoot) {
        await rm(backupRoot, { force: true, recursive: true });
      }
      settled = true;
    }
  });

  try {
    await spawnNpmInstall(projectRoot);
    return transaction;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `npm install failed and the previous node_modules directory could not be restored. ${rollbackError.message}`
      );
    }
    throw error;
  }
}

export { readOptionalFile, restoreProjectFiles, runNpmInstall, writeManifestUpdates };
