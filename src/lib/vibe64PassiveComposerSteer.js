import {
  appendPromptAttachmentFileNames,
  appendPromptAttachmentReferences
} from "@/lib/vibe64PromptAttachments.js";

const PASSIVE_COMPOSER_FIELD = "conversationRequest";

function passiveComposerAttachmentField(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options)
    ? options.attachmentFields
    : {};
  const attachmentFields = source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
  const attachments = attachmentFields[PASSIVE_COMPOSER_FIELD];
  return Array.isArray(attachments) ? attachments : [];
}

function passiveComposerSteerPayload(message = "", options = {}) {
  const text = String(message || "").trim();
  if (!text) {
    return null;
  }
  const attachments = passiveComposerAttachmentField(options);
  const fieldsText = attachments.length
    ? appendPromptAttachmentReferences(text, attachments)
    : text;
  const displayText = attachments.length
    ? appendPromptAttachmentFileNames(text, attachments)
    : text;
  return {
    displayFields: {
      conversationRequest: displayText
    },
    fields: {
      conversationRequest: fieldsText
    },
    message: fieldsText
  };
}

function passiveComposerCanSteer({
  agentHandoffPending = false,
  agentSteeringAvailable = false,
  selectedScreenControlVisible = false
} = {}) {
  return Boolean(
    (agentHandoffPending || agentSteeringAvailable) &&
    !selectedScreenControlVisible
  );
}

function passiveComposerSteeringMode({
  agentHandoffPending = false,
  agentInteractionLocked = false,
  agentSteeringAvailable = false,
  selectedScreenControlVisible = false,
  steeringDraftActive = false
} = {}) {
  return Boolean(
    !selectedScreenControlVisible &&
    (agentHandoffPending || agentInteractionLocked || agentSteeringAvailable || steeringDraftActive)
  );
}

function passiveComposerShouldShow({
  selectedScreenControlVisible = false,
  stepInputFormVisible = false
} = {}) {
  return Boolean(
    !stepInputFormVisible &&
    !selectedScreenControlVisible
  );
}

export {
  PASSIVE_COMPOSER_FIELD,
  passiveComposerAttachmentField,
  passiveComposerCanSteer,
  passiveComposerSteeringMode,
  passiveComposerShouldShow,
  passiveComposerSteerPayload
};
