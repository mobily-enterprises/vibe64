import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  aiStudioResult,
  normalizePlainObject
} from "../../../../server/lib/aiStudio/serverResponses.js";
import {
  deepFreeze
} from "../../../../server/lib/aiStudio/deepFreeze.js";
import {
  AUTOPILOT_FILE_ARTIFACTS,
  AUTOPILOT_ISSUE_DRAFT_ARTIFACT,
  AUTOPILOT_PROMPT_DONE_ARTIFACT,
  AUTOPILOT_QUESTIONS_ARTIFACT,
  normalizeAutopilotIssueDraftFile,
  normalizeAutopilotPromptDoneFile,
  normalizeAutopilotQuestionsFile
} from "../../../../server/lib/aiStudio/autopilotFiles.js";

const EMPTY_EDITOR_ACTION = deepFreeze({
  action: null,
  code: "ai_studio_editor_action_required",
  fields: [],
  message: "Editor action id is required.",
  ok: false
});
const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const SEED_APPLICATION_STEP_ID = "seed_application_defined";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const ISSUE_WORD_ARTIFACT = "issue_word";
const AUTOPILOT_FILE_NAMES = new Set(AUTOPILOT_FILE_ARTIFACTS);
const ISSUE_ARTIFACT_WRITE_STEPS = new Set([
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID
]);

function artifactResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_artifact_request_failed",
    fallbackMessage: "AI Studio artifact request failed."
  });
}

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function artifactPath(session = {}, artifactName = "") {
  return session.artifactsRoot && artifactName ? path.join(session.artifactsRoot, artifactName) : "";
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

function artifactText(value = "") {
  return `${String(value || "").trim()}\n`;
}

function issueArtifactInput(input = {}) {
  return {
    body: String(input.body || "").trim(),
    title: String(input.title || "").trim(),
    word: String(input.word || input.issueWord || "").trim()
  };
}

function issueArtifactsWriteState(session = {}) {
  if (!ISSUE_ARTIFACT_WRITE_STEPS.has(String(session.currentStep || ""))) {
    return {
      code: "ai_studio_issue_artifacts_step_required",
      message: "Issue artifacts can only be saved while defining the issue or seed issue.",
      ok: false
    };
  }
  if (String(session.metadata?.issue_url || "").trim()) {
    return {
      code: "ai_studio_issue_already_selected",
      message: "An existing GitHub issue is already selected.",
      ok: false
    };
  }
  return {
    code: "",
    message: "",
    ok: true
  };
}

function normalizeArtifactField(field = {}) {
  const name = String(field?.name || "").trim();
  if (!name) {
    return null;
  }
  const kind = String(field.kind || "textarea").trim();
  return {
    kind: kind === "text" ? "text" : "textarea",
    label: String(field.label || name).trim(),
    metadataName: String(field.metadataName || "").trim(),
    name,
    required: field.required !== false,
    requiredMessage: String(field.requiredMessage || "").trim()
  };
}

function normalizeArtifactFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map(normalizeArtifactField)
    .filter(Boolean);
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

function editorActionState(session = {}, actionId = "") {
  const normalizedActionId = String(actionId || "").trim();
  if (!normalizedActionId) {
    return EMPTY_EDITOR_ACTION;
  }

  const action = actionById(session, normalizedActionId);
  if (!action) {
    return {
      action: null,
      code: "ai_studio_editor_action_not_available",
      fields: [],
      message: `Editor action ${normalizedActionId} is not available on this AI Studio step.`,
      ok: false
    };
  }
  if (action.type !== "editor") {
    return {
      action,
      code: "ai_studio_action_not_editor",
      fields: [],
      message: `Action ${normalizedActionId} is not an editor action.`,
      ok: false
    };
  }
  if (action.enabled !== true) {
    return {
      action,
      code: "ai_studio_artifact_edit_not_available",
      fields: normalizeArtifactFields(action.artifactFields),
      message: action.disabledReason || `Editor action ${normalizedActionId} is disabled.`,
      ok: false
    };
  }

  const fields = normalizeArtifactFields(action.artifactFields);
  if (fields.length < 1) {
    return {
      action,
      code: "ai_studio_editor_artifacts_missing",
      fields: [],
      message: `Editor action ${normalizedActionId} does not declare editable artifacts.`,
      ok: false
    };
  }

  return {
    action,
    code: "",
    fields,
    message: "",
    ok: true
  };
}

function artifactStatesForFields(fields = []) {
  return Object.fromEntries(fields.map((field) => [
    field.name,
    {
      disabledReason: "",
      editable: true
    }
  ]));
}

function artifactNamesForFields(fields = []) {
  return fields
    .map((field) => field.name)
    .filter(Boolean);
}

function artifactFieldByName(fields = []) {
  return new Map(fields.map((field) => [field.name, field]));
}

function artifactsResponse(session = {}, editor = {}, artifacts = {}) {
  const artifactFields = editor.fields || [];
  const editableArtifacts = artifactNamesForFields(artifactFields);
  const artifactPaths = Object.fromEntries(editableArtifacts.map((artifactName) => {
    return [artifactName, artifactPath(session, artifactName)];
  }));
  return {
    ...session,
    actionId: editor.action?.id || "",
    artifactFields,
    artifactPaths,
    artifacts,
    artifactStates: artifactStatesForFields(artifactFields),
    editableArtifacts,
    ok: true
  };
}

function issueArtifactsResponse(session = {}, artifacts = {}) {
  return {
    ...session,
    artifactFields: [
      {
        kind: "text",
        label: "Issue title",
        metadataName: ISSUE_TITLE_ARTIFACT,
        name: ISSUE_TITLE_ARTIFACT,
        required: true,
        requiredMessage: "Issue title is required."
      },
      {
        kind: "text",
        label: "Session label",
        metadataName: ISSUE_WORD_ARTIFACT,
        name: ISSUE_WORD_ARTIFACT,
        required: true,
        requiredMessage: "Session label is required."
      },
      {
        kind: "textarea",
        label: "Issue body",
        metadataName: "",
        name: ISSUE_BODY_ARTIFACT,
        required: true,
        requiredMessage: "Issue body is required."
      }
    ],
    artifacts,
    ok: true
  };
}

function parseAutopilotJson(text = "") {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

async function readAutopilotJson(runtime, sessionId = "", artifactName = "", normalize = () => null) {
  return normalize(parseAutopilotJson(await runtime.store.readArtifact(sessionId, artifactName)));
}

async function readAutopilotFiles(runtime, sessionId = "") {
  const [
    issueDraft,
    promptDone,
    questions
  ] = await Promise.all([
    readAutopilotJson(runtime, sessionId, AUTOPILOT_ISSUE_DRAFT_ARTIFACT, normalizeAutopilotIssueDraftFile),
    readAutopilotJson(runtime, sessionId, AUTOPILOT_PROMPT_DONE_ARTIFACT, normalizeAutopilotPromptDoneFile),
    readAutopilotJson(runtime, sessionId, AUTOPILOT_QUESTIONS_ARTIFACT, normalizeAutopilotQuestionsFile)
  ]);
  return {
    issueDraft,
    promptDone,
    questions
  };
}

function isAutopilotArtifactChange(filename = "") {
  return AUTOPILOT_FILE_NAMES.has(path.basename(String(filename || "")));
}

function closeWatcher(watcher = null) {
  try {
    watcher?.close?.();
  } catch {
    // Closing a filesystem watcher is best-effort during stream shutdown.
  }
}

async function readEditableArtifacts(runtime, session = {}, fields = []) {
  const artifactEntries = await Promise.all(artifactNamesForFields(fields).map(async (artifactName) => {
    return [artifactName, await runtime.store.readArtifact(session.sessionId, artifactName)];
  }));
  return Object.fromEntries(artifactEntries);
}

function unknownArtifactName(artifacts = {}, fieldsByName = new Map()) {
  return Object.keys(artifacts).find((artifactName) => !fieldsByName.has(artifactName)) || "";
}

function missingRequiredField(artifacts = {}, fields = []) {
  return fields.find((field) => {
    return field.required && !String(artifacts[field.name] || "").trim();
  }) || null;
}

function createService({ projectService } = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  return Object.freeze({
    async readArtifacts(sessionId, input = {}) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const editor = editorActionState(session, input.actionId);
        if (!editor.ok) {
          return artifactErrorResponse(session, editor.code, editor.message);
        }
        return artifactsResponse(
          session,
          editor,
          await readEditableArtifacts(runtime, session, editor.fields)
        );
      });
    },

    async saveArtifacts(sessionId, input = {}) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const editor = editorActionState(session, input.actionId);
        if (!editor.ok) {
          return artifactErrorResponse(session, editor.code, editor.message);
        }

        const artifacts = normalizeArtifactInput(input);
        if (Object.keys(artifacts).length < 1) {
          return artifactErrorResponse(
            session,
            "ai_studio_artifacts_required",
            "At least one editable artifact is required."
          );
        }

        const fieldsByName = artifactFieldByName(editor.fields);
        const unknownArtifact = unknownArtifactName(artifacts, fieldsByName);
        if (unknownArtifact) {
          return artifactErrorResponse(
            session,
            "ai_studio_artifact_not_editable",
            `Artifact is not editable by ${editor.action.id}: ${unknownArtifact}`
          );
        }

        const missingField = missingRequiredField(artifacts, editor.fields);
        if (missingField) {
          return artifactErrorResponse(
            session,
            "ai_studio_artifact_required",
            missingField.requiredMessage || `Artifact text is required: ${missingField.name}`
          );
        }

        await Promise.all(Object.entries(artifacts).flatMap(([artifactName, artifactText]) => {
          const field = fieldsByName.get(artifactName);
          const writes = [
            runtime.store.writeArtifact(sessionId, artifactName, `${artifactText}\n`)
          ];
          if (field?.metadataName === ISSUE_WORD_ARTIFACT) {
            writes.push(runtime.store.writeIssueWordMetadata(sessionId, artifactText));
          } else if (field?.metadataName) {
            writes.push(runtime.store.writeMetadataValue(sessionId, field.metadataName, artifactText));
          }
          return writes;
        }));

        const updatedSession = await runtime.getSession(sessionId);
        const updatedEditor = editorActionState(updatedSession, input.actionId);
        return artifactsResponse(
          updatedSession,
          updatedEditor.ok ? updatedEditor : editor,
          await readEditableArtifacts(runtime, updatedSession, editor.fields)
        );
      });
    },

    async saveIssueArtifacts(sessionId, input = {}) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const writeState = issueArtifactsWriteState(session);
        if (!writeState.ok) {
          return artifactErrorResponse(session, writeState.code, writeState.message);
        }

        const artifacts = issueArtifactInput(input);
        if (!artifacts.title) {
          return artifactErrorResponse(
            session,
            "ai_studio_issue_title_required",
            "Issue title is required."
          );
        }
        if (!artifacts.body) {
          return artifactErrorResponse(
            session,
            "ai_studio_issue_body_required",
            "Issue body is required."
          );
        }
        if (!artifacts.word) {
          return artifactErrorResponse(
            session,
            "ai_studio_issue_word_required",
            "Session label is required."
          );
        }

        await Promise.all([
          runtime.store.writeArtifact(sessionId, ISSUE_TITLE_ARTIFACT, artifactText(artifacts.title)),
          runtime.store.writeArtifact(sessionId, ISSUE_BODY_ARTIFACT, artifactText(artifacts.body)),
          runtime.store.writeArtifact(sessionId, ISSUE_WORD_ARTIFACT, artifactText(artifacts.word)),
          runtime.store.writeMetadataValue(sessionId, ISSUE_TITLE_ARTIFACT, artifacts.title),
          runtime.store.writeIssueWordMetadata(sessionId, artifacts.word)
        ]);

        const updatedSession = await runtime.getSession(sessionId);
        return issueArtifactsResponse(updatedSession, {
          [ISSUE_BODY_ARTIFACT]: artifactText(artifacts.body),
          [ISSUE_TITLE_ARTIFACT]: artifactText(artifacts.title),
          [ISSUE_WORD_ARTIFACT]: artifactText(artifacts.word)
        });
      });
    },

    async clearIssueArtifacts(sessionId) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const writeState = issueArtifactsWriteState(session);
        if (!writeState.ok) {
          return artifactErrorResponse(session, writeState.code, writeState.message);
        }

        await Promise.all([
          runtime.store.deleteArtifacts(sessionId, [
            ISSUE_BODY_ARTIFACT,
            ISSUE_TITLE_ARTIFACT,
            ISSUE_WORD_ARTIFACT
          ]),
          runtime.store.deleteMetadataValues(sessionId, [
            ISSUE_TITLE_ARTIFACT,
            ISSUE_WORD_ARTIFACT
          ])
        ]);

        return issueArtifactsResponse(await runtime.getSession(sessionId), {
          [ISSUE_BODY_ARTIFACT]: "",
          [ISSUE_TITLE_ARTIFACT]: "",
          [ISSUE_WORD_ARTIFACT]: ""
        });
      });
    },

    async readAutopilotArtifacts(sessionId) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        return {
          ...session,
          ...(await readAutopilotFiles(runtime, sessionId)),
          ok: true
        };
      });
    },

    async clearAutopilotArtifacts(sessionId) {
      return artifactResult(async () => {
        const runtime = await projectService.createRuntime();
        await runtime.store.deleteArtifacts(sessionId, AUTOPILOT_FILE_ARTIFACTS);
        const session = await runtime.getSession(sessionId);
        return {
          ...session,
          issueDraft: null,
          ok: true,
          promptDone: null,
          questions: null
        };
      });
    },

    async streamAutopilotArtifacts(sessionId, {
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
          emit("autopilot-artifacts.updated", {
            artifactReadiness: currentSession.artifactReadiness,
            sessionId,
            ...(await readAutopilotFiles(runtime, sessionId)),
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
        if (!isAutopilotArtifactChange(filename)) {
          return;
        }
        void emitCurrentArtifacts().catch((error) => {
          emit("autopilot-artifacts.error", {
            error: String(error?.message || error || "Autopilot artifacts could not be read."),
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
