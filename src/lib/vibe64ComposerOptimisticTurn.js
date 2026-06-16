function createRemoteComposerOptimisticTurn({
  control = {},
  fields = {},
  id = "",
  payload = {},
  text = ""
} = {}) {
  const normalizedText = String(text || payload?.text || "").trim();
  if (!normalizedText) {
    return null;
  }
  const createdAt = String(payload?.updatedAt || "").trim() || new Date().toISOString();
  const parsedCreatedAtMs = Date.parse(createdAt);
  const createdAtMs = Number.isNaN(parsedCreatedAtMs) ? Date.now() : parsedCreatedAtMs;
  const submissionFields = fields && typeof fields === "object" && !Array.isArray(fields)
    ? {
        ...fields
      }
    : {};
  return {
    control,
    createdAt,
    createdAtMs,
    error: "",
    id: String(id || "").trim() || `remote-composer-${createdAtMs}`,
    options: {
      fields: submissionFields
    },
    remote: true,
    status: "pending",
    text: normalizedText,
    values: submissionFields
  };
}

export {
  createRemoteComposerOptimisticTurn
};
