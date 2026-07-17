import {
  vibe64Error
} from "./core.js";
import {
  PROJECT_APPLICATION_MODE_EXISTING,
  PROJECT_APPLICATION_MODE_NEW,
  normalizeProjectApplicationMode
} from "../shared/projectApplication.js";

const PROJECT_APPLICATION_MODE_ONE_OFF_FLAG = "application-mode";

function requireProjectApplicationMode(value = "") {
  const mode = normalizeProjectApplicationMode(value);
  if (!mode) {
    throw vibe64Error(
      "Choose whether this repository needs a new application or already contains one.",
      "vibe64_project_application_mode_invalid"
    );
  }
  return mode;
}

export {
  PROJECT_APPLICATION_MODE_EXISTING,
  PROJECT_APPLICATION_MODE_NEW,
  PROJECT_APPLICATION_MODE_ONE_OFF_FLAG,
  normalizeProjectApplicationMode,
  requireProjectApplicationMode
};
