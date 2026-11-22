import { githubRepositoryFullName, readConnectedProjects } from "./connectedProjects.js";
import {
  inspectConnectedDevelopmentInputs,
  inspectConnectedWorkspaceSetup,
  materializeConnectedDevelopmentInputs
} from "./connectedDevelopment.js";
import { requireGithubRepository } from "./githubApi.js";
import { githubIssues } from "./githubIssues.js";
import {
  githubPullRequests,
  pullRequestSessionSource,
  preparePullRequestSource,
  publishSessionPullRequest
} from "./githubPullRequests.js";
import { localRepositoryRemote } from "./localRepositoryRemote.js";
import { repositoryBranches } from "./repositoryBranches.js";
import {
  readProjectRepositoryWorkflow,
  saveProjectRepositoryWorkflow
} from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { inspectVibe64ConnectedDevelopment, inspectVibe64WorkspaceSetup } from "@local/vibe64-genesis/server";
import { runProjectSourceExclusive } from "./projectSourceMutationLock.js";
import { projectResult } from "./projectResult.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").PublishProjectChanged} PublishProjectChanged */
/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */

/**
 * The project's repositories: its remote and branches, the connected repositories
 * a session lists and their Sources file, the repository workflow, and GitHub
 * issues and pull requests.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {PublishProjectChanged} dependencies.publishProjectChanged
 * @param {ProjectSelection} dependencies.selection
 */
function createProjectRepositories({
  env,
  logger,
  publishProjectChanged,
  selection
}) {
  async function notifyGithubChanged(project, payload = { githubRefresh: true }, reason = "github-refreshed") {
    try {
      await publishProjectChanged({ ...payload, projectSlug: project.slug }, { reason });
    } catch (error) {
      // Publication is already confirmed; a notification failure must not invite a duplicate write.
      logger.warn({ error: String(error?.message || error) }, "GitHub change notification could not be published.");
    }
  }

  async function repositoryRemote(input) {
    return projectResult(async () => localRepositoryRemote(await selection.currentProjectState(), input, { logger }));
  }

  async function readRepositoryBranches(input) {
    return projectResult(async () => repositoryBranches(await selection.currentProjectState(), input, { env }));
  }

  async function resolveSessionBranch(input = {}) {
    return repositoryBranches(await selection.currentProjectState(), input, { env });
  }

  /**
   * The connected repositories this session's own source lists, as GitHub owner/name with their names.
   * @param {object} session
   */
  async function readSessionConnectedRepositories(session) {
    const { repositories } = await readConnectedProjects(sessionSourcePath(session));
    return repositories.map(connection => ({ ...connection, fullName: githubRepositoryFullName(connection.repository) }));
  }

  async function inspectWorkspaceSetup({ session, projectRoot = sessionSourcePath(session), environment = env } = {}) {
    const [setup, inspection] = await Promise.all([
      inspectVibe64WorkspaceSetup({ projectRoot, environment }),
      inspectVibe64ConnectedDevelopment({ projectRoot, environment })
    ]);
    return inspectConnectedWorkspaceSetup({ session, setup, inspection, env: environment });
  }

  async function inspectSessionConnectedInputs({ session, environment = env } = {}) {
    const inspection = await inspectVibe64ConnectedDevelopment({
      projectRoot: sessionSourcePath(session),
      environment
    });
    if (inspection.status === "unconfigured" && !(await readSessionConnectedRepositories(session)).length) {
      return { status: "unconfigured" };
    }
    return inspectConnectedDevelopmentInputs({ session, inspection, env: environment });
  }

  async function prepareConnectedDevelopmentInputs({ session, environment = env } = {}) {
    const inspection = await inspectVibe64ConnectedDevelopment({
      projectRoot: sessionSourcePath(session),
      environment
    });
    if (inspection.status === "unconfigured" && !(await readSessionConnectedRepositories(session)).length) {
      return { status: "unconfigured" };
    }
    return runProjectSourceExclusive(
      selection.selectedProjectRuntimeRoot(),
      () => materializeConnectedDevelopmentInputs({ session, inspection, env: environment }),
      { operation: "prepare-connected-development-inputs" }
    );
  }

  async function readRepositoryWorkflow() {
    return readProjectRepositoryWorkflow(selection.selectedProjectRuntimeRoot());
  }

  async function saveRepositoryWorkflow(input) {
    return projectResult(async () => {
      requireGithubRepository(await selection.currentProjectState(), "Pull request workflow");
      const workflow = await runProjectSourceExclusive(
        selection.selectedProjectRuntimeRoot(),
        () => saveProjectRepositoryWorkflow(selection.selectedProjectRuntimeRoot(), input.requirePullRequest),
        { operation: "repository-workflow-settings" }
      );
      await publishProjectChanged({
        projectSlug: (await selection.currentProjectState()).slug,
        repositoryWorkflow: workflow
      }, { reason: "repository-workflow-settings" });
      return { ok: true, workflow };
    });
  }

  async function refreshGithub() {
    const project = await selection.currentProjectState();
    requireGithubRepository(project);
    await publishProjectChanged({ projectSlug: project.slug, githubRefresh: true }, { reason: "github-refreshed" });
    return { ok: true };
  }

  /**
   * Runs one GitHub issue operation in the current project and announces the change a write made.
   * @param {string} operation
   * @param {object} input
   */
  async function runGithubIssueOperation(operation, input) {
    return projectResult(async () => {
      const project = await selection.currentProjectState();
      const result = await githubIssues(project, { ...input, operation }, { env });
      if (operation === "comment") {
        await notifyGithubChanged(project, {
          originId: input.originId,
          issueComment: { number: Number(input.number), id: result.comment.id, author: result.comment.author.login }
        }, "github-issue-commented");
      } else if (["create", "edit", "edit-comment", "state", "create-label", "set-labels"].includes(operation)) {
        await notifyGithubChanged(project);
      }
      return result;
    });
  }

  /**
   * Runs one GitHub pull request operation in the current project and announces the change a write made.
   * @param {string} operation
   * @param {object} input
   */
  async function runGithubPullRequestOperation(operation, input) {
    return projectResult(async () => {
      const project = await selection.currentProjectState();
      const result = await githubPullRequests(project, { ...input, operation }, { env });
      if (["ready", "update-branch", "merge"].includes(operation)) await notifyGithubChanged(project);
      return result;
    });
  }

  /**
   * The project's GitHub issues, filtered and paged.
   * @param {object} input
   */
  function listGithubIssues(input) {
    return runGithubIssueOperation("list", input);
  }

  /**
   * One GitHub issue with its comments.
   * @param {object} input
   */
  function readGithubIssue(input) {
    return runGithubIssueOperation("read", input);
  }

  /**
   * Creates a GitHub issue.
   * @param {object} input
   */
  function createGithubIssue(input) {
    return runGithubIssueOperation("create", input);
  }

  /**
   * Edits a GitHub issue's title and description.
   * @param {object} input
   */
  function editGithubIssue(input) {
    return runGithubIssueOperation("edit", input);
  }

  /**
   * Comments on a GitHub issue.
   * @param {object} input
   */
  function commentOnGithubIssue(input) {
    return runGithubIssueOperation("comment", input);
  }

  /**
   * Edits a comment on a GitHub issue.
   * @param {object} input
   */
  function editGithubIssueComment(input) {
    return runGithubIssueOperation("edit-comment", input);
  }

  /**
   * Closes or reopens a GitHub issue.
   * @param {object} input
   */
  function updateGithubIssueState(input) {
    return runGithubIssueOperation("state", input);
  }

  /**
   * The repository's GitHub labels and the person's label permissions.
   * @param {object} input
   */
  function listGithubIssueLabels(input) {
    return runGithubIssueOperation("labels", input);
  }

  /**
   * Creates a GitHub repository label.
   * @param {object} input
   */
  function createGithubIssueLabel(input) {
    return runGithubIssueOperation("create-label", input);
  }

  /**
   * Replaces, adds or removes a GitHub issue's labels.
   * @param {object} input
   */
  function updateGithubIssueLabels(input) {
    return runGithubIssueOperation("set-labels", input);
  }

  /**
   * The people an issue comment can mention.
   * @param {object} input
   */
  function listGithubIssueMentions(input) {
    return runGithubIssueOperation("mentions", input);
  }

  /**
   * The project's GitHub pull requests.
   * @param {object} input
   */
  function listGithubPullRequests(input) {
    return runGithubPullRequestOperation("list", input);
  }

  /**
   * One GitHub pull request.
   * @param {object} input
   */
  function readGithubPullRequest(input) {
    return runGithubPullRequestOperation("read", input);
  }

  /**
   * Marks a reviewed GitHub pull request ready for review.
   * @param {object} input
   */
  function markGithubPullRequestReady(input) {
    return runGithubPullRequestOperation("ready", input);
  }

  /**
   * Updates a reviewed GitHub pull request's branch from its base.
   * @param {object} input
   */
  function updateGithubPullRequestBranch(input) {
    return runGithubPullRequestOperation("update-branch", input);
  }

  /**
   * Merges a reviewed GitHub pull request.
   * @param {object} input
   */
  function mergeGithubPullRequest(input) {
    return runGithubPullRequestOperation("merge", input);
  }

  async function resolvePullRequestSource(input = {}) {
    const result = await githubPullRequests(await selection.currentProjectState(), { ...input, operation: "read" }, { env });
    return pullRequestSessionSource(result.pullRequest);
  }

  async function prepareSessionPullRequestSource(session, input = {}) {
    return preparePullRequestSource(await selection.currentProjectState(), session, input, { env });
  }

  async function publishPullRequestForSession(source, input = {}) {
    const project = await selection.currentProjectState();
    const result = await publishSessionPullRequest(source, input, { env });
    await notifyGithubChanged(project);
    return result;
  }

  return Object.freeze({
    repositoryRemote,
    repositoryBranches: readRepositoryBranches,
    resolveSessionBranch,
    inspectWorkspaceSetup,
    inspectConnectedDevelopmentInputs: inspectSessionConnectedInputs,
    prepareConnectedDevelopmentInputs,
    readSessionConnectedRepositories,
    readRepositoryWorkflow,
    saveRepositoryWorkflow,
    refreshGithub,
    listGithubIssues,
    readGithubIssue,
    createGithubIssue,
    editGithubIssue,
    commentOnGithubIssue,
    editGithubIssueComment,
    updateGithubIssueState,
    listGithubIssueLabels,
    createGithubIssueLabel,
    updateGithubIssueLabels,
    listGithubIssueMentions,
    listGithubPullRequests,
    readGithubPullRequest,
    markGithubPullRequestReady,
    updateGithubPullRequestBranch,
    mergeGithubPullRequest,
    resolvePullRequestSource,
    preparePullRequestSource: prepareSessionPullRequestSource,
    publishSessionPullRequest: publishPullRequestForSession
  });
}

export {
  createProjectRepositories
};
