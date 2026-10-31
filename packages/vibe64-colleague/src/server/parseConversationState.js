// A saved Colleague conversation state as an object, or an error that never
// repeats its private contents.
function parseConversationState(source) {
  try {
    const value = JSON.parse(source);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Never report private contents. */ }
  throw new Error("Colleague conversation state is invalid. Inspect it before upgrading.");
}

export { parseConversationState };
