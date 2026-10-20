import { readdir } from "node:fs/promises";
import path from "node:path";
import { readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createInstalledTrainingContent } from "./installedContent.js";
import { createTrainingLearnerState } from "./learnerState.js";

// Candidate CLI only, with writers stopped. Read-only preflight for the
// 20261020-training-step-progress boundary: every saved learner record in the
// normal and author-preview stores must already be readable by this release's
// validators. Nothing is converted, created or backed up.
export async function inspectTrainingStepProgress({ systemRoot, report }) {
  if (!path.isAbsolute(systemRoot || "") || path.resolve(systemRoot) !== systemRoot || systemRoot === path.parse(systemRoot).root) {
    throw new Error("Step progress preflight requires the candidate's exact absolute installation directory.");
  }
  const namespaces = [
    { name: "normal", root: systemRoot, content: () => createInstalledTrainingContent({ systemRoot }) },
    { name: "author-preview", root: path.join(systemRoot, "author-preview"),
      content: () => createInstalledTrainingContent({ systemRoot, allowDraftLessons: true }) }
  ];
  for (const namespace of namespaces) {
    const usersRoot = path.join(namespace.root, "training", "users");
    await verifyUpgradeParents(systemRoot, path.join(usersRoot, ".inventory"));
    let entries;
    try { entries = await readdir(usersRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const learners = createTrainingLearnerState({ systemRoot: namespace.root, content: namespace.content() });
    let learnerCount = 0;
    let attemptCount = 0;
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) throw new Error(`Step progress ${namespace.name} learner inventory contains a non-directory. Inspect it before upgrading.`);
      const learnerId = Buffer.from(entry.name, "base64url").toString("utf8");
      if (!learnerId || Buffer.from(learnerId).toString("base64url") !== entry.name) {
        throw new Error(`Step progress ${namespace.name} learner key is not canonical. Inspect its original owner.`);
      }
      const actor = { uid: learnerId }; // Offline durable identity validation, not a signed-in user or authorization grant.
      const userRoot = path.join(usersRoot, entry.name);
      for (const file of ["progress.json", "step-progress.json", "reader.json", "code-ledger.json"]) {
        await verifyUpgradeParents(systemRoot, path.join(userRoot, file));
      }
      const state = await learners.readState({ actor });
      // Records a newer writer may already have created are validated, never repaired.
      if (await readUpgradeFile(path.join(userRoot, "step-progress.json")) !== null) await learners.readStepProgress({ actor });
      if (await readUpgradeFile(path.join(userRoot, "reader.json")) !== null) await learners.readReader({ actor });
      learnerCount++;
      attemptCount += state.progress.attempts.length;
    }
    report("info", `Verified ${learnerCount} ${namespace.name} learner record(s) with ${attemptCount} retained attempt(s); no file was changed.`);
  }
}
