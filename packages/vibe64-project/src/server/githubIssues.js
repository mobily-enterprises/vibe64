import { vibe64Error } from "@local/vibe64-core/server/core";
import { githubApi, requireGithubRepository } from "./githubApi.js";

const ISSUE_FIELDS = `number title body url state stateReason createdAt updatedAt
  author { login } viewerCanClose viewerCanReopen locked
  labels(first:100) { nodes { name color description } }`;
const PAGE_INFO = "pageInfo { hasNextPage endCursor }";
const LABEL_WRITE_PERMISSIONS = ["ADMIN", "MAINTAIN", "WRITE"];
const LABEL_EDIT_PERMISSIONS = [...LABEL_WRITE_PERMISSIONS, "TRIAGE"];

async function repositoryLabels(api, owner, name) {
  const labels = [];
  let cursor = null;
  let viewerPermission;
  do {
    const result = await api("graphql", {
      query: `query($owner:String!, $name:String!, $cursor:String) {
        repository(owner:$owner, name:$name) {
          viewerPermission labels(first:100, after:$cursor, orderBy:{field:NAME, direction:ASC}) {
            nodes { name color description } ${PAGE_INFO}
          }
        }
      }`,
      variables: { owner, name, cursor }
    });
    const repository = result.data?.repository;
    const page = repository?.labels;
    if (!Array.isArray(page?.nodes) || !page.pageInfo ||
        (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor))) {
      throw vibe64Error("GitHub labels could not load. Refresh and try again.", "vibe64_github_issues_failed");
    }
    labels.push(...page.nodes);
    viewerPermission = repository.viewerPermission;
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return {
    labels,
    canCreateWithLabels: LABEL_WRITE_PERMISSIONS.includes(viewerPermission),
    canEditLabels: LABEL_EDIT_PERMISSIONS.includes(viewerPermission)
  };
}

export async function githubIssues(project, input = {}, options = {}) {
  const fullName = requireGithubRepository(project, "Issues");
  const operation = input.operation || "list";
  if (!["list", "read", "comment", "state", "create", "labels", "set-labels"].includes(operation)) {
    throw vibe64Error("Unknown issue action.", "vibe64_issue_input_invalid");
  }
  const number = Number(input.number);
  if (["read", "comment", "state", "set-labels"].includes(operation) && (!Number.isSafeInteger(number) || number < 1)) {
    throw vibe64Error("Choose a valid issue number.", "vibe64_issue_input_invalid");
  }
  const state = input.state || "open";
  const search = String(input.search || "").trim();
  const cursor = input.cursor || null;
  if (!["open", "closed", "all"].includes(state) || search.length > 200 ||
      (cursor !== null && (typeof cursor !== "string" || cursor.length > 500)) ||
      (operation === "state" && !["open", "closed"].includes(input.state)) ||
      (operation === "comment" && (typeof input.body !== "string" || !input.body.trim() || input.body.length > 65536))) {
    throw vibe64Error("Check the issue filters or comment and try again.", "vibe64_issue_input_invalid");
  }
  if (operation === "create" && (typeof input.title !== "string" || !input.title.trim() || input.title.length > 256 ||
      (input.body != null && (typeof input.body !== "string" || input.body.length > 65536)))) {
    throw vibe64Error("Enter an issue title and a description of up to 65,536 characters.", "vibe64_issue_input_invalid");
  }
  const selectedLabels = operation === "create" ? input.labels ?? [] : input.labels;
  if (["create", "set-labels"].includes(operation) &&
      (!Array.isArray(selectedLabels) || selectedLabels.length > 100 ||
       selectedLabels.some((label) => typeof label !== "string" || !label.trim()))) {
    throw vibe64Error("Choose up to 100 repository labels.", "vibe64_issue_input_invalid");
  }
  const api = githubApi(input, {
    ...options,
    feature: "Issues",
    failureCode: "vibe64_github_issues_failed",
    uncertainWriteMessage: operation === "comment"
      ? "The comment could not be confirmed. Refresh the conversation before posting again."
      : operation === "create" ? "Issue creation could not be confirmed. Refresh the issue list before trying again." : ""
  });
  const [owner, name] = fullName.split("/");
  if (operation === "labels" || operation === "set-labels" || (operation === "create" && selectedLabels.length)) {
    const catalog = await repositoryLabels(api, owner, name);
    if (operation === "labels") return { ok: true, ...catalog };
    const allowed = operation === "create" ? catalog.canCreateWithLabels : catalog.canEditLabels;
    if (!allowed) {
      throw vibe64Error("Your GitHub account cannot set labels for this issue.", "vibe64_issue_permission_denied");
    }
    const names = new Set(catalog.labels.map((label) => label.name));
    if (selectedLabels.some((label) => !names.has(label))) {
      throw vibe64Error("A selected label is no longer available. Reload the labels and try again.", "vibe64_issue_input_invalid");
    }
  }
  if (operation === "create") {
    const created = await api(`repos/${fullName}/issues`, {
      title: input.title.trim(), body: input.body || "", labels: selectedLabels
    });
    if (!Number.isSafeInteger(created.number) || !created.html_url) {
      throw vibe64Error("Issue creation could not be confirmed. Refresh the issue list before trying again.", "vibe64_github_issues_failed");
    }
    return { ok: true, issue: { number: created.number, url: created.html_url } };
  }
  if (operation === "list") {
    // Search text is a literal phrase, never a user-supplied repository qualifier.
    const phrase = search.replace(/["\\\r\n]/gu, " ").trim();
    const query = `repo:${fullName} is:issue ${state === "all" ? "" : `is:${state}`} ${phrase ? `"${phrase}" in:title,body` : ""} sort:updated-desc`;
    const result = await api("graphql", {
      query: `query($search:String!, $cursor:String) {
        search(query:$search, type:ISSUE, first:25, after:$cursor) {
          issueCount ${PAGE_INFO} nodes { ... on Issue {
            number title url state updatedAt author { login } comments { totalCount }
            labels(first:10) { totalCount nodes { name color description } }
          } }
        }
      }`, variables: { search: query, cursor }
    });
    const list = result.data?.search;
    if (!Array.isArray(list?.nodes)) throw vibe64Error("GitHub returned an unreadable issue list.", "vibe64_github_issues_failed");
    return { ok: true, repository: fullName, issues: list.nodes.filter((issue) => issue?.number),
      total: list.issueCount, pageInfo: list.pageInfo };
  }
  const result = await api("graphql", {
    query: `query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
      repository(owner:$owner, name:$name) { viewerPermission issue(number:$number) {
        ${ISSUE_FIELDS} comments(last:25, before:$cursor) {
          totalCount pageInfo { hasPreviousPage startCursor } nodes { id body createdAt author { login } }
        }
      } }
    }`, variables: { owner, name, number, cursor }
  });
  const issue = result.data?.repository?.issue;
  if (!issue) throw vibe64Error("This issue is unavailable or you no longer have access.", "vibe64_issue_not_found");
  if (operation === "read") {
    const canEditLabels = LABEL_EDIT_PERMISSIONS.includes(result.data.repository.viewerPermission);
    return { ok: true, repository: fullName, issue: { ...issue, canEditLabels } };
  }
  if (operation === "set-labels") {
    await api(`repos/${fullName}/issues/${number}/labels`, { labels: selectedLabels }, "PUT");
    return { ok: true, issue: { number } };
  }
  if (operation === "state") {
    const allowed = input.state === "closed" ? issue.viewerCanClose : issue.viewerCanReopen;
    if (!allowed) throw vibe64Error("Your GitHub account cannot change this issue's state.", "vibe64_issue_permission_denied");
    const updated = await api(`repos/${fullName}/issues/${number}`, {
      state: input.state, state_reason: input.state === "closed" ? "completed" : "reopened"
    }, "PATCH");
    return { ok: true, state: String(updated.state).toUpperCase(), stateReason: updated.state_reason };
  }
  const comment = await api(`repos/${fullName}/issues/${number}/comments`, { body: input.body });
  return { ok: true, comment: { id: String(comment.node_id), body: comment.body,
    createdAt: comment.created_at, author: { login: comment.user?.login || "" } } };
}
