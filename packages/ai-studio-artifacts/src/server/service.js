import path from "node:path";
import {
  aiStudioResult,
  normalizePlainObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

const EDITABLE_ARTIFACTS = Object.freeze({
  "issue.md": Object.freeze({
    blockedMetadata: "issue_url",
    blockedMessage: "The GitHub issue already exists; edit it on GitHub instead.",
    editorActionId: "edit_issue",
    requiredMessage: "Issue body is required."
  }),
  issue_title: Object.freeze({
    blockedMetadata: "issue_url",
    blockedMessage: "The GitHub issue already exists; edit it on GitHub instead.",
    editorActionId: "edit_issue",
    metadataName: "issue_title",
    requiredMessage: "Issue title is required."
  }),
  "pull_request.md": Object.freeze({
    blockedMetadata: "pr_url",
    blockedMessage: "The GitHub pull request already exists; edit it on GitHub instead.",
    editorActionId: "edit_pr",
    requiredMessage: "Pull request body is required."
  })
});

function artifactResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_artifact_request_failed",
    fallbackMessage: "AI Studio artifact request failed."
  });
}

function artifactNames() {
  return Object.keys(EDITABLE_ARTIFACTS)
    .sort((left, right) => left.localeCompare(right));
}

function artifactPolicy(artifactName = "") {
  return EDITABLE_ARTIFACTS[String(artifactName || "").trim()] || null;
}

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function artifactPath(session = {}, artifactName = "") {
  return session.artifactsRoot && artifactName ? path.join(session.artifactsRoot, artifactName) : "";
}

function artifactState(session = {}, artifactName = "") {
  const policy = artifactPolicy(artifactName);
  if (!policy) {
    return {
      disabledReason: `Artifact is not editable: ${artifactName}`,
      editable: false
    };
  }

  const action = actionById(session, policy.editorActionId);
  if (!action || action.type !== "editor") {
    return {
      disabledReason: `Editor action ${policy.editorActionId} is not available on this AI Studio step.`,
      editable: false
    };
  }
  if (policy.blockedMetadata && session.metadata?.[policy.blockedMetadata]) {
    return {
      disabledReason: policy.blockedMessage,
      editable: false
    };
  }
  if (action.enabled !== true) {
    return {
      disabledReason: action.disabledReason || `Editor action ${policy.editorActionId} is disabled.`,
      editable: false
    };
  }

  return {
    disabledReason: "",
    editable: true
  };
}

function artifactErrorResponse(session = {}, code = "", message = "") {
  return {
    ...session,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function normalizeArtifactInput(input = {}) {
  const artifactEntries = Object.entries(normalizePlainObject(input.artifacts))
    .map(([name, value]) => [
      String(name || "").trim(),
      String(value || "").trim()
    ])
    .filter(([name]) => Boolean(name));
  return Object.fromEntries(artifactEntries);
}

function artifactsResponse(session = {}, artifacts = {}) {
  const editableArtifacts = artifactNames();
  const artifactPaths = Object.fromEntries(editableArtifacts.map((artifactName) => {
    return [artifactName, artifactPath(session, artifactName)];
  }));
  const artifactStates = Object.fromEntries(editableArtifacts.map((artifactName) => {
    return [artifactName, artifactState(session, artifactName)];
  }));
  return {
    ...session,
    artifactPaths,
    artifacts,
    artifactStates,
    editableArtifacts,
    ok: true
  };
}

async function readEditableArtifacts(runtime, session = {}) {
  const artifactEntries = await Promise.all(artifactNames().map(async (artifactName) => {
    return [artifactName, await runtime.store.readArtifact(session.sessionId, artifactName)];
  }));
  return Object.fromEntries(artifactEntries);
}

function createService({ projectService } = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  return Object.freeze({
    async readArtifacts(sessionId) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return artifactsResponse(
          session,
          await readEditableArtifacts(runtime, session)
        );
      });
    },

    async saveArtifacts(sessionId, input = {}) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const artifacts = normalizeArtifactInput(input);
        if (Object.keys(artifacts).length < 1) {
          return artifactErrorResponse(
            session,
            "ai_studio_artifacts_required",
            "At least one editable artifact is required."
          );
        }

        for (const [artifactName, artifactText] of Object.entries(artifacts)) {
          const policy = artifactPolicy(artifactName);
          if (!policy) {
            return artifactErrorResponse(
              session,
              "ai_studio_artifact_not_editable",
              `Artifact is not editable: ${artifactName}`
            );
          }
          const state = artifactState(session, artifactName);
          if (!state.editable) {
            return artifactErrorResponse(
              session,
              "ai_studio_artifact_edit_not_available",
              state.disabledReason
            );
          }
          if (!artifactText) {
            return artifactErrorResponse(
              session,
              "ai_studio_artifact_required",
              policy.requiredMessage || `Artifact text is required: ${artifactName}`
            );
          }
        }

        await Promise.all(Object.entries(artifacts).flatMap(([artifactName, artifactText]) => {
          const writes = [
            runtime.store.writeArtifact(sessionId, artifactName, `${artifactText}\n`)
          ];
          const metadataName = artifactPolicy(artifactName)?.metadataName;
          if (metadataName) {
            writes.push(runtime.store.writeMetadataValue(sessionId, metadataName, artifactText));
          }
          return writes;
        }));

        const updatedSession = await runtime.getSession(sessionId);
        return artifactsResponse(
          updatedSession,
          await readEditableArtifacts(runtime, updatedSession)
        );
      });
    }
  });
}

export { createService };
