import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { readPinnedTopic } from "./catalogue.js";
import { runTrainingCli } from "./cli.js";
import { canonicalJson } from "./content.js";
import { createInstalledTrainingContent, validateInstalledTopicPin } from "./installedContent.js";

function absoluteDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) ||
      path.resolve(value) !== value || value === path.parse(value).root) {
    throw new Error(`${label} must be a normalized absolute, non-root server-owned directory.`);
  }
  return value;
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function inspectPath(filename, directory, allowMissing = true) {
  let stat;
  try {
    stat = await lstat(filename);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink() || await realpath(filename) !== filename) {
    throw new Error("Training installation cannot use symlink or directory aliases.");
  }
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`Training installation needs a regular ${directory ? "directory" : "file"}: ${filename}.`);
  }
  if (!directory && (stat.nlink !== 1 || stat.size !== 0)) {
    throw new Error("Training installation lock must be an unaliased empty regular file; inspect it before retrying.");
  }
  return stat;
}

async function inspectDirectoryChain(directory, allowMissing = false) {
  const parent = path.dirname(directory);
  if (parent !== directory) await inspectDirectoryChain(parent, allowMissing);
  return inspectPath(directory, true, allowMissing);
}

async function ensureDirectory(directory) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await inspectPath(directory, true, false);
}

function requireMatchingPin(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error("Topic source or installed snapshot conflicts with the approved owner pin. Keep existing content and check the exact source revision.");
  }
}

async function verifySourcePin(sourceRoot, pin) {
  const { topicId, release, repository, commit, topicHash } = await readPinnedTopic(sourceRoot);
  requireMatchingPin({ schemaVersion: 1, topicId, release, repository, commit, topicHash }, pin);
}

// Only an admitted owner operation supplies these paths and pins. This service
// does not authenticate callers, select content, enable courses or run exercises.
function createTrainingContentInstaller({ systemRoot } = {}) {
  const root = absoluteDirectory(systemRoot, "Training system root");
  const reader = createInstalledTrainingContent({ systemRoot: root });

  async function installTopic({ sourceRoot, pin: inputPin } = {}) {
    const pin = { ...validateInstalledTopicPin(inputPin) };
    absoluteDirectory(sourceRoot, "Trusted topic source root");
    const trainingRoot = path.join(root, "training");
    if (contains(sourceRoot, trainingRoot) || contains(trainingRoot, sourceRoot)) {
      throw new Error("Trusted topic source must be separate from the training installation namespace.");
    }
    const contentRoot = path.join(trainingRoot, "content");
    const topicRoot = path.join(contentRoot, pin.topicId);
    const snapshotRoot = path.join(topicRoot, pin.commit);
    const locksRoot = path.join(trainingRoot, ".install-locks");
    const lockPath = path.join(locksRoot, `${pin.topicId}-${pin.commit}.lock`);

    // Check every existing parent and alias before creating any owned path.
    await inspectDirectoryChain(root);
    const source = await inspectDirectoryChain(sourceRoot, true);
    for (const directory of [trainingRoot, contentRoot, topicRoot, locksRoot]) {
      await inspectPath(directory, true);
    }
    await inspectPath(lockPath, false);
    const existing = await inspectPath(snapshotRoot, true);
    if (existing) requireMatchingPin((await reader.readTopic(pin)).pin, pin);
    else {
      if (!source) throw new Error("Trusted topic source is missing. Prepare the approved local repository before installing its pin.");
      await verifySourcePin(sourceRoot, pin);
    }

    for (const directory of [trainingRoot, contentRoot, topicRoot, locksRoot]) {
      await ensureDirectory(directory);
    }
    const release = await tryAcquireExclusiveFileLock(lockPath);
    if (!release) {
      const error = new Error("This topic revision is being installed. Retry after the current owner operation finishes.");
      error.code = "VIBE64_TRAINING_INSTALL_BUSY";
      error.statusCode = 409;
      throw error;
    }
    let stageRoot;
    try {
      await inspectPath(lockPath, false, false);
      for (const directory of [root, trainingRoot, contentRoot, topicRoot, locksRoot]) {
        await inspectPath(directory, true, false);
      }
      if (await inspectPath(snapshotRoot, true)) {
        const result = await reader.readTopic(pin);
        requireMatchingPin(result.pin, pin);
        return { installed: false, ...result };
      }
      await inspectDirectoryChain(sourceRoot);
      await verifySourcePin(sourceRoot, pin);
      const requestedStage = path.join(trainingRoot, `.install-${randomUUID()}`);
      await mkdir(requestedStage, { mode: 0o700 });
      stageRoot = requestedStage;
      const stagedParent = path.join(stageRoot, "training", "content", pin.topicId);
      await mkdir(stagedParent, { recursive: true, mode: 0o700 });
      const stagedSnapshot = path.join(stagedParent, pin.commit);
      await runTrainingCli(["bundle", sourceRoot, stagedSnapshot], { write() {} });
      await verifySourcePin(sourceRoot, pin);
      await writeFile(path.join(stagedSnapshot, "pin.json"), `${canonicalJson(pin)}\n`, { flag: "wx", mode: 0o600 });
      await createInstalledTrainingContent({ systemRoot: stageRoot }).readTopic(pin);
      await inspectPath(topicRoot, true, false);
      if (await inspectPath(snapshotRoot, true)) {
        throw new Error("The destination appeared during installation. Keep it unchanged and retry the verified pin.");
      }
      // The persistent per-pin lock excludes cooperating installer writers.
      // Same-filesystem rename publishes the complete verified snapshot; writers
      // bypassing this owner are outside that concurrency guarantee.
      await rename(stagedSnapshot, snapshotRoot);
      const result = await reader.readTopic(pin);
      requireMatchingPin(result.pin, pin);
      return { installed: true, ...result };
    } finally {
      try {
        if (stageRoot) await rm(stageRoot, { recursive: true, force: true });
      } finally {
        await release();
      }
    }
  }

  return { installTopic };
}

export { createTrainingContentInstaller };
