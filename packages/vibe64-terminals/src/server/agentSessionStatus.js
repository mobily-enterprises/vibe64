// What `vibe64-helper session status --json` reports for one bound session:
// its environment, workspace preparation and repository state, with the helper
// commands that repair them. The session command service runs it in the
// session's bound project.
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { REPOSITORY_UPDATE_CHECK_METADATA, sessionUpdateFirst } from "@local/vibe64-core/shared";
import { GENESIS_DERIVED_ARTIFACT_PATHS, genesisProjectContractNeedsAttention } from "@local/vibe64-genesis/server";
import {
  WORKSPACE_SETUP_METADATA_NAME,
  workspaceSetupStateFromMetadata
} from "@local/vibe64-runtime/server/workspaceSetupState";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { sessionWorkProblem } from "../shared/sessionWorkProblem.js";
import { inspectConnectedCopies } from "./sessionConnectedCopies.js";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "./sessionWorkTasks.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

/**
 * @param {object} input
 * @param {object} input.descriptor the session's source descriptor
 * @param {ProjectService} input.project
 * @param {object} input.projectRecord the bound project
 * @param {string} input.sessionId
 * @param {string} input.sourceRoot the session's source
 * @param {Vibe64SessionStore} input.store
 */
async function readAgentSessionStatus({ descriptor, project, projectRecord, sessionId, sourceRoot, store }) {
  const environment = await project.projectEnvironmentStatus({
    sessionId,
    session: { ...descriptor, sessionId }
  });
  let setup;
  try {
    setup = await project.inspectWorkspaceSetup({
      projectRoot: sourceRoot,
      session: await (await project.createRuntimeWithoutSource()).getSessionWithoutSource(sessionId)
    });
  } catch (error) {
    // The agent repairing or deciding a project contract still needs status;
    // report Genesis's actionable message instead of failing the command.
    if (!genesisProjectContractNeedsAttention(error)) throw error;
    setup = { status: "blocked", steps: [], diagnostics: [{ code: error.code, message: toText(error.message) }] };
  }
  const state = workspaceSetupStateFromMetadata({
    [WORKSPACE_SETUP_METADATA_NAME]: await store.readMetadataValue(sessionId, WORKSPACE_SETUP_METADATA_NAME)
  });
  // The stored Save or Update failure behind the editor's "Repository needs
  // help", so the assistant reports its recorded reason instead of guessing.
  const [saveOperation, updateOperation] = await Promise.all([SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID]
    .map((taskId) => store.readBackgroundTask(sessionId, taskId)));
  const repositoryProblem = sessionWorkProblem({ operation: saveOperation, updateOperation });
  // Whether this session is behind its saved version, with the incoming
  // versions, so a repair checks them before redoing their work.
  const updateFirst = sessionUpdateFirst({
    updateCheck: await store.readMetadataValue(sessionId, REPOSITORY_UPDATE_CHECK_METADATA),
    updateOperation
  });
  // This session's own copies of its connected repositories, with whether each has unsaved work or is behind its main.
  const [connectedCopies, recordedSourcePath] = await Promise.all([
    store.readMetadataValue(sessionId, "connected_copies"),
    store.readMetadataValue(sessionId, "source_path")
  ]);
  const connected = (await inspectConnectedCopies({
    copies: sessionConnectedCopies({ metadata: { connected_copies: connectedCopies, source_path: recordedSourcePath } }),
    derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
    project: projectRecord,
    session: { sessionId }
  })).map(({ behind, name, path: copyPath, unsaved }) => ({ name, path: copyPath, behind, unsaved }));
  return {
    ok: true,
    sessionId,
    project: toText(projectRecord.slug || projectRecord.name),
    environment,
    repository: {
      ...(repositoryProblem ? { needsHelp: true, ...repositoryProblem } : { needsHelp: false }),
      ...(updateFirst ? { updateFirst } : {}),
      ...(connected.length ? { connected } : {})
    },
    workspaceSetup: {
      status: state.status,
      inspectionStatus: setup.status,
      diagnostic: state.diagnostic,
      steps: setup.steps.map(({ label, argv }) => ({ label, argv })),
      diagnostics: setup.diagnostics
    },
    tools: {
      update: "vibe64-helper session update",
      environment: "vibe64-helper env status development",
      setupRetry: "vibe64-helper session setup retry",
      preview: "vibe64-helper preview status",
      browser: "vibe64-helper preview browser eval (Playwright code on stdin)",
      browserTests: "vibe64-helper playwright status",
      browserTestReadiness: "vibe64-helper playwright readiness",
      database: "vibe64-helper database refresh"
    },
    recovery: state.status === "failed"
      ? "Workspace setup failed. Fix its cause, then run vibe64-helper session setup retry (a deliberate preview ensure also reruns it) and read this status again."
      : environment.status === "not-prepared"
      // The assistant reads this mid-turn; starting Preview prepares the
      // workspace, so stale "not prepared" advice must not reach the person.
        ? "Run vibe64-helper preview ensure --wait: starting Preview prepares the workspace and its managed resources. Read this status again before reporting preparation to the person. If preparation fails, fix the cause; the person can use Retry on its card."
        : environment.status === "missing-configuration"
          ? "Supply the missing application resource configuration through Development Env."
          : environment.status === "unavailable"
            ? "Correct the project environment declaration and retry."
            : ""
  };
}

export { readAgentSessionStatus };
