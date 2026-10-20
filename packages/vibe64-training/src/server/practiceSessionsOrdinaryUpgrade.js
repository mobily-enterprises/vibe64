import { lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishStateUpgradeFiles, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { practiceProjectAttemptId } from "@local/vibe64-core/server/practiceProjects";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

const UPGRADE_ID = "20261021-practice-sessions-ordinary";

async function directoryEntries(root, label) {
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error(`${label} must be a regular directory. Inspect it before upgrading.`);
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.some(entry => entry.isSymbolicLink())) throw new Error(`${label} contains a symbolic link. Inspect it before upgrading.`);
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

// Practice-session bindings: each training-<attemptId> session in a practice
// project's runtime loses its learning_session file and archive index entry.
async function practiceSessionUpdates({ systemRoot, temporaryRoot, report }) {
  const updates = [];
  for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
    const slug = path.basename(projectRuntimeRoot);
    if (!practiceProjectAttemptId(slug)) continue;
    const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
    if (!await lstat(store.paths().sessionsRoot).then(info => info.isDirectory(), error => {
      if (error.code === "ENOENT") return false;
      throw error;
    })) continue;
    const prepared = await store.prepareLearningSessionUnbindingUpgrade({ temporaryRoot });
    for (const sessionId of prepared.sessionIds) report("info", `Practice ${slug}: session ${sessionId} becomes an ordinary project session.`);
    updates.push(...prepared.updates);
  }
  return updates;
}

// Source-less learning stores (training/users/<key>/learning-sessions/<attemptId>)
// are retired whole into this upgrade's backup root; nothing is deleted.
async function sourcelessLearningStores({ systemRoot, backupRoot }) {
  const stores = [];
  for (const namespace of [systemRoot, path.join(systemRoot, "author-preview")]) {
    const usersRoot = path.join(namespace, "training", "users");
    await verifyUpgradeParents(systemRoot, path.join(usersRoot, "placeholder"));
    for (const user of await directoryEntries(usersRoot, "Training learner inventory")) {
      if (!user.isDirectory()) continue;
      const root = path.join(usersRoot, user.name, "learning-sessions");
      for (const entry of await directoryEntries(root, "Learning session inventory")) {
        if (!entry.isDirectory()) throw new Error("Learning session inventory contains a non-directory. Inspect it before upgrading.");
        const source = path.join(root, entry.name);
        stores.push({ source, destination: path.join(backupRoot, "retired", path.relative(systemRoot, source)) });
      }
    }
  }
  return stores;
}

// Candidate CLI only, with every writer stopped. Learning v2: practice sessions
// are ordinary project sessions and the source-less teacher's saved sessions
// retire. Colleague's learning-task watches retire through its own owner.
export async function upgradeLearningPracticeSessionsOrdinary({ systemRoot, backupRoot, apply, report }) {
  if (!path.isAbsolute(systemRoot || "") || path.resolve(systemRoot) !== systemRoot ||
      systemRoot === path.parse(systemRoot).root || backupRoot !== path.join(systemRoot, "upgrades", "backups", UPGRADE_ID, "training")) {
    throw new Error("Ordinary practice-session upgrade requires the candidate's exact installation and numbered backup root.");
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), "vibe64-practice-ordinary-"));
  try {
    // A frozen manifest from an interrupted apply is resumed with its same
    // prepared bytes; the publisher verifies every copy before writing.
    await publishStateUpgradeFiles({ systemRoot, backupRoot, apply, report,
      prepareUpdates: () => practiceSessionUpdates({ systemRoot, temporaryRoot: scratch, report }) });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const stores = await sourcelessLearningStores({ systemRoot, backupRoot });
  report("info", `${stores.length} source-less learning session store(s) to retire.`);
  for (const { source, destination } of stores) {
    await verifyUpgradeParents(backupRoot, destination);
    if (await lstat(destination).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) {
      throw new Error(`A retired learning session store already exists in the backup: ${path.relative(systemRoot, source)}. Inspect both before retrying.`);
    }
    if (!apply) continue;
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await rename(source, destination);
    report("info", `Retired learning session store: ${path.relative(systemRoot, source)}`);
  }
}
