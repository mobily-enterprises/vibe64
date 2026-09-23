import { vibe64Error } from "@local/vibe64-core/server/core";
import { githubApi, requireGithubRepository } from "./githubApi.js";

const FIELDS = `number title body url state isDraft updatedAt author { login }
  baseRefName headRefName headRefOid headRef { name }
  headRepository { nameWithOwner viewerPermission isArchived }
  baseRepository { nameWithOwner viewerPermission }
  maintainerCanModify additions deletions changedFiles`;

export async function githubPullRequests(project, input = {}, options = {}) {
  const fullName = requireGithubRepository(project, "Pull requests");
  const operation = input.operation || "list";
  const number = Number(input.number);
  const state = input.state || "open";
  const search = String(input.search || "").trim();
  const cursor = input.cursor || null;
  if (!["list", "read"].includes(operation) || !["open", "closed", "merged", "all"].includes(state) ||
      search.length > 200 || (cursor !== null && (typeof cursor !== "string" || cursor.length > 500)) ||
      (operation === "read" && (!Number.isSafeInteger(number) || number < 1))) {
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
  let unavailableReason = "";
  if (pullRequest.state !== "OPEN") {
    unavailableReason = "Only open pull requests can become sessions.";
  } else if (!pullRequest.headRepository || !pullRequest.headRef) {
    unavailableReason = "The source branch is no longer available.";
  } else if (pullRequest.headRepository.isArchived) {
    unavailableReason = "The source repository is archived.";
  } else if (!["ADMIN", "MAINTAIN", "WRITE"].includes(pullRequest.headRepository.viewerPermission)) {
    unavailableReason = "Your GitHub account needs write access to the source repository to save this session.";
  }
  return { ok: true, repository: fullName, pullRequest: { ...pullRequest, unavailableReason } };
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
