const PASSIVE_COMPOSER_FIELD = "message";

function passiveComposerSteerPayload(message = "") {
  const text = String(message || "").trim();
  if (!text) {
    return null;
  }
  return {
    displayFields: {
      conversationRequest: text
    },
    fields: {
      conversationRequest: text
    },
    message: text
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
  composerInputLocked = false,
  selectedScreenControlVisible = false,
  steeringActive = false,
  stepInputFormVisible = false
} = {}) {
  return Boolean(
    !stepInputFormVisible &&
    !selectedScreenControlVisible &&
    (!composerInputLocked || steeringActive)
  );
}

export {
  PASSIVE_COMPOSER_FIELD,
  passiveComposerCanSteer,
  passiveComposerSteeringMode,
  passiveComposerShouldShow,
  passiveComposerSteerPayload
};
