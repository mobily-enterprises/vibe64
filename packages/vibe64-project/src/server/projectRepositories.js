import { githubRepositoryFullName } from "./connectedProjects.js";
import {
  inspectConnectedDevelopmentInputs,
  inspectConnectedWorkspaceSetup,
  materializeConnectedDevelopmentInputs
} from "./connectedDevelopment.js";
import { projectGithubFullName, requireGithubRepository } from "./githubApi.js";
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
import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { inspectVibe64ConnectedDevelopment, inspectVibe64WorkspaceSetup } from "@local/vibe64-genesis/server";
import { runProjectSourceExclusive } from "./projectSourceMutationLock.js";
import { projectResult } from "./projectResult.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").PublishProjectChanged} PublishProjectChanged */
/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */

/**
 * The project's repositories: its remote and branches, connected repositories and
 * contributions, the repository workflow, Incoming changes, and GitHub issues and
 * pull requests.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {(fullName: string, branch: string, input: object) => Promise<object>} dependencies.inspectConnectedBranch
 * @param {(fullName: string, input: object) => Promise<object>} dependencies.inspectConnectedRepository
 * @param {RuntimeLogger} dependencies.logger
 * @param {ReturnType<typeof import("./projectSettings.js").createProjectSettings>} dependencies.projectSettings
 * @param {PublishProjectChanged} dependencies.publishProjectChanged
 * @param {ProjectSelection} dependencies.selection
 */
function createProjectRepositories({
  env,
  inspectConnectedBranch,
  inspectConnectedRepository,
  logger,
  projectSettings,
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

  async function connectedProjectTargets(input = {}) {
    const connections = await projectSettings.connectedProjectsState(input);
    if (!connections.available) throw vibe64Error(connections.unavailableReason, "vibe64_connections_source_required");
    const listed = await selection.listProjectsState();
    return connections.projects.map(connection => {
      const fullName = githubRepositoryFullName(connection.repository);
      const matches = listed.projects.filter(candidate => candidate.repositoryMode === "github" &&
        projectGithubFullName(candidate).toLowerCase() === fullName);
      if (matches.length !== 1) {
        throw vibe64Error(
          `Register one accessible GitHub project for ${fullName} before preparing this connection. Existing source and access are unchanged.`,
          "vibe64_connected_project_registration_required"
        );
      }
      return { ...connection, fullName, projectSlug: matches[0].slug };
    });
  }

  async function inspectWorkspaceSetup({ session, projectRoot = sessionSourcePath(session), environment = env } = {}) {
    const [setup, inspection] = await Promise.all([
      inspectVibe64WorkspaceSetup({ projectRoot, environment }),
      inspectVibe64ConnectedDevelopment({ projectRoot, environment })
    ]);
    return inspectConnectedWorkspaceSetup({ session, setup, inspection, env: environment });
  }

  async function inspectSessionConnectedInputs({ session, projects, environment = env } = {}) {
    const inspection = await inspectVibe64ConnectedDevelopment({
      projectRoot: sessionSourcePath(session),
      environment
    });
    if (projects.length === 0 && inspection.status === "unconfigured") return { status: "unconfigured" };
    return inspectConnectedDevelopmentInputs({ session, projects, inspection, env: environment });
  }

  async function prepareConnectedDevelopmentInputs({ session, projects, environment = env } = {}) {
    const inspection = await inspectVibe64ConnectedDevelopment({
      projectRoot: sessionSourcePath(session),
      environment
    });
    if (projects.length === 0 && inspection.status === "unconfigured") return { status: "unconfigured" };
    return runProjectSourceExclusive(
      selection.selectedProjectRuntimeRoot(),
      () => materializeConnectedDevelopmentInputs({ session, projects, inspection, env: environment }),
      { operation: "prepare-connected-development-inputs" }
    );
  }

  async function connectedContributionSource(input = {}) {
    const current = await selection.currentProjectState();
    const repository = requireGithubRepository(current, "Connected contribution");
    if (current.repositoryMode !== "github") throw vibe64Error("Connected contributions need the receiving project's GitHub source authority.", "vibe64_contribution_authority_changed");
    const access = await inspectConnectedRepository(repository, input);
    if (access.permissions?.push !== true || access.archived || access.disabled) throw vibe64Error(`Write access to ${repository} is required to prepare its contribution.`, "vibe64_connections_access_required");
    const integrationBranch = current.repository.defaultBranch;
    // Read only the integration branch; listing every branch made each
    // connected session start page through the whole repository.
    const branch = await inspectConnectedBranch(repository, integrationBranch, input);
    if (!branch?.commit?.sha) throw vibe64Error("The receiving integration branch is unavailable.", "vibe64_incoming_target_missing");
    return { repository: repository.toLowerCase(), integrationBranch, baseCommit: branch.commit.sha };
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

  async function incomingRepository(input = {}) {
    const project = await selection.currentProjectState();
    const fullName = requireGithubRepository(project, "Incoming changes");
    if (project.repositoryMode !== "github") {
      throw vibe64Error("Incoming changes need a configured GitHub integration target.", "vibe64_incoming_repository_required");
    }
    const repository = await inspectConnectedRepository(fullName, input);
    const writeReason = repository.archived || repository.disabled
      ? "This repository is archived or disabled."
      : repository.permissions?.push !== true ? "Your GitHub account needs write access to this receiving repository." : "";
    const workflow = await readProjectRepositoryWorkflow(selection.selectedProjectRuntimeRoot());
    const mergeReason = writeReason || (workflow.requirePullRequest
      ? "This project requires pull requests for integration. Its current Save policy prevents direct Incoming merges." : "");
    const actions = { merge: mergeReason, discard: writeReason };
    if (input.action && actions[input.action]) {
      throw vibe64Error(actions[input.action], "vibe64_incoming_integration_forbidden");
    }
    return { project, actions };
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
    connectedProjectTargets,
    inspectWorkspaceSetup,
    inspectConnectedDevelopmentInputs: inspectSessionConnectedInputs,
    prepareConnectedDevelopmentInputs,
    connectedContributionSource,
    readRepositoryWorkflow,
    saveRepositoryWorkflow,
    refreshGithub,
    incomingRepository,
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
