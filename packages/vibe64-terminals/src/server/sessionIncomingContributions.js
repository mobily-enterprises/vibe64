// Incoming changes: the receiving GitHub project reviews, merges or discards
// connected contributions published to vibe64-incoming/* branches.
import crypto from "node:crypto";
import { PROJECT_REPOSITORY_MODE_GITHUB } from "@local/vibe64-core/server/projectRepository";
import { runVibe64Command, writeGitWorktreeTree } from "@local/vibe64-execution/server";
import {
  commandProject,
  conflictWorktreeTree,
  createVirtualCommit,
  deleteOperationRef,
  git,
  gitOutput,
  mergeTrees,
  regenerateDerivedArtifactTree,
  repositoryContext,
  runSessionWorkOperation,
  saveError,
  saveRef,
  scopedSessionWorkCommand,
  text,
  treeWithDerivedArtifactsFromCommit
} from "./sessionWorkGit.js";
import {
  captureSessionWorkUpdateCheckpointDirect
} from "./sessionWorkUpdate.js";

function incomingRepositoryContext(project, session) {
  // Incoming belongs to the receiving project, independently of the selected
  // session's Save branch. Its source supplies Git storage, never its destination.
  const context = repositoryContext({ sessionId: session.sessionId,
    sourcePath: session.sourcePath || session.metadata?.source_path,
    metadata: { base_commit: session.metadata?.base_commit } }, project);
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB || context.branch.startsWith("vibe64-incoming/")) {
    throw saveError("Incoming changes require the receiving GitHub repository's authority.", "vibe64_incoming_repository_required");
  }
  return context;
}

async function inspectIncomingContributionsDirect({ project = {}, session = {}, offset = 0, limit = 25,
  id = "", state = "all", includeDiff = false, commandOptions = {}, operationId = crypto.randomUUID(), runCommand = runVibe64Command } = {}) {
  const context = incomingRepositoryContext(project, session);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, { label: "Reading incoming contributions", operationId });
  const options = { commandOptions, project };
  const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if ((id && !idPattern.test(id)) || !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (includeDiff && !id) ||
      !["all", "pending", "merged", "discarded", "unresolved"].includes(state)) {
    throw saveError("Choose an exact incoming contribution or a valid page.", "vibe64_incoming_input_invalid");
  }
  if (await gitOutput(runCommand, context, ["rev-parse", "--is-shallow-repository"], options) !== "false") {
    throw saveError("Incoming changes require complete Git history. Prepare a full receiving checkout before retrying.", "vibe64_incoming_history_incomplete");
  }
  const targetRef = `refs/heads/${context.branch}`;
  const output = await gitOutput(runCommand, context,
    ["ls-remote", "--heads", context.remoteUrl, targetRef, "refs/heads/vibe64-incoming/*"], options);
  const entries = new Map();
  let targetHead = "";
  for (const line of output.split("\n").filter(Boolean)) {
    const [head, ref] = line.split(/\s+/u);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head)) {
      throw saveError("The receiving repository returned invalid ref evidence.", "vibe64_incoming_refs_invalid");
    }
    if (ref === targetRef) { targetHead = head; continue; }
    const match = /^refs\/heads\/vibe64-incoming\/(.+?)(_discarded)?$/u.exec(ref);
    if (!match || !idPattern.test(match[1])) continue;
    const entry = entries.get(match[1]) || { id: match[1], activeHead: "", discardedHead: "" };
    entry[match[2] ? "discardedHead" : "activeHead"] = head;
    entries.set(entry.id, entry);
  }
  if (!targetHead) throw saveError("The receiving integration branch is unavailable.", "vibe64_incoming_target_missing");
  const all = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidates = id ? all.filter(entry => entry.id === id) : all;
  if (id && !candidates.length) throw saveError("This incoming contribution is no longer present. Refresh the list and inspect its history.", "vibe64_incoming_missing");
  const refs = [{ remote: targetRef, head: targetHead }];
  for (const entry of candidates) {
    if (entry.activeHead) refs.push({ remote: `refs/heads/vibe64-incoming/${entry.id}`, head: entry.activeHead });
    if (entry.discardedHead) refs.push({ remote: `refs/heads/vibe64-incoming/${entry.id}_discarded`, head: entry.discardedHead });
  }
  refs.forEach((ref, index) => { ref.local = saveRef(context, operationId, `incoming-${index}`); });
  try {
    await git(runCommand, context, ["fetch", "--no-tags", "--no-write-fetch-head", context.remoteUrl,
      ...refs.map(ref => `+${ref.remote}:${ref.local}`)], options);
    for (const ref of refs) {
      if (await gitOutput(runCommand, context, ["rev-parse", "--verify", `${ref.local}^{commit}`], options) !== ref.head) {
        throw saveError("Incoming branches changed while being read. Refresh before reviewing them.", "vibe64_incoming_review_changed");
      }
    }
    for (const entry of candidates) {
      const head = entry.activeHead || entry.discardedHead;
      const count = await gitOutput(runCommand, context, ["rev-list", "--count", `${targetHead}..${head}`], options);
      if (!/^\d+$/u.test(count)) throw saveError("Contribution ancestry could not be established.", "vibe64_incoming_history_incomplete");
      entry.status = entry.activeHead && entry.discardedHead ? "unresolved"
        : count === "0" ? "merged" : entry.activeHead ? "pending" : "discarded";
    }
    const filtered = candidates.filter(entry => id || state === "all" || entry.status === state);
    const page = id ? filtered : filtered.slice(offset, offset + limit);
    const contributions = [];
    for (const entry of page) {
      const head = entry.activeHead || entry.discardedHead;
      const title = await gitOutput(runCommand, context, ["log", "-1", "--format=%s", head], options);
      const changed = await git(runCommand, context, ["diff", "--name-only", "-z", `${targetHead}...${head}`], options);
      const files = String(changed.stdout || changed.output || "").split("\0").filter(Boolean);
      let diff;
      if (includeDiff) {
        const result = await git(runCommand, context, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", `${targetHead}...${head}`], options);
        const content = String(result.stdout || result.output || "");
        diff = { content: content.slice(0, 100_000), truncated: content.length > 100_000 };
      }
      contributions.push({ ...entry, branch: `vibe64-incoming/${entry.id}`, head, title,
        review: { repository: context.repositoryFullName, targetBranch: context.branch, targetHead,
          id: entry.id, activeHead: entry.activeHead, discardedHead: entry.discardedHead },
        files: files.slice(0, 50), fileCount: files.length, filesTruncated: files.length > 50, ...(diff ? { diff } : {}) });
    }
    return { ok: true, repository: context.repositoryFullName, targetBranch: context.branch, targetHead,
      contributions, pendingCount: candidates.filter(entry => entry.status === "pending").length,
      unresolvedCount: candidates.filter(entry => entry.status === "unresolved").length,
      totalCount: filtered.length, offset: id ? 0 : offset,
      nextOffset: !id && offset + limit < filtered.length ? offset + limit : null };
  } finally {
    for (const ref of refs) await deleteOperationRef(runCommand, context, ref.local, options);
  }
}

async function inspectIncomingContributions({ project = {}, session = {}, offset = 0, limit = 25,
  id = "", state = "all", includeDiff = false, commandOptions = {}, runCommand = runVibe64Command } = {}) {
  const context = incomingRepositoryContext(project, session);
  return runSessionWorkOperation({ context, project, commandOptions, runCommand,
    input: { offset, limit, id, state, includeDiff }, label: "Reading incoming contributions", operation: "incoming" });
}

async function changeIncomingContributionDirect({ project = {}, session = {}, action = "", id = "", review = {}, repairReview = null,
  identity = {}, derivedArtifactPaths = [], refreshDerivedArtifacts, commandOptions = {},
  operationId = crypto.randomUUID(), runCommand = runVibe64Command } = {}) {
  if (!["merge", "discard", "review-repair"].includes(action) || !id) {
    throw saveError("Choose Merge or Discard for an exact contribution.", "vibe64_incoming_input_invalid");
  }
  const context = incomingRepositoryContext(project, session);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, { label: "Updating incoming contribution", operationId });
  const options = { commandOptions, project };
  const current = await inspectIncomingContributionsDirect({ project, session, id, commandOptions, operationId, runCommand });
  const entry = current.contributions[0];
  const expected = { repository: current.repository, targetBranch: current.targetBranch, targetHead: current.targetHead,
    id, activeHead: entry.activeHead, discardedHead: entry.discardedHead };
  if (Object.entries(expected).some(([key, value]) => review?.[key] !== value)) {
    throw saveError("This contribution or its target changed. Review the current heads before acting.", "vibe64_incoming_review_changed");
  }
  const activeRef = `refs/heads/${entry.branch}`;
  const discardedRef = `${activeRef}_discarded`;
  const targetRef = `refs/heads/${context.branch}`;
  if (action === "merge" || action === "review-repair") {
    if (entry.status === "merged") return { ok: true, status: "merged", head: entry.head, targetHead: current.targetHead };
    if (entry.status !== "pending") {
      throw saveError("Only a pending contribution can be merged. Resolve its discard state first.", "vibe64_incoming_not_pending");
    }
    let mergedCommit = entry.head;
    let repairedTree = "";
    const targetAhead = await gitOutput(runCommand, context, ["rev-list", "--count", `${entry.head}..${current.targetHead}`], options);
    if (!/^\d+$/u.test(targetAhead)) throw saveError("Integration ancestry is unavailable.", "vibe64_incoming_history_incomplete");
    if (targetAhead === "0" && (repairReview || action === "review-repair")) {
      throw saveError("These heads do not need conflict repair. Refresh and review the contribution normally.", "vibe64_incoming_review_changed");
    }
    if (targetAhead !== "0") {
      // Generated artifacts belong to their recreator, not conflict repair.
      // Normalize them to the reviewed target before merging authored source.
      const contributionTree = await gitOutput(runCommand, context, ["rev-parse", `${entry.head}^{tree}`], options);
      const sourceTree = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
        commandOptions, derivedArtifactPaths, project, sourceCommit: current.targetHead, tree: contributionTree
      });
      const mergeInput = sourceTree === contributionTree ? entry.head : await createVirtualCommit(runCommand, context, {
        baseCommit: entry.head, commandOptions, identity, message: "Vibe64 incoming authored source", project, tree: sourceTree
      });
      const merged = await mergeTrees(runCommand, context, { canonicalCommit: current.targetHead,
        virtualCommit: mergeInput, commandOptions, project });
      if (merged.conflictPaths.length) {
        // Preserve the receiving source before offering Temporary AI. This is
        // the same private checkpoint owner as Update; files/index/HEAD stay put.
        const checkpoint = await captureSessionWorkUpdateCheckpointDirect({
          project, session, commandOptions, operationId: `incoming:${operationId}`, runCommand
        });
        if (action === "merge" && !repairReview) {
          throw saveError("This contribution conflicts with the integration branch. Use Fix it with AI or repair the listed files in this receiving session, then Review resolved conflicts before merging.",
            "vibe64_incoming_merge_conflict", { conflictPaths: merged.conflictPaths,
              checkpointCommit: checkpoint.checkpointCommit, review: expected });
        }
        repairedTree = await conflictWorktreeTree(runCommand, context, { conflictTree: merged.conflictTree,
          conflictPaths: merged.conflictPaths, project });
        repairedTree = await regenerateDerivedArtifactTree(runCommand, context, {
          baseCommit: current.targetHead, commandOptions, derivedArtifactPaths, identity, project,
          refreshDerivedArtifacts, tree: repairedTree
        });
        const currentRepair = { tree: repairedTree, worktreeTree: checkpoint.checkpointTree,
          head: checkpoint.oldHead, indexTree: checkpoint.oldIndexTree };
        if (action === "review-repair") {
          const result = await git(runCommand, context, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3",
            current.targetHead, repairedTree], options);
          const content = String(result.stdout || result.output || "");
          return { ok: true, status: "repair-review", review: expected, repairReview: currentRepair,
            conflictPaths: merged.conflictPaths, diff: { content: content.slice(0, 100_000), truncated: content.length > 100_000 } };
        }
        if (Object.keys(currentRepair).some(key => repairReview?.[key] !== currentRepair[key])) {
          throw saveError("The receiving source changed after repair review. Review resolved conflicts again before merging.",
            "vibe64_incoming_repair_changed");
        }
      } else if (repairReview || action === "review-repair") {
        throw saveError("These heads no longer need conflict repair. Refresh and review the contribution normally.", "vibe64_incoming_review_changed");
      }
      const mergedTree = repairedTree || await regenerateDerivedArtifactTree(runCommand, context, {
        baseCommit: current.targetHead, commandOptions, derivedArtifactPaths, identity, project,
        refreshDerivedArtifacts, tree: merged.mergedTree
      });
      mergedCommit = await gitOutput(runCommand, context, ["-c", `user.name=${text(identity.name) || "Vibe64 Merge"}`,
        "-c", `user.email=${text(identity.email) || "vibe64@localhost"}`, "commit-tree", mergedTree,
        "-p", current.targetHead, "-p", entry.head], { ...options, input: `Merge contribution ${id}\n` });
    }
    // Recheck the contribution as well as using an exact target lease. Its ref
    // is retained after integration; no squash, rebase or branch deletion occurs.
    const refreshed = await inspectIncomingContributionsDirect({ project, session, id, commandOptions, operationId, runCommand });
    const refreshedEntry = refreshed.contributions[0];
    if (refreshed.targetHead !== current.targetHead || refreshedEntry.activeHead !== entry.activeHead || refreshedEntry.discardedHead) {
      throw saveError("The contribution changed while its merge was prepared. Review it again.", "vibe64_incoming_review_changed");
    }
    if (repairedTree) {
      const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], options);
      const indexTree = await gitOutput(runCommand, context, ["write-tree"], options);
      const worktreeTree = await writeGitWorktreeTree({ worktreePath: context.worktreePath,
        project: commandProject(context, project), runCommand });
      if (head !== repairReview.head || indexTree !== repairReview.indexTree || worktreeTree !== repairReview.worktreeTree) {
        throw saveError("The receiving source changed while the merge was prepared. Review resolved conflicts again.", "vibe64_incoming_repair_changed");
      }
    }
    await git(runCommand, context, ["push", `--force-with-lease=${targetRef}:${current.targetHead}`,
      context.remoteUrl, `${mergedCommit}:${targetRef}`], options);
    const verified = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, targetRef], options);
    if (verified.split(/\s+/u)[0] !== mergedCommit) {
      throw saveError("The merge result is uncertain. Refresh Incoming changes before retrying.", "vibe64_incoming_verification_failed");
    }
    return { ok: true, status: "merged", head: entry.head, targetHead: mergedCommit };
  }
  if (!entry.activeHead || (entry.discardedHead && entry.discardedHead !== entry.activeHead)) {
    throw saveError("This discard cannot replace a different or missing contribution head. Inspect the current branches.", "vibe64_incoming_review_changed");
  }
  const createDiscarded = `${entry.head}:${discardedRef}`;
  const deleteActive = `:${activeRef}`;
  const activeLease = `--force-with-lease=${activeRef}:${entry.activeHead}`;
  const discardedLease = `--force-with-lease=${discardedRef}:${entry.discardedHead}`;
  const atomic = await git(runCommand, context, ["push", "--atomic", activeLease, discardedLease,
    context.remoteUrl, createDiscarded, deleteActive], { ...options, required: false });
  if (!atomic.ok) {
    const reason = text(atomic.stderr || atomic.output || atomic.error);
    if (!/does not support --atomic push/iu.test(reason)) {
      throw saveError(reason || "Discard was not confirmed. Refresh Incoming changes before retrying.", "vibe64_incoming_discard_unconfirmed");
    }
    // Without atomic support, preserve the destination before deleting the
    // exact reviewed source. Both refs remain recoverable after interruption.
    if (!entry.discardedHead) {
      await git(runCommand, context, ["push", discardedLease, context.remoteUrl, createDiscarded], options);
    }
    const copied = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, discardedRef], options);
    if (copied.split(/\s+/u)[0] !== entry.head) {
      throw saveError("The discarded branch was not verified; the active branch was retained.", "vibe64_incoming_verification_failed");
    }
    await git(runCommand, context, ["push", activeLease, context.remoteUrl, deleteActive], options);
  }
  const verified = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, activeRef, discardedRef], options);
  if (verified !== `${entry.head}\t${discardedRef}`) {
    throw saveError("Discard is not fully confirmed. Refresh Incoming changes to inspect both branches.", "vibe64_incoming_discard_unconfirmed");
  }
  return { ok: true, status: entry.status === "merged" ? "merged" : "discarded", head: entry.head };
}

async function changeIncomingContribution({ project = {}, session = {}, action = "", id = "", review = {}, repairReview = null, identity = {},
  derivedArtifactPaths = [], commandOptions = {}, runCommand = runVibe64Command, runProjectSourceExclusive = async operation => operation() } = {}) {
  const context = incomingRepositoryContext(project, session);
  return runProjectSourceExclusive(() => runSessionWorkOperation({ context, project, commandOptions, runCommand,
    input: { action, id, review, repairReview, identity, derivedArtifactPaths }, label: "Updating incoming contribution", operation: "incoming-change" }),
  { operation: `incoming-${action}:${id}` });
}

export {
  changeIncomingContribution,
  changeIncomingContributionDirect,
  inspectIncomingContributions,
  inspectIncomingContributionsDirect
};
