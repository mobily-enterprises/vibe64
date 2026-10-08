import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { listProjectRuntimeRoots, resolveProjectRecordPath } from "@local/vibe64-core/server/projectState";
import { readProjectRecordMetadata } from "@local/vibe64-core/server/projectRecordMetadata";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createInstalledTrainingContent } from "./installedContent.js";
import { createTrainingLearnerState } from "./learnerState.js";

// Candidate CLI only, with original writers stopped. Durable preparation owns
// this narrow historical adoption; project names and browser context do not.
export async function upgradeLearningPracticeHistory({ systemRoot, backupRoot, apply, report }) {
  if (!path.isAbsolute(systemRoot || "") || path.resolve(systemRoot) !== systemRoot ||
      systemRoot === path.parse(systemRoot).root || backupRoot !== path.join(systemRoot, "upgrades", "backups", "20261008-learning-practice-history")) {
    throw new Error("Practice history upgrade requires the candidate's exact installation and numbered backup root.");
  }
  const manifestPath = path.join(backupRoot, "manifest.json");
  await verifyUpgradeParents(systemRoot, manifestPath);
  const manifestText = await readUpgradeFile(manifestPath);
  let manifest = null;
  if (manifestText !== null) {
    try { manifest = JSON.parse(manifestText); }
    catch (cause) { throw new Error("Practice history backup manifest is invalid. Inspect the original backup before retrying.", { cause }); }
    if (manifest?.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length ||
        new Set(manifest.files.map(value => value?.path)).size !== manifest.files.length) {
      throw new Error("Practice history backup manifest is unsupported. Inspect the original backup before retrying.");
    }
    for (const entry of manifest.files) {
      const filename = typeof entry?.path === "string" && path.resolve(systemRoot, entry.path);
      const relative = filename && path.relative(systemRoot, filename);
      if (!relative || relative !== entry.path || relative === ".." || relative.startsWith(`..${path.sep}`) ||
          relative.startsWith(`upgrades${path.sep}`)) throw new Error("Practice history backup has an invalid owned path.");
      await verifyUpgradeParents(systemRoot, path.join(backupRoot, "after", entry.path));
    }
  }
  const runtimeRoots = new Set(await listProjectRuntimeRoots(systemRoot));
  const claims = new Map();
  const namespaces = [
    { name: "normal", root: systemRoot, content: createInstalledTrainingContent({ systemRoot }) },
    { name: "author-preview", root: path.join(systemRoot, "author-preview"), content: createInstalledTrainingContent({ systemRoot, allowDraftLessons: true }) }
  ];
  for (const namespace of namespaces) {
    const usersRoot = path.join(namespace.root, "training", "users");
    await verifyUpgradeParents(systemRoot, path.join(usersRoot, ".inventory"));
    let entries;
    try { entries = await readdir(usersRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const learners = createTrainingLearnerState({ systemRoot: namespace.root, content: namespace.content });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) throw new Error(`Practice history ${namespace.name} learner inventory contains a non-directory. Inspect it before upgrading.`);
      const learnerId = Buffer.from(entry.name, "base64url").toString("utf8");
      if (!learnerId || Buffer.from(learnerId).toString("base64url") !== entry.name) {
        throw new Error(`Practice history ${namespace.name} learner key is not canonical. Inspect its original owner.`);
      }
      const actor = { uid: learnerId }; // Offline durable identity validation, not a signed-in user or authorization grant.
      const progressPath = path.join(usersRoot, entry.name, "progress.json");
      await verifyUpgradeParents(systemRoot, progressPath);
      if (await readUpgradeFile(progressPath) === null) {
        throw new Error(`Practice history ${namespace.name} learner has no saved progress. Inspect its incomplete original write.`);
      }
      const saved = await learners.readState({ actor, includeCompletion: true });
      for (const attempt of saved.progress.attempts) {
        const lesson = await namespace.content.readLesson({ ...attempt.pin.topic,
          lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
        if (!lesson.lesson.exercise || attempt.preparation.phase === "reserved") continue;
        const source = await learners.readExerciseProjectScope({ actor, attemptId: attempt.attemptId, access: "observe" });
        const key = source.projectSlug;
        if (claims.has(key)) throw new Error(`Practice ${key} is claimed by multiple saved learner namespaces or attempts. Inspect ownership before upgrading.`);
        const projectRuntimeRoot = path.join(systemRoot, "projects", source.projectSlug);
        if (!runtimeRoots.has(projectRuntimeRoot)) {
          if (attempt.preparation.phase === "ready") throw new Error(`Prepared practice ${source.projectSlug} has no original runtime. Restore or inspect its original owner before upgrading.`);
          report("warning", `Practice ${source.projectSlug} has no initial project yet; preparing progress remains unchanged.`);
          claims.set(key, { ...source, phase: attempt.preparation.phase, missing: true });
          continue;
        }
        const projectRecordPath = resolveProjectRecordPath({ projectRuntimeRoot });
        await verifyUpgradeParents(systemRoot, projectRecordPath);
        if (await readUpgradeFile(projectRecordPath) === null) throw new Error(`Practice ${source.projectSlug} has no original project record.`);
        if ((await lstat(projectRecordPath)).nlink !== 1) throw new Error(`Practice ${source.projectSlug} has aliased project metadata. Inspect its original owner.`);
        const metadata = await readProjectRecordMetadata(projectRecordPath);
        if (!isDeepStrictEqual(metadata.training, source.training) || metadata.repository?.mode !== "managed_git" || metadata.deletion) {
          throw new Error(`Practice ${source.projectSlug} differs from its saved Training marker or managed repository. Inspect it before upgrading.`);
        }
        claims.set(key, { ...source, phase: attempt.preparation.phase,
          store: createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot }) });
      }
    }
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), "vibe64-practice-history-"));
  try {
    const updates = [];
    const ownedFiles = new Set();
    for (const claim of claims.values()) {
      if (claim.missing) continue;
      const relativeRuntime = path.relative(systemRoot, claim.store.paths().stateRoot);
      const preparedReplacements = (manifest?.files || []).filter(entry => entry.path.startsWith(`${relativeRuntime}${path.sep}`))
        .map(entry => ({ filePath: path.join(systemRoot, entry.path), replacementPath: path.join(backupRoot, "after", entry.path) }));
      const prepared = await claim.store.prepareLearningSessionBindingUpgrade({ temporaryRoot: scratch,
        sessionId: claim.initialSessionId, learningScope: claim.scope, preparedReplacements });
      if (!prepared.found) {
        if (claim.phase === "ready") throw new Error(`Prepared practice ${claim.projectSlug} has no exact saved initial session. Restore or inspect it before upgrading.`);
        report("warning", `Practice ${claim.projectSlug} has no initial session yet; preparing progress remains unchanged.`);
        continue;
      }
      for (const file of prepared.files) ownedFiles.add(path.relative(systemRoot, file.filePath));
      updates.push(...prepared.updates);
      report("info", `Verified practice ${claim.projectSlug}, initial session ${claim.initialSessionId}; ${prepared.updates.length ? "historical binding staged" : "exact binding already current"}.`);
    }
    if (manifest && manifest.files.some(entry => !ownedFiles.has(entry.path))) {
      throw new Error("Practice history backup has a replacement no longer authorized by a saved preparation. Inspect its owner before retrying.");
    }
    // This revalidation also runs on frozen-manifest retries. The original
    // publisher then verifies all hashes and resumes its SAME prepared bytes.
    return await publishStateUpgradeFiles({ systemRoot, backupRoot, apply, report,
      prepareUpdates: async () => updates });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
