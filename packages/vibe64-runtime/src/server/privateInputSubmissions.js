import path from "node:path";
import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  workflowInputFieldIsPrivate
} from "./workflowInputFields.js";

const PRIVATE_INPUT_REFERENCE_KIND = "vibe64_private_input_file";
const PRIVATE_INPUT_REFERENCE_FIELDS = Object.freeze({
  FILE: "privateInputFile",
  FIELDS: "privateInputFields",
  INSTRUCTIONS: "privateInputInstructions",
  REFERENCE: "privateInput"
});

function inputObject(value = {}) {
  return isPlainObject(value) ? value : {};
}

function privateInputOwnerId(owner = {}) {
  return normalizeText(owner.id || owner.actionId || owner.intentId || owner.stepId || "private_input");
}

function privateInputOwner(owner = {}) {
  return {
    id: privateInputOwnerId(owner),
    kind: normalizeText(owner.kind || "workflow_input"),
    ...(normalizeText(owner.actionId) ? { actionId: normalizeText(owner.actionId) } : {}),
    ...(normalizeText(owner.intentId) ? { intentId: normalizeText(owner.intentId) } : {}),
    ...(normalizeText(owner.stepId) ? { stepId: normalizeText(owner.stepId) } : {}),
    ...(normalizeText(owner.stepStatus) ? { stepStatus: normalizeText(owner.stepStatus) } : {})
  };
}

function safeRelativePathFromTarget(targetRoot = "", filePath = "") {
  const normalizedTargetRoot = normalizeText(targetRoot);
  const normalizedFilePath = normalizeText(filePath);
  if (!normalizedTargetRoot || !normalizedFilePath) {
    return "";
  }
  const relativePath = path.relative(normalizedTargetRoot, normalizedFilePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return relativePath.split(path.sep).join("/");
}

function workspacePrivateInputPath(session = {}, filePath = "") {
  const relativePath = safeRelativePathFromTarget(session.targetRoot, filePath);
  return relativePath ? path.posix.join("/workspace", relativePath) : "";
}

function privateInputFieldSummary(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => {
      const name = normalizeText(field.name);
      if (!name) {
        return null;
      }
      return {
        label: normalizeText(field.label || name),
        name
      };
    })
    .filter(Boolean);
}

function privateInputFieldSummaryText(fields = []) {
  return privateInputFieldSummary(fields)
    .map((field) => field.label === field.name ? field.name : `${field.label} (${field.name})`)
    .join(", ");
}

function privateInputInstructions(reference = {}) {
  const preferredPath = normalizeText(reference.workspacePath || reference.path);
  const fields = privateInputFieldSummaryText(reference.fields);
  return [
    fields ? `Private answers for ${fields} were submitted outside this prompt.` : "Private answers were submitted outside this prompt.",
    preferredPath ? `Read them from ${preferredPath}.` : "",
    reference.path && reference.workspacePath && reference.path !== reference.workspacePath
      ? `Host session path: ${reference.path}.`
      : ""
  ].filter(Boolean).join(" ");
}

function privateInputPromptFields(reference = {}) {
  const instructions = privateInputInstructions(reference);
  const preferredPath = normalizeText(reference.workspacePath || reference.path);
  if (!instructions || !preferredPath) {
    return {};
  }
  return {
    [PRIVATE_INPUT_REFERENCE_FIELDS.FILE]: preferredPath,
    [PRIVATE_INPUT_REFERENCE_FIELDS.FIELDS]: privateInputFieldSummaryText(reference.fields),
    [PRIVATE_INPUT_REFERENCE_FIELDS.INSTRUCTIONS]: instructions,
    [PRIVATE_INPUT_REFERENCE_FIELDS.REFERENCE]: {
      fields: privateInputFieldSummary(reference.fields),
      fileName: normalizeText(reference.fileName),
      kind: PRIVATE_INPUT_REFERENCE_KIND,
      path: normalizeText(reference.path),
      relativePath: normalizeText(reference.relativePath),
      ...(reference.workspacePath ? { workspacePath: normalizeText(reference.workspacePath) } : {})
    }
  };
}

function splitPrivateInputValues({
  fields = {},
  inputFields = []
} = {}) {
  const sourceFields = inputObject(fields);
  const privateFields = (Array.isArray(inputFields) ? inputFields : [])
    .filter((field) => workflowInputFieldIsPrivate(field))
    .filter((field) => Object.hasOwn(sourceFields, normalizeText(field.name)));
  if (privateFields.length < 1) {
    return {
      privateFields: [],
      privateValues: {},
      publicFields: {
        ...sourceFields
      }
    };
  }
  const privateNames = new Set(privateFields.map((field) => normalizeText(field.name)));
  return {
    privateFields,
    privateValues: Object.fromEntries(privateFields.map((field) => {
      const name = normalizeText(field.name);
      return [name, String(sourceFields[name] ?? "")];
    })),
    publicFields: Object.fromEntries(Object.entries(sourceFields)
      .filter(([name]) => !privateNames.has(normalizeText(name))))
  };
}

async function preparePrivateInputSubmission({
  fields = {},
  inputFields = [],
  owner = {},
  session = {},
  store = null
} = {}) {
  const split = splitPrivateInputValues({
    fields,
    inputFields
  });
  if (split.privateFields.length < 1) {
    return {
      fields: split.publicFields,
      privateInput: null
    };
  }
  if (typeof store?.writePrivateInput !== "function") {
    throw vibe64Error(
      "Private workflow input cannot be accepted because the session store does not support private input files.",
      "vibe64_private_input_store_missing"
    );
  }
  const normalizedOwner = privateInputOwner(owner);
  const stored = await store.writePrivateInput(session.sessionId, normalizedOwner.id, {
    fields: privateInputFieldSummary(split.privateFields),
    owner: normalizedOwner,
    stepId: normalizeText(owner.stepId || session.currentStep),
    stepStatus: normalizeText(owner.stepStatus || session.stepMachine?.status),
    values: split.privateValues
  });
  const reference = {
    ...stored,
    fields: privateInputFieldSummary(split.privateFields),
    workspacePath: workspacePrivateInputPath(session, stored.path)
  };
  return {
    fields: {
      ...split.publicFields,
      ...privateInputPromptFields(reference)
    },
    privateInput: reference
  };
}

function firstConversationTextField(fields = {}) {
  const source = inputObject(fields);
  return normalizeText(source.conversationRequest || source.feedback || source.message || source.response);
}

function inputWithPrivateReferenceConversationText(fields = {}) {
  const source = inputObject(fields);
  const conversationText = firstConversationTextField(source);
  const privateInstructions = normalizeText(source[PRIVATE_INPUT_REFERENCE_FIELDS.INSTRUCTIONS]);
  if (!privateInstructions) {
    return source;
  }
  return {
    ...source,
    conversationRequest: [
      conversationText,
      privateInstructions
    ].filter(Boolean).join("\n\n")
  };
}

export {
  PRIVATE_INPUT_REFERENCE_FIELDS,
  PRIVATE_INPUT_REFERENCE_KIND,
  inputWithPrivateReferenceConversationText,
  preparePrivateInputSubmission,
  privateInputInstructions,
  privateInputPromptFields,
  splitPrivateInputValues
};
