const PROJECT_APPLICATION_MODE_NEW = "new";
const PROJECT_APPLICATION_MODE_EXISTING = "existing";

function normalizeProjectApplicationMode(value = "") {
  const mode = String(value ?? "").trim().toLowerCase();
  return mode === PROJECT_APPLICATION_MODE_NEW || mode === PROJECT_APPLICATION_MODE_EXISTING
    ? mode
    : "";
}

export {
  PROJECT_APPLICATION_MODE_EXISTING,
  PROJECT_APPLICATION_MODE_NEW,
  normalizeProjectApplicationMode
};
