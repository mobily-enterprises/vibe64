function promptTextHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildIssueSessionCodexPromptSignature({
  currentReviewPass = "",
  prompt = "",
  sessionId = ""
} = {}) {
  const promptText = String(prompt || "");
  if (!sessionId || !promptText) {
    return "";
  }
  return [
    sessionId,
    currentReviewPass || "",
    promptTextHash(promptText),
    promptText.length
  ].join(":");
}

export {
  buildIssueSessionCodexPromptSignature
};
