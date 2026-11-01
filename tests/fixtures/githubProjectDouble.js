// The project capability's named GitHub operations, keyed by the operation each runs, for tests that pin which
// operation a route, tool or service call reached.
const GITHUB_ISSUE_METHODS = Object.freeze({
  list: "listGithubIssues",
  read: "readGithubIssue",
  create: "createGithubIssue",
  edit: "editGithubIssue",
  comment: "commentOnGithubIssue",
  "edit-comment": "editGithubIssueComment",
  state: "updateGithubIssueState",
  labels: "listGithubIssueLabels",
  "create-label": "createGithubIssueLabel",
  "set-labels": "updateGithubIssueLabels",
  mentions: "listGithubIssueMentions"
});

const GITHUB_PULL_REQUEST_METHODS = Object.freeze({
  list: "listGithubPullRequests",
  read: "readGithubPullRequest",
  ready: "markGithubPullRequestReady",
  "update-branch": "updateGithubPullRequestBranch",
  merge: "mergeGithubPullRequest"
});

/**
 * A project double whose named GitHub operations each call `run` with the input and the operation that method runs.
 * The operation goes first, so an input that still carried one would show it.
 * @param {Record<string, string>} methods
 * @param {(input: object) => unknown} run
 */
function githubOperationsDouble(methods, run) {
  return Object.fromEntries(Object.entries(methods).map(([operation, method]) => [method, (input) => run({ operation, ...input })]));
}

export { GITHUB_ISSUE_METHODS, GITHUB_PULL_REQUEST_METHODS, githubOperationsDouble };
