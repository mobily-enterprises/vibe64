import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "./core.js";
import {
  PROJECT_APPLICATION_MODE_EXISTING,
  PROJECT_APPLICATION_MODE_NEW,
  normalizeProjectApplicationMode
} from "../shared/projectApplication.js";

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

function projectApplicationMetadataFromInput(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const value = normalizeText(source.applicationMode);
  return value
    ? { applicationMode: requireProjectApplicationMode(value) }
    : {};
}

function projectApplicationView(metadata = {}) {
  const source = isPlainObject(metadata) ? metadata : {};
  const applicationMode = normalizeProjectApplicationMode(source.applicationMode);
  return applicationMode ? { applicationMode } : {};
}

export {
  PROJECT_APPLICATION_MODE_EXISTING,
  PROJECT_APPLICATION_MODE_NEW,
  normalizeProjectApplicationMode,
  projectApplicationMetadataFromInput,
  projectApplicationView,
  requireProjectApplicationMode
};
