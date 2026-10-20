import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";

const UPGRADE_ID = "20261022-learning-space-reset";
const RESET_DIR = ".learning-reset-20261022";
const SLUG_PATTERN = /^training-([a-f0-9]{32})$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
// Attempt data; teacher-notes.json (the learner's own notes) stays.
const LEARNER_FILES = new Set(["progress.json", "active-lesson.json", "step-progress.json", "reader.json",
  "code-ledger.json", "learning-mode.json"]);
const SOURCELESS_STORES = "learning-sessions";

const object = value => value && typeof value === "object" && !Array.isArray(value);

async function kind(target) {
  try {
    const info = await lstat(target);
    return info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
  } catch (error) { if (error.code === "ENOENT") return "missing"; throw error; }
}

async function names(directory) {
  try { return (await readdir(directory)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function validLearnerKey(key) {
  if (typeof key !== "string" || !key || key.length > 171) return false;
  const id = Buffer.from(key, "base64url").toString("utf8");
  return Buffer.from(key, "base64url").toString("base64url") === key && Buffer.from(id).toString("base64url") === key;
}

// The exact v1 practice marker (schema 1, attempt-keyed) on a managed project.
function v1PracticeMarker(record, hex) {
  const training = record?.training;
  return object(training) && training.schemaVersion === 1 && validLearnerKey(training.learnerKey) &&
    typeof training.attemptId === "string" && UUID_PATTERN.test(training.attemptId) &&
    training.attemptId.replaceAll("-", "") === hex && object(training.pin) && training.exercise?.kind === "bundled" &&
    record.repository?.mode === "managed_git" ? training : null;
}

async function fileDigest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

// File list, types, sizes, SHA-256 and link targets: the EXDEV copy proof.
async function treeDigest(root) {
  const entries = [];
  async function walk(target, relative) {
    const info = await lstat(target);
    if (info.isSymbolicLink()) entries.push([relative, "link", await readlink(target)]);
    else if (info.isFile()) entries.push([relative, "file", info.size, await fileDigest(target)]);
    else if (info.isDirectory()) {
      entries.push([relative, "directory"]);
      for (const name of (await readdir(target)).sort()) await walk(path.join(target, name), `${relative}/${name}`);
    } else throw new Error(`Learning reset cannot copy a special file: ${target}. Inspect it before upgrading.`);
  }
  await walk(root, ".");
  return JSON.stringify(entries);
}

async function finishCopy(source, destination) {
  if (await treeDigest(source) !== await treeDigest(destination)) {
    throw new Error(`Learning reset copy differs from its source: ${source}. Inspect both before retrying.`);
  }
  await rm(source, { recursive: true });
}

// Rename; across filesystems copy, then verify and remove the source. A retry
// verifies a published copy whose source removal was interrupted.
async function moveEntry({ source, destination }, renamePath) {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  try { await renamePath(source, destination); return; }
  catch (error) { if (error.code !== "EXDEV") throw error; }
  const partial = `${destination}.partial`;
  await rm(partial, { recursive: true, force: true });
  await cp(source, partial, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false });
  await rename(partial, destination);
  await finishCopy(source, destination);
}

async function readManifest(manifestPath) {
  const kindOfManifest = await kind(manifestPath);
  if (kindOfManifest === "missing") return [];
  let manifest;
  try { if (kindOfManifest === "file") manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* Refused below. */ }
  if (manifest?.upgrade !== UPGRADE_ID || !Array.isArray(manifest.moves) || manifest.moves.some(move =>
    !object(move) || !path.isAbsolute(move.source || "") || !path.isAbsolute(move.destination || ""))) {
    throw new Error("Learning reset manifest is invalid. Inspect it before upgrading.");
  }
  return manifest.moves;
}

async function selectMoves({ systemRoot, projectsRoot, managedSourceRoot, planned, report }) {
  const moves = [];
  const errors = [];
  const retiredRoot = path.join(systemRoot, "training", "retired", UPGRADE_ID);
  const retire = source => ({ source, destination: path.join(retiredRoot, path.relative(systemRoot, source)) });
  const expect = async (target, expected, label) => {
    const actual = await kind(target);
    if (actual !== expected && actual !== "missing") errors.push(`${label} is a ${actual}, not a ${expected}: ${target}.`);
    return actual === expected;
  };

  // Practice projects: exactly the v1-marked managed training-<hex> runtime roots.
  const runtimeInventory = path.join(systemRoot, "projects");
  await verifyUpgradeParents(systemRoot, path.join(runtimeInventory, "placeholder"));
  let selected = 0;
  for (const slug of await names(runtimeInventory)) {
    const hex = SLUG_PATTERN.exec(slug)?.[1];
    if (!hex) continue;
    const runtimeRoot = path.join(runtimeInventory, slug);
    if (planned.has(runtimeRoot)) continue; // An interrupted apply already planned it.
    if (!await expect(runtimeRoot, "directory", "Practice runtime root")) continue;
    const recordPath = path.join(runtimeRoot, "project.json");
    let record = null;
    if (await expect(recordPath, "file", "Practice project record")) {
      try { record = JSON.parse(await readFile(recordPath, "utf8")); } catch { /* A look-alike, reported below. */ }
    }
    const training = v1PracticeMarker(record, hex);
    if (!training) {
      report("warning", `${slug} looks like a practice project but has no valid v1 practice marker; it is left unchanged.`);
      continue;
    }
    const namespaces = [];
    const hosted = projectsRoot && path.join(projectsRoot, slug);
    if (hosted && await expect(hosted, "directory", "Hosted practice namespace")) {
      await verifyUpgradeParents(projectsRoot, hosted);
      namespaces.push({ source: hosted, destination: path.join(projectsRoot, RESET_DIR, slug) });
    } else {
      const local = path.join(systemRoot, "training", "practice", training.learnerKey, training.attemptId, slug);
      await verifyUpgradeParents(systemRoot, local);
      if (await expect(local, "directory", "Local practice namespace")) namespaces.push(retire(local));
      const sessionSource = managedSourceRoot && path.join(managedSourceRoot, slug);
      if (sessionSource && await expect(sessionSource, "directory", "Local practice session source")) {
        await verifyUpgradeParents(managedSourceRoot, sessionSource);
        namespaces.push({ source: sessionSource, destination: path.join(managedSourceRoot, RESET_DIR, slug) });
      }
    }
    if (!namespaces.length) {
      errors.push(`Practice project ${slug} has no namespace${projectsRoot ? "" : "; a hosted workspace must pass --projects-root"}.`);
      continue;
    }
    report("info", `Practice project ${slug} (learner ${training.learnerKey}, lesson ${training.pin.lesson?.code ?? "unknown"}) will be retired.`);
    // Namespaces first: the runtime root holds the marker that identifies them.
    moves.push(...namespaces, retire(runtimeRoot));
    selected++;
  }
  if (projectsRoot && selected) {
    report("warning", `${selected} hosted practice project(s) may have managed databases or resource profiles keyed by their slugs. This upgrade cannot remove them; they become unreachable and never collide with new practice projects.`);
  }

  // Learner attempt state and the source-less teacher's stores.
  for (const namespace of [systemRoot, path.join(systemRoot, "author-preview")]) {
    const usersRoot = path.join(namespace, "training", "users");
    await verifyUpgradeParents(systemRoot, path.join(usersRoot, "placeholder"));
    for (const learner of await names(usersRoot)) {
      const learnerRoot = path.join(usersRoot, learner);
      if (!await expect(learnerRoot, "directory", "Learner directory")) continue;
      for (const name of await names(learnerRoot)) {
        const lock = name.endsWith(".lock");
        if (!LEARNER_FILES.has(name) && !lock && name !== SOURCELESS_STORES) continue;
        const source = path.join(learnerRoot, name);
        if (!await expect(source, name === SOURCELESS_STORES ? "directory" : "file", "Learner state")) continue;
        if (lock) report("warning", `Stale learner lock ${path.relative(systemRoot, source)} will be retired.`);
        report("info", `Learner state ${path.relative(systemRoot, source)} will be retired.`);
        moves.push(retire(source));
      }
    }
  }
  return { moves, errors };
}

/**
 * Learning v2 (20261022): practice projects move to the learning space and old
 * Learning data is disposable. Retire every v1 practice project (strictly by
 * its marker; normal projects are never read beyond their names) and every
 * learner's attempt state and source-less stores. Moves only, nothing deleted:
 * hosted namespaces to <projectsRoot>/.learning-reset-20261022, local session
 * sources to <managedSourceRoot>/.learning-reset-20261022, everything under
 * systemRoot to training/retired/<upgrade id>, outside the upgrade backups that
 * retention removes. The manifest is written before the first move; a retry
 * finishes the same plan. Offline, with every writer stopped.
 */
export async function resetLearningForLearningSpace({ systemRoot, projectsRoot, managedSourceRoot, apply, backupRoot, report,
  renamePath = rename }) {
  for (const root of [systemRoot, backupRoot, projectsRoot, managedSourceRoot]) {
    if (root !== undefined && (!path.isAbsolute(root || "") || path.resolve(root) !== root || root === path.parse(root).root)) {
      throw new Error("Learning reset requires exact absolute installation, projects, managed source and backup directories.");
    }
  }
  const manifestPath = path.join(backupRoot, "manifest.json");
  const saved = await readManifest(manifestPath);
  const planned = new Set(saved.map(move => move.source));
  const { moves: selected, errors } = await selectMoves({ systemRoot, projectsRoot, managedSourceRoot, planned, report });
  const moves = [...saved, ...selected.filter(move => !planned.has(move.source))];
  const pending = [];
  const copied = [];
  for (const move of moves) {
    const [source, destination] = await Promise.all([kind(move.source), kind(move.destination)]);
    if (source === "missing" && destination !== "missing") continue;
    if (source === "missing") errors.push(`Neither ${move.source} nor its retired copy exists.`);
    else if (destination !== "missing" && !planned.has(move.source)) {
      errors.push(`Unexpected destination ${move.destination} already exists.`);
    } else if (destination !== "missing") copied.push(move);
    else pending.push(move);
  }
  if (errors.length) throw new Error(`${errors.join(" ")} Inspect before upgrading.`);
  report("info", `${pending.length + copied.length} Learning item(s) to retire; ${moves.length - pending.length - copied.length} already retired.`);
  if (!apply || !(pending.length + copied.length)) return;
  if (moves.length > saved.length) {
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const temporary = `${manifestPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ upgrade: UPGRADE_ID, moves }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, manifestPath);
  }
  for (const move of copied) await finishCopy(move.source, move.destination);
  for (const move of pending) {
    await moveEntry(move, renamePath);
    report("info", `Retired ${move.source}`);
  }
}
