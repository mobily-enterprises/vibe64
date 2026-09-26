import { vibe64Error } from "@local/vibe64-core/server/core";
import { githubApi, requireGithubRepository } from "./githubApi.js";

const FIELDS = `id number title body url state isDraft updatedAt author { login }
  baseRefName baseRefOid baseRef { name target { oid } } headRefName headRefOid headRef { name target { oid } }
  headRepository { nameWithOwner viewerPermission isArchived }
  baseRepository { nameWithOwner viewerPermission isArchived mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed }
  viewerCanUpdate viewerCanUpdateBranch mergeable mergeStateStatus reviewDecision
  commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
  maintainerCanModify additions deletions changedFiles`;

export async function githubPullRequests(project, input = {}, options = {}) {
  const fullName = requireGithubRepository(project, "Pull requests");
  const operation = input.operation || "list";
  const number = Number(input.number);
  const state = input.state || "open";
  const search = String(input.search || "").trim();
  const cursor = input.cursor || null;
  if (!["list", "read", "ready", "update-branch", "merge"].includes(operation) || !["open", "closed", "merged", "all"].includes(state) ||
      search.length > 200 || (cursor !== null && (typeof cursor !== "string" || cursor.length > 500)) ||
      (operation !== "list" && (!Number.isSafeInteger(number) || number < 1))) {
    throw vibe64Error("Choose a valid pull request or filter.", "vibe64_pull_request_input_invalid");
  }
  const api = githubApi(input, options);
  if (operation === "list") {
    const phrase = search.replace(/["\\\r\n]/gu, " ").trim();
    let stateFilter = "";
    if (state === "closed") {
      stateFilter = "is:closed is:unmerged";
    } else if (state !== "all") {
      stateFilter = `is:${state}`;
    }
    const searchFilter = phrase ? `"${phrase}" in:title,body` : "";
    const result = await api("graphql", {
      query: `query($search:String!, $cursor:String) {
        search(query:$search, type:ISSUE, first:25, after:$cursor) {
          issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest {
            number title url state isDraft updatedAt author { login } headRefName baseRefName
          } }
        }
      }`,
      variables: {
        search: `repo:${fullName} is:pr ${stateFilter} ${searchFilter} sort:updated-desc`,
        cursor
      }
    });
    const list = result.data?.search;
    if (!Array.isArray(list?.nodes)) {
      throw vibe64Error("GitHub returned an unreadable pull request list.", "vibe64_github_pull_requests_failed");
    }
    return {
      ok: true,
      repository: fullName,
      pullRequests: list.nodes.filter((pr) => pr?.number),
      total: list.issueCount,
      pageInfo: list.pageInfo
    };
  }
  const [owner, name] = fullName.split("/");
  const result = await api("graphql", {
    query: `query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) { pullRequest(number:$number) { ${FIELDS} } }
    }`, variables: { owner, name, number }
  });
  const pullRequest = result.data?.repository?.pullRequest;
  if (!pullRequest) {
    throw vibe64Error("This pull request is unavailable or you no longer have access.", "vibe64_pull_request_not_found");
  }
  const canWriteHead = ["ADMIN", "MAINTAIN", "WRITE"].includes(pullRequest.headRepository?.viewerPermission);
  let unavailableReason = "";
  if (pullRequest.state !== "OPEN") {
    unavailableReason = "Only open pull requests can become sessions.";
  } else if (!pullRequest.headRepository || !pullRequest.headRef?.target?.oid) {
    unavailableReason = "The source branch is no longer available.";
  } else if (pullRequest.headRepository.isArchived) {
    unavailableReason = "The source repository is archived.";
  } else if (!canWriteHead) {
    unavailableReason = "Your GitHub account needs write access to the source repository to save this session.";
  }
  // PR summary OIDs and update suggestions can lag behind actual branch refs.
  const headCommit = pullRequest.headRef?.target?.oid;
  const baseCommit = pullRequest.baseRef?.target?.oid;
  let behindBase = null;
  if (pullRequest.state === "OPEN" && headCommit && baseCommit) {
    const comparison = await api(`repos/${fullName}/compare/${baseCommit}...${headCommit}?per_page=1`, undefined, "GET");
    if (!Number.isSafeInteger(comparison.behind_by) || comparison.behind_by < 0) {
      throw vibe64Error("GitHub could not compare the pull request branches. Refresh and try again.",
        "vibe64_github_pull_requests_failed");
    }
    behindBase = comparison.behind_by;
  }
  const mergeMethods = [
    ["merge", pullRequest.baseRepository?.mergeCommitAllowed],
    ["squash", pullRequest.baseRepository?.squashMergeAllowed],
    ["rebase", pullRequest.baseRepository?.rebaseMergeAllowed]
  ].filter(([, allowed]) => allowed).map(([method]) => method);
  let unavailableActionReason = "";
  if (pullRequest.state !== "OPEN") {
    unavailableActionReason = "This pull request is no longer open.";
  } else if (pullRequest.baseRepository?.isArchived) {
    unavailableActionReason = "The target repository is archived.";
  } else if (!baseCommit || !headCommit) {
    unavailableActionReason = "A pull request branch is no longer available.";
  }
  const conflictReason = pullRequest.mergeable === "CONFLICTING" || pullRequest.mergeStateStatus === "DIRTY"
    ? "Resolve the merge conflicts on GitHub before continuing." : "";
  const actions = {
    ready: unavailableActionReason,
    "update-branch": unavailableActionReason,
    merge: unavailableActionReason
  };
  if (!unavailableActionReason) {
    if (!pullRequest.isDraft) {
      actions.ready = "This pull request is already ready for review.";
    } else if (!pullRequest.viewerCanUpdate) {
      actions.ready = "Your GitHub account cannot mark this pull request ready for review.";
    }

    if (conflictReason) {
      actions["update-branch"] = conflictReason;
    } else if (pullRequest.headRepository?.isArchived) {
      actions["update-branch"] = "The source repository is archived.";
    } else if (!pullRequest.viewerCanUpdateBranch && !canWriteHead) {
      actions["update-branch"] = "Your GitHub account needs permission to update the source branch.";
    } else if (behindBase === 0) {
      actions["update-branch"] = "This branch already includes the target branch's changes.";
    }

    if (!["ADMIN", "MAINTAIN", "WRITE"].includes(pullRequest.baseRepository?.viewerPermission)) {
      actions.merge = "Your GitHub account needs write access to the target repository to merge.";
    } else if (pullRequest.isDraft) {
      actions.merge = "Mark this draft ready for review before merging.";
    } else if (conflictReason) {
      actions.merge = conflictReason;
    } else if (pullRequest.reviewDecision === "CHANGES_REQUESTED") {
      actions.merge = "A reviewer has requested changes.";
    } else if (pullRequest.reviewDecision === "REVIEW_REQUIRED") {
      actions.merge = "Required reviews are still outstanding.";
    } else if (pullRequest.headRefOid !== headCommit) {
      actions.merge = "GitHub is still updating this pull request's status. Refresh to check again.";
    } else if (pullRequest.mergeStateStatus === "BEHIND") {
      actions.merge = `Update this branch from ${pullRequest.baseRefName} before merging.`;
    } else if (pullRequest.mergeStateStatus === "BLOCKED") {
      actions.merge = "GitHub is blocking the merge. Check required checks, reviews and repository rules on GitHub.";
    } else if (!["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(pullRequest.mergeStateStatus) || pullRequest.mergeable !== "MERGEABLE") {
      actions.merge = "GitHub is still checking whether this pull request can merge. Refresh to check again.";
    } else if (!mergeMethods.length) {
      actions.merge = "No merge method is available for this repository.";
    }
  }
  const review = {
    repository: fullName, number,
    headRepository: pullRequest.headRepository?.nameWithOwner || "",
    headBranch: pullRequest.headRefName, headCommit: headCommit || "",
    baseBranch: pullRequest.baseRefName, baseCommit: baseCommit || ""
  };
  if (operation === "read") {
    return { ok: true, repository: fullName, pullRequest: {
      ...pullRequest, unavailableReason, actions, mergeMethods, review, behindBase,
      headRefOid: headCommit || pullRequest.headRefOid,
      checksState: pullRequest.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null
    } };
  }
  if (actions[operation]) {
    throw vibe64Error(actions[operation], "vibe64_pull_request_action_unavailable");
  }
  if (!input.review || Object.entries(review).some(([key, value]) => input.review[key] !== value)) {
    throw vibe64Error("This pull request changed since you reviewed it. Refresh and review its destination and changes again.",
      "vibe64_pull_request_review_changed");
  }
  // Read immediately before writing, then let GitHub enforce the reviewed head and repository rules.
  const write = githubApi(input, { ...options,
    uncertainWriteMessage: "The result could not be confirmed. Refresh this pull request or view it on GitHub before trying again."
  });
  if (operation === "ready") {
    const result = await write("graphql", {
      query: `mutation($id:ID!) {
        markPullRequestReadyForReview(input:{pullRequestId:$id}) { pullRequest { id isDraft } }
      }`, variables: { id: pullRequest.id }
    });
    const ready = result.data?.markPullRequestReadyForReview?.pullRequest;
    if (ready?.id !== pullRequest.id || ready.isDraft !== false) {
      throw vibe64Error("Ready for review could not be confirmed. Refresh the pull request before trying again.",
        "vibe64_pull_request_result_unconfirmed");
    }
    return { ok: true, message: "Pull request marked ready for review." };
  }
  if (operation === "update-branch") {
    const accepted = await write(`repos/${fullName}/pulls/${number}/update-branch`, { expected_head_sha: review.headCommit }, "PUT");
    if (typeof accepted.message !== "string" || !accepted.message.trim()) {
      throw vibe64Error("GitHub did not confirm the branch update request. Refresh the pull request before trying again.",
        "vibe64_pull_request_result_unconfirmed");
    }
    // GitHub accepts this asynchronously; do not report the branch as already updated.
    return { ok: true, pending: true,
      message: "GitHub accepted the branch update. Refresh to check its progress, then update your session to load the changes." };
  }
  if (!mergeMethods.includes(input.mergeMethod)) {
    throw vibe64Error("Choose a merge method allowed by this repository.", "vibe64_pull_request_input_invalid");
  }
  const merged = await write(`repos/${fullName}/pulls/${number}/merge`, {
    sha: review.headCommit, merge_method: input.mergeMethod
  }, "PUT");
  if (merged.merged !== true) {
    throw vibe64Error("GitHub did not confirm the merge. Refresh the pull request or view it on GitHub.",
      "vibe64_pull_request_result_unconfirmed");
  }
  return { ok: true, message: `Merged into ${review.baseBranch}. Archive your session when you have finished with it.` };
}

// Only the server-resolved PR supplies the session's repository authority.
export function pullRequestSessionSource(pullRequest) {
  if (pullRequest.unavailableReason) {
    throw vibe64Error(pullRequest.unavailableReason, "vibe64_pull_request_unavailable");
  }
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body,
    url: pullRequest.url,
    baseRepository: pullRequest.baseRepository.nameWithOwner,
    baseBranch: pullRequest.baseRefName,
    headRepository: pullRequest.headRepository.nameWithOwner,
    headBranch: pullRequest.headRefName,
    headCommit: pullRequest.headRefOid
  };
}

export async function preparePullRequestSource(project, session, input, options = {}) {
  const fullName = project.githubRepository?.fullName || project.repository?.github?.fullName || "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(fullName) || project.repositoryMode === "managed_git") {
    throw vibe64Error("Pull requests require a GitHub project.", "vibe64_github_project_required");
  }
  const repository = await githubApi(input, options)(`repos/${fullName}`, undefined, "GET");
  if (!repository.permissions?.push || repository.archived) {
    throw vibe64Error("Your GitHub account needs write access to this repository.", "vibe64_pull_request_permission_denied");
  }
  const headCommit = session.metadata?.base_commit || "";
  if (!/^[a-f0-9]{40,64}$/u.test(headCommit) || !/^[A-Za-z0-9_-]+$/u.test(session.sessionId || "")) {
    throw vibe64Error("This session needs a valid Git baseline before creating a pull request.", "vibe64_pull_request_source_missing");
  }
  return {
    number: null, title: input.title, body: input.body || "", url: "",
    baseRepository: fullName,
    baseBranch: project.repository?.defaultBranch,
    headRepository: fullName,
    headBranch: (project.repositoryMode || project.repository?.mode) === "github" &&
      session.metadata?.repository_branch && session.metadata.repository_branch !== project.repository?.defaultBranch
      ? session.metadata.repository_branch : `vibe64/pr-${session.sessionId}`,
    headCommit
  };
}

export async function publishSessionPullRequest(source, input, options = {}) {
  const api = githubApi(input, options);
  const head = `${source.headRepository.split("/")[0]}:${source.headBranch}`;
  const query = new URLSearchParams({ state: "open", head, base: source.baseBranch, per_page: "1" });
  const existing = await api(`repos/${source.baseRepository}/pulls?${query}`, undefined, "GET");
  if (!Array.isArray(existing)) {
    throw vibe64Error("Existing pull requests could not be checked. Try again before creating another.", "vibe64_github_pull_requests_failed");
  }
  const pr = existing[0] || await api(`repos/${source.baseRepository}/pulls`, {
    title: input.title, body: input.body || "", draft: input.draft !== false,
    base: source.baseBranch, head
  });
  return { ...source, number: pr.number, url: pr.html_url, title: pr.title, body: pr.body || "" };
}
