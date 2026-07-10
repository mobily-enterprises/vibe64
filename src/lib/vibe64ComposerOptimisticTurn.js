function turnMatchesOptimisticComposerTurn(turn = {}, optimistic = {}) {
  const text = String(turn?.user?.text || "").trim();
  if (!text || text !== optimistic.text) {
    return false;
  }
  const userAtMs = Date.parse(String(turn?.user?.at || ""));
  return Number.isFinite(userAtMs) && userAtMs >= optimistic.createdAtMs - 5000;
}

function createRemoteComposerOptimisticTurn({
  control = {},
  fields = {},
  id = "",
  payload = {},
  text = ""
} = {}) {
  const normalizedText = String(text || payload?.text || "").trim();
  const submissionId = String(id || "").trim();
  if (!normalizedText || !submissionId) {
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
    id: submissionId,
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
  createRemoteComposerOptimisticTurn,
  turnMatchesOptimisticComposerTurn
};
