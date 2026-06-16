const VIBE64_COMPOSER_CHANGED_EVENT = "vibe64.composer.changed";
const VIBE64_COMPOSER_EVENT_ENTITY = "composer";
const VIBE64_COMPOSER_EVENT_SOURCE = "vibe64";
const VIBE64_COMPOSER_REALTIME_AUDIENCE = "all_clients";

function normalizeComposerValue(value = "") {
  return String(value || "").trim();
}

function normalizeComposerFields(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [
      normalizeComposerValue(key),
      String(entry ?? "")
    ]).filter(([key]) => Boolean(key))
  );
}

function composerDraftFromServiceResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  const draft = source.draft && typeof source.draft === "object" && !Array.isArray(source.draft)
    ? source.draft
    : null;
  return draft;
}

function composerRealtimePayload({ result = {} } = {}) {
  const draft = composerDraftFromServiceResult(result);
  if (!draft) {
    return {};
  }
  return {
    controlId: normalizeComposerValue(draft.controlId),
    fieldName: normalizeComposerValue(draft.fieldName),
    fields: normalizeComposerFields(draft.fields),
    originId: normalizeComposerValue(draft.originId),
    projectSlug: normalizeComposerValue(draft.projectSlug),
    sessionId: normalizeComposerValue(draft.sessionId),
    updatedAt: normalizeComposerValue(draft.updatedAt)
  };
}

function composerEntityIdFromServiceEvent({ result = {} } = {}) {
  const draft = composerDraftFromServiceResult(result);
  const sessionId = normalizeComposerValue(draft?.sessionId);
  const controlId = normalizeComposerValue(draft?.controlId);
  return sessionId && controlId ? `${sessionId}:${controlId}` : null;
}

function vibe64ComposerChangedServiceEvent() {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_COMPOSER_EVENT_SOURCE,
    entity: VIBE64_COMPOSER_EVENT_ENTITY,
    operation: "updated",
    entityId: composerEntityIdFromServiceEvent,
    realtime: Object.freeze({
      audience: VIBE64_COMPOSER_REALTIME_AUDIENCE,
      event: VIBE64_COMPOSER_CHANGED_EVENT,
      payload: composerRealtimePayload
    })
  });
}

export {
  VIBE64_COMPOSER_CHANGED_EVENT,
  composerRealtimePayload,
  normalizeComposerFields,
  vibe64ComposerChangedServiceEvent
};
