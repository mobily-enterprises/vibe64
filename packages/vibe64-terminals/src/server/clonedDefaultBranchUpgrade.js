import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore,
  isValidVibe64SessionId,
  readActiveSessionMetadataValues
} from "@local/vibe64-runtime/server/sessionStore";
import { clonedDefaultBranchProof, deleteClonedDefaultBranch, runGit } from "./sessionSource.js";

const OUTCOME_METADATA = "source_default_branch_local";
// Renewal and archive states own their checkout until they finish.
const UPGRADABLE_STATUSES = new Set([VIBE64_SESSION_STATUS.ACTIVE, VIBE64_SESSION_STATUS.BLOCKED]);

function missingAsNull(error) {
  if (error.code === "ENOENT") return null;
  throw error;
}

// The branch's branch.<name>.* entries from `git config --list -z`: each entry
// is the key, a newline and its value (a valueless key has neither). A
// variable name has no dot, so another branch whose name starts with this one
// is not mistaken for it.
function branchConfig(listing = "", branch = "") {
  const prefix = `branch.${branch}.`;
  return listing.split("\0").filter(Boolean).map((entry) => {
    const newline = entry.indexOf("\n");
    return newline < 0 ? { key: entry, value: null } : { key: entry.slice(0, newline), value: entry.slice(newline + 1) };
  }).filter(({ key }) => key.startsWith(prefix) && !key.slice(prefix.length).includes("."));
}

// One private file per removed ref. An existing file is an earlier attempt at
// the same removal: it must match exactly and is never replaced.
async function backUpClonedBranch(backupPath, label, record) {
  if (await readFile(backupPath, "utf8").catch(missingAsNull) === null) {
    await writeJsonFileAtomic(backupPath, record, { directoryMode: 0o700, fileMode: 0o600 });
  }
  let saved = null;
  try { saved = JSON.parse(await readFile(backupPath, "utf8")); } catch { /* Refused below. */ }
  if (!isDeepStrictEqual(saved, record)) {
    throw new Error(`The backup for ${label} differs from its local copy of ${record.branch}; inspect ${backupPath} before upgrading.`);
  }
}

// What the proof needs from a session clone's record, or why it is skipped.
async function sessionCheckout(store, sessionId) {
  const status = await store.readStatusForRenewal(sessionId);
  if (!UPGRADABLE_STATUSES.has(status)) return { skip: `its status is ${status}` };
  const metadata = await store.readMetadata(sessionId);
  if (metadata[OUTCOME_METADATA]) return { skip: `already recorded (${metadata[OUTCOME_METADATA]})` };
  // Creating a pull request records its head branch in place of the cloned
  // one, so the record no longer names the copy this upgrade removes.
  if (metadata.github_pull_request) return { skip: "it has a pull request, whose branch replaced the cloned one in its record" };
  const sourcePath = sessionSourcePath({ metadata, sessionId, sessionRoot: store.paths(sessionId).sessionRoot });
  if (!sourcePath) return { skip: "no session checkout is recorded" };
  const missing = ["source_default_branch", "base_commit", "branch"].filter((name) => !metadata[name]);
  if (missing.length) return { skip: `its record has no ${missing.join(", ")}` };
  const checkout = await lstat(sourcePath).catch(missingAsNull);
  if (!checkout?.isDirectory()) {
    return { skip: checkout ? "its checkout is not a directory" : "its checkout is missing", warning: true };
  }
  return {
    baselineCommit: metadata.base_commit,
    clonedBranch: metadata.source_default_branch,
    sessionBranch: metadata.branch,
    sourcePath
  };
}

// Applies the creation proof to one checkout and records its outcome as
// creation does. Git failures stay with this session; a backup that cannot be
// written or verified stops the upgrade before anything is removed.
async function upgradeSessionCheckout({ apply, backupPath, checkout, label, project, report, runCommand, sessionId, store }) {
  const { clonedBranch, sourcePath } = checkout;
  const git = (args) => runGit(sourcePath, args, [sourcePath], { runCommand });
  const record = async (outcome) => {
    if (!apply) return outcome;
    try {
      await store.writeMetadataValue(sessionId, OUTCOME_METADATA, outcome);
    } catch (error) {
      report("warning", `${label}: its outcome (${outcome}) could not be recorded: ${error.message}`);
    }
    return outcome;
  };
  const gitFailed = (step, error) => {
    report("warning", `${label}: Git could not ${step} its local copy of ${clonedBranch}, which stays: ${error.message}`);
    return record("git_failed");
  };
  let proof;
  try {
    proof = await clonedDefaultBranchProof(git, checkout);
  } catch (error) {
    return gitFailed("check", error);
  }
  if (!proof.objectId) {
    if (proof.outcome === "absent" && await readFile(backupPath).catch(missingAsNull) !== null) {
      report("info", `${label}: an earlier attempt removed its local copy of ${clonedBranch}.`);
      return record("removed");
    }
    report("info", proof.outcome === "absent"
      ? `${label}: has no local copy of ${clonedBranch}.`
      : `${label}: keeps its local copy of ${clonedBranch} (${proof.outcome}).`);
    return record(proof.outcome);
  }
  if (!apply) {
    report("info", `${label}: would remove its local copy of ${clonedBranch}.`);
    return "would remove";
  }
  let config;
  try {
    config = branchConfig(await git(["config", "--local", "--list", "-z"]), clonedBranch);
  } catch (error) {
    return gitFailed("read the configuration of", error);
  }
  await backUpClonedBranch(backupPath, label, {
    schemaVersion: 1, project, sessionId, sourcePath, branch: clonedBranch, objectId: proof.objectId, config
  });
  try {
    await deleteClonedDefaultBranch(git, clonedBranch);
  } catch (error) {
    return gitFailed("remove", error);
  }
  report("info", `${label}: removed its local copy of ${clonedBranch}.`);
  return record("removed");
}

// 20261030: session checkouts created before source creation removed it keep
// a local copy of the branch they cloned (usually main) that nothing advances.
// Each active session clone gets the creation proof and records its outcome in
// source_default_branch_local. The checkout is wherever source_path says;
// archived sessions have none.
async function removeSessionClonedDefaultBranches({
  apply,
  backupRoot,
  report,
  runCommand = runVibe64Command,
  systemRoot
}) {
  const outcomes = new Map();
  let skipped = 0;
  for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
    const project = path.basename(projectRuntimeRoot);
    const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
    for (const { sessionId, value } of await readActiveSessionMetadataValues({ projectRuntimeRoot, name: "source_kind" })) {
      // Creation staging lives beside the sessions.
      if (!isValidVibe64SessionId(sessionId)) continue;
      const label = `${project}/${sessionId}`;
      const skip = (reason, level = "info") => {
        skipped += 1;
        report(level, `${label}: skipped, ${reason}.`);
      };
      if (String(value || "").trim() !== "session_clone") {
        skip("not a session clone");
        continue;
      }
      let checkout;
      try {
        checkout = await sessionCheckout(store, sessionId);
      } catch (error) {
        skip(`its record could not be read: ${error.message}`, "warning");
        continue;
      }
      if (checkout.skip) {
        skip(checkout.skip, checkout.warning ? "warning" : "info");
        continue;
      }
      const outcome = await upgradeSessionCheckout({
        apply, backupPath: path.join(backupRoot, project, `${sessionId}.json`), checkout, label, project, report,
        runCommand, sessionId, store
      });
      outcomes.set(outcome, (outcomes.get(outcome) || 0) + 1);
    }
  }
  if (!outcomes.size && !skipped) {
    report("info", "No session checkouts to inspect.");
    return;
  }
  const counted = [...outcomes].map(([outcome, count]) => `${count} ${outcome}`).join(", ") || "none inspected";
  report("info", `Local copies of cloned branches: ${counted}; ${skipped} session(s) skipped.`);
}

export { removeSessionClonedDefaultBranches };
