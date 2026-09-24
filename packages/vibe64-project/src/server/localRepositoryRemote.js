import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { access } from "node:fs/promises";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { runProjectSourceExclusive } from "./projectSourceMutationLock.js";

// Freshness is only a transport observation. Git owns the configuration and refs.
const observations = new Map();

function failure(message, code = "vibe64_remote_failed") {
  return Object.assign(new Error(message), { code });
}

function safeText(value = "") {
  return String(value).replace(/(https?:\/\/)[^\s/@]+@/gu, "$1[credentials]@").slice(0, 3000);
}

function configurationId(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function localRepositoryRemote(project, input = {}, {
  runCommand = runVibe64Command,
  logger = null,
  runExclusive = runProjectSourceExclusive
} = {}) {
  const action = input.action || "status";
  if ((project?.repositoryMode || project?.repository?.mode) !== "local_source" ||
      !path.isAbsolute(project?.sourceRoot || "")) {
    if (action === "status") return { ok: true, supported: false };
    throw failure("Remote controls are available only for an opened local folder.", "vibe64_remote_local_only");
  }
  if (!["status", "fetch", "pull", "push", "configure", "switch", "create"].includes(action)) {
    throw failure("Unknown remote operation.");
  }
  const root = project.sourceRoot;
  const operationId = randomUUID();
  async function git(args, { optional = false } = {}) {
    const result = await runCommand({
      actor: "daemon", allowedRoots: [root], command: "git", args, cwd: root,
      envPolicy: "project", gitSafeDirectories: [root], inheritProcessEnv: true,
      mode: "capture", purpose: "source", runtimes: ["git"],
      timeout: 60_000, maxBuffer: 2 * 1024 * 1024
    });
    if (result?.ok !== true) {
      if (optional) return null;
      throw failure(safeText(result?.stderr || result?.error || "Git could not complete the remote operation."));
    }
    return String(result.stdout ?? result.output ?? "").trim();
  }
  async function readConfig(key) {
    return await git(["config", "--get", key], { optional: true }) || "";
  }
  async function readRepository() {
    const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], { optional: true }) || "";
    const head = await git(["rev-parse", "--verify", "HEAD^{commit}"], { optional: true }) || "";
    const names = (await git(["remote"])).split("\n").filter(Boolean);
    const remotes = [];
    for (const name of names) {
      const url = await git(["remote", "get-url", name]);
      const pushUrls = (await git(["remote", "get-url", "--push", "--all", name])).split("\n");
      remotes.push({ name, url, pushUrls });
    }
    const upstreamRemote = branch ? await readConfig(`branch.${branch}.remote`) : "";
    const upstreamRef = branch ? await git(["config", "--get-all", `branch.${branch}.merge`], { optional: true }) || "" : "";
    const pullRemote = remotes.find((remote) => remote.name === upstreamRemote);
    const upstream = pullRemote && !upstreamRef.includes("\n") && upstreamRef.startsWith("refs/heads/")
      ? { remote: pullRemote.name, branch: upstreamRef.slice(11), url: pullRemote.url }
      : null;
    // Git resolves the remote and explicit refspec. Its remoteref atom is empty
    // for push.default, so apply that setting's single-branch rule below.
    const pushFields = branch ? await git([
      "for-each-ref", "--format=%(push:remotename)%00%(push:remoteref)", `refs/heads/${branch}`
    ], { optional: true }) : "";
    const [pushName, configuredPushRef] = (pushFields || "").split("\0");
    let pushRef = configuredPushRef;
    if (pushName && !pushRef && !await readConfig(`remote.${pushName}.push`)) {
      const mode = await readConfig("push.default") || "simple";
      if (mode === "current" ||
          (mode === "simple" && (pushName !== upstreamRemote || upstreamRef === `refs/heads/${branch}`))) {
        pushRef = `refs/heads/${branch}`;
      } else if (mode === "upstream" && pushName === upstreamRemote) {
        pushRef = upstreamRef;
      }
    }
    const pushRemote = remotes.find((remote) => remote.name === pushName);
    const push = pushRemote?.pushUrls.length === 1 && pushRef?.startsWith("refs/heads/")
      ? { remote: pushName, branch: pushRef.slice(11), url: pushRemote.pushUrls[0] }
      : null;
    const configId = configurationId({ branch, remotes, upstream, push });
    return { branch, head, remotes, upstream, push, configId };
  }
  async function observe(target, { allowMissing = false } = {}) {
    const remoteRef = `refs/heads/${target.branch}`;
    const observationRef = `refs/vibe64/remotes/${configurationId(target)}`;
    const listed = await git(["ls-remote", "--heads", "--", target.url, remoteRef]);
    const commit = listed.split("\n").map((line) => line.split(/\s+/u))
      .find(([, ref]) => ref === remoteRef)?.[0] || "";
    if (!commit && !allowMissing) {
      throw failure(`The upstream branch ${target.remote}/${target.branch} no longer exists. Choose an upstream in Remote settings.`, "vibe64_remote_branch_missing");
    }
    if (commit) {
      await git(["fetch", "--no-tags", "--no-write-fetch-head", "--refmap=", "--", target.url,
        `+${remoteRef}:${observationRef}`]);
      return await git(["rev-parse", "--verify", observationRef]);
    }
    await git(["update-ref", "-d", observationRef]);
    return "";
  }
  async function fetchState(state) {
    const checked = { configId: state.configId, attemptedAt: new Date().toISOString(), checkedAt: "", upstreamCommit: "", pushCommit: "", error: "" };
    try {
      if (state.upstream) checked.upstreamCommit = await observe(state.upstream);
      if (state.push) checked.pushCommit = JSON.stringify(state.push) === JSON.stringify(state.upstream)
        ? checked.upstreamCommit : await observe(state.push, { allowMissing: true });
      checked.checkedAt = new Date().toISOString();
    } catch (error) {
      checked.error = error.message;
      const previous = observations.get(root);
      if (previous?.configId === state.configId) checked.checkedAt = previous.checkedAt;
    }
    observations.set(root, checked);
    return checked;
  }
  async function publicState(state) {
    const observation = observations.get(root);
    const checked = observation?.configId === state.configId ? observation : null;
    const known = Boolean(checked?.checkedAt) && !checked.error;
    async function count(from, to) {
      return Number(await git(["rev-list", "--count", from ? `${from}..${to}` : to]));
    }
    const upstreamCommit = known ? checked.upstreamCommit : "";
    const pushCommit = known ? checked.pushCommit : "";
    const incoming = known && state.head && upstreamCommit ? await count(state.head, upstreamCommit) : null;
    const localAhead = known && state.head && upstreamCommit ? await count(upstreamCommit, state.head) : null;
    const outgoing = known && state.head && state.push ? await count(pushCommit, state.head) : null;
    const dirty = Boolean(await git(["status", "--porcelain", "--untracked-files=all"]));
    const branches = (await git(["for-each-ref", "--format=%(refname:short)", "refs/remotes"])).split("\n").filter(Boolean);
    const localBranches = (await git(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"])).split("\n").filter(Boolean);
    const target = (value) => value ? { remote: value.remote, branch: value.branch, url: safeText(value.url) } : null;
    return {
      ok: true, supported: true, branch: state.branch, head: state.head, dirty,
      remotes: state.remotes.map((remote) => ({ name: remote.name, url: safeText(remote.url) })),
      branches, localBranches, upstream: target(state.upstream), push: target(state.push),
      incoming, localAhead, outgoing, checkedAt: checked?.checkedAt || "", error: checked?.error || "",
      review: { branch: state.branch, head: state.head, configId: state.configId, upstreamCommit, pushCommit }
    };
  }
  async function assertClean(state) {
    if (!state.branch || !state.head) throw failure("Check out a branch with at least one commit first.", "vibe64_remote_branch_required");
    if (await git(["status", "--porcelain", "--untracked-files=all"])) {
      throw failure("The opened project folder has uncommitted changes. Commit or stash them before changing its files.", "vibe64_remote_dirty");
    }
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"]) {
      if (await git(["rev-parse", "--verify", "-q", marker], { optional: true })) {
        throw failure("Finish or abort the Git operation in the project folder first.", "vibe64_remote_git_in_progress");
      }
    }
    for (const directory of ["rebase-merge", "rebase-apply", "sequencer"]) {
      const gitPath = await git(["rev-parse", "--git-path", directory]);
      if (await access(path.resolve(root, gitPath)).then(() => true, () => false)) {
        throw failure("Finish or abort the Git operation in the project folder first.", "vibe64_remote_git_in_progress");
      }
    }
  }
  function assertReview(state) {
    if (input.review?.configId !== state.configId || input.review?.head !== state.head ||
        input.review?.branch !== state.branch) {
      throw failure("The project branch, commits or remote settings changed. Refresh and review the operation again.", "vibe64_remote_review_changed");
    }
  }
  async function configureRemotes(state) {
    const settings = input.settings || {};
    if (!state.branch) throw failure("Check out a local branch before configuring its remotes.");
    for (const [remote, branch] of [[settings.remote, settings.branch], [settings.pushRemote, settings.pushBranch]]) {
      if (!state.remotes.some((item) => item.name === remote)) throw failure("Select an existing Git remote.");
      if (!branch || await git(["check-ref-format", `refs/heads/${branch}`], { optional: true }) === null) {
        throw failure("Enter a valid Git branch name.");
      }
    }
    // Preserve other branches' push mappings; replace only this branch's exact mapping.
    const key = `remote.${settings.pushRemote}.push`;
    const refspecs = (await git(["config", "--get-all", key], { optional: true }) || "").split("\n").filter(Boolean);
    if (refspecs.some((spec) => spec.includes("*") || spec === ":" || spec === "+:")) {
      throw failure("This remote has wildcard push mappings. Configure this branch's push destination with Git first.");
    }
    const ownRefs = new Set([state.branch, `refs/heads/${state.branch}`, "HEAD"]);
    const kept = refspecs.filter((spec) => !ownRefs.has(spec.replace(/^\+/u, "").split(":")[0]));
    await git(["config", "--local", `branch.${state.branch}.remote`, settings.remote]);
    await git(["config", "--local", `branch.${state.branch}.merge`, `refs/heads/${settings.branch}`]);
    await git(["config", "--local", `branch.${state.branch}.pushRemote`, settings.pushRemote]);
    await git(["config", "--local", "--unset-all", key], { optional: true });
    for (const spec of [...kept, `refs/heads/${state.branch}:refs/heads/${settings.pushBranch}`]) {
      await git(["config", "--local", "--add", key, spec]);
    }
    observations.delete(root);
  }
  return runExclusive(project.projectRuntimeRoot, async () => {
    const state = await readRepository();
    if (action === "status") return publicState(state);
    logger?.info?.({ event: "vibe64.remote.started", operationId, action, project: project.slug, branch: state.branch }, "Git remote operation started.");
    try {
      if (action === "fetch") {
        const prior = observations.get(root);
        if (input.background !== true || prior?.configId !== state.configId ||
            Date.now() - Date.parse(prior?.attemptedAt || "") >= 60_000) {
          await fetchState(state);
        }
      } else {
        assertReview(state);
        if (action === "configure") await configureRemotes(state);
        else if (action === "switch" || action === "create") {
          await assertClean(state);
          const branch = input.branch;
          if (typeof branch !== "string" || !branch || branch.startsWith("-") ||
              await git(["check-ref-format", `refs/heads/${branch}`], { optional: true }) === null) {
            throw failure("Enter a valid Git branch name.", "vibe64_remote_branch_invalid");
          }
          if (action === "switch" && !await git(["show-ref", "--verify", `refs/heads/${branch}`], { optional: true })) {
            throw failure("Select an existing local branch.", "vibe64_remote_branch_missing");
          }
          await git(action === "create"
            ? ["switch", "--no-track", "-c", branch, state.head]
            : ["switch", "--no-guess", branch]);
          observations.delete(root);
        } else {
          if (!state.head || !state.branch) throw failure("Check out a branch with a commit first.");
          const target = action === "pull" ? state.upstream : state.push;
          if (!target) throw failure("Choose the remote destination in Remote settings first.", "vibe64_remote_unconfigured");
          if (action === "pull") await assertClean(state);
          const commit = await observe(target, { allowMissing: action === "push" });
          const reviewedCommit = input.review[action === "pull" ? "upstreamCommit" : "pushCommit"];
          if (commit !== reviewedCommit) throw failure("The remote changed. Fetch and review its new commits first.", "vibe64_remote_review_changed");
          assertReview(await readRepository());
          if (action === "pull") {
            await assertClean(state);
            if (await git(["merge-base", "--is-ancestor", commit, state.head], { optional: true }) === null) {
              const fastForward = await git(["merge-base", "--is-ancestor", state.head, commit], { optional: true }) !== null;
              if (!fastForward && input.merge !== true) throw failure("Local and remote commits have diverged. Review and choose Merge remote changes.", "vibe64_remote_merge_required");
              if (!fastForward) {
                const preview = await git(["merge-tree", "--write-tree", state.head, commit], { optional: true });
                if (preview === null) throw failure("The remote changes conflict with the local project. Resolve the merge in the project folder, then refresh Vibe64. No working files were changed.", "vibe64_remote_merge_conflict");
              }
              await git(["merge", fastForward ? "--ff-only" : "--no-ff", "--no-edit", commit]);
            }
          } else {
            if (commit && await git(["merge-base", "--is-ancestor", commit, state.head], { optional: true }) === null) {
              throw failure("The push destination has changes missing locally. Integrate them before pushing.", "vibe64_remote_push_rejected");
            }
            await git(["push", "--porcelain", "--no-follow-tags", "--", target.url, `${state.head}:refs/heads/${target.branch}`]);
            const verified = await observe(target);
            if (verified !== state.head) throw failure("The remote changed after Push. Fetch to inspect the result before another push.", "vibe64_remote_push_unconfirmed");
          }
          await fetchState(await readRepository());
        }
      }
      const result = await publicState(await readRepository());
      if (result.error) {
        logger?.warn?.({ event: "vibe64.remote.failed", operationId, action, code: "vibe64_remote_fetch_failed" }, "Git remote refresh failed.");
      } else {
        logger?.info?.({ event: "vibe64.remote.completed", operationId, action, branch: result.branch, head: result.head }, "Git remote operation completed.");
      }
      return { ...result, operationId, remoteChanged: ["pull", "push", "configure", "switch", "create"].includes(action) };
    } catch (error) {
      logger?.warn?.({ event: "vibe64.remote.failed", operationId, action, code: error.code }, "Git remote operation failed.");
      throw error;
    }
  }, { operation: `remote:${action}` });
}

export { localRepositoryRemote };
