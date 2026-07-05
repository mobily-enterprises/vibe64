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
  codexSteerAvailable = false,
  selectedScreenControlVisible = false
} = {}) {
  return Boolean(codexSteerAvailable && !selectedScreenControlVisible);
}

function passiveComposerSteeringMode({
  codexInteractionLocked = false,
  codexSteerAvailable = false,
  selectedScreenControlVisible = false,
  steeringDraftActive = false
} = {}) {
  return Boolean(
    !selectedScreenControlVisible &&
    (codexInteractionLocked || codexSteerAvailable || steeringDraftActive)
  );
}

function passiveComposerShouldShow({
  handoffPending = false,
  selectedScreenControlVisible = false,
  stepInputFormVisible = false
} = {}) {
  void handoffPending;
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
