import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  aiStudioResult
} from "../../../../server/lib/aiStudio/serverResponses.js";

const ARTIFACT_PREVIEWS = Object.freeze({
  ai_response: {
    artifactName: "response.md",
    label: "AI response",
    previewId: "ai_response"
  },
  report: {
    artifactName: "report.md",
    label: "Session report",
    previewId: "report"
  }
});

function artifactResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_artifact_request_failed",
    fallbackMessage: "AI Studio artifact request failed."
  });
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

function isSessionArtifactChange(filename = "") {
  return Boolean(path.basename(String(filename || "")).trim());
}

function closeWatcher(watcher = null) {
  try {
    watcher?.close?.();
  } catch {
    // Closing a filesystem watcher is best-effort during stream shutdown.
  }
}

function artifactPreviewById(previewId = "") {
  return ARTIFACT_PREVIEWS[String(previewId || "").trim()] || null;
}

async function artifactPreviewResponse(runtime, session = {}, preview = {}) {
  return {
    ...session,
    label: preview.label,
    ok: true,
    previewId: preview.previewId,
    text: String(await runtime.store.readArtifact(session.sessionId, preview.artifactName) || "").trim()
  };
}

function createService({ projectService } = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  return Object.freeze({
    async readArtifactPreview(sessionId, input = {}) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const preview = artifactPreviewById(input.previewId);
        if (!preview) {
          return artifactErrorResponse(
            session,
            "ai_studio_artifact_preview_not_available",
            `Artifact preview is not available: ${input.previewId || "(empty)"}`
          );
        }
        return artifactPreviewResponse(runtime, session, preview);
      });
    },

    async readArtifactReadiness(sessionId) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return {
          ...session,
          ok: true
        };
      });
    },

    async submitCurrentStepInput(sessionId, input = {}) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        return {
          ...await runtime.submitCurrentStepInput(sessionId, input),
          ok: true
        };
      });
    },

    async streamArtifactReadiness(sessionId, {
      emit = () => null,
      isClosed = () => false,
      onClose = () => null
    } = {}) {
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(sessionId);
      await mkdir(session.artifactsRoot, {
        recursive: true
      });

      let emitInFlight = false;
      let emitQueued = false;
      let watcher = null;

      async function emitCurrentArtifacts() {
        if (isClosed()) {
          return;
        }
        if (emitInFlight) {
          emitQueued = true;
          return;
        }

        emitInFlight = true;
        try {
          const currentSession = await runtime.getSession(sessionId);
          emit("artifact-readiness.updated", {
            artifactReadiness: currentSession.artifactReadiness,
            sessionId,
            ok: true
          });
        } finally {
          emitInFlight = false;
          if (emitQueued && !isClosed()) {
            emitQueued = false;
            await emitCurrentArtifacts();
          }
        }
      }

      function scheduleArtifactUpdate(filename = "") {
        if (!isSessionArtifactChange(filename)) {
          return;
        }
        void emitCurrentArtifacts().catch((error) => {
          emit("artifact-readiness.error", {
            error: String(error?.message || error || "Artifact readiness could not be read."),
            sessionId
          });
        });
      }

      await emitCurrentArtifacts();
      watcher = watch(session.artifactsRoot, {
        persistent: false
      }, (_eventType, filename) => {
        scheduleArtifactUpdate(filename);
      });

      return await new Promise((resolve) => {
        onClose(() => {
          closeWatcher(watcher);
          resolve({
            ok: true
          });
        });
      });
    }
  });
}

export { createService };
