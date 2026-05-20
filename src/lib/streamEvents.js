function parseJsonStreamEvent(event) {
  try {
    return JSON.parse(event?.data || "{}");
  } catch {
    return {};
  }
}

export {
  parseJsonStreamEvent
};
