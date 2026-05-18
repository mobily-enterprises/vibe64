import path from "node:path";
import {
  aiStudioResult,
  normalizePlainObject
} from "../../../../server/lib/aiStudio/serverResponses.js";
import {
  deepFreeze
} from "../../../../server/lib/aiStudio/deepFreeze.js";

const EMPTY_EDITOR_ACTION = deepFreeze({
  action: null,
  code: "ai_studio_editor_action_required",
  fields: [],
  message: "Editor action id is required.",
  ok: false
});

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
          if (field?.metadataName) {
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
    }
  });
}

export { createService };
