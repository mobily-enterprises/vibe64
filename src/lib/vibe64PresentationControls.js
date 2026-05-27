import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS
} from "@local/vibe64-core/shared";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function controlPresentation(control = {}) {
  return objectValue(control.control);
}

function controlClientAction(control = {}) {
  return String(controlPresentation(control).action || "").trim();
}

function controlStateFlags(control = {}, field = "") {
  const values = controlPresentation(control)[field];
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function controlIconToken(control = {}) {
  return String(controlPresentation(control).icon || "").trim();
}

function controlHasClientAction(control = {}) {
  return Boolean(controlClientAction(control));
}

function controlUsesClientAction(control = {}, action = "") {
  return controlClientAction(control) === String(action || "").trim();
}

function controlStateFlagActive(flag = "", state = {}) {
  switch (String(flag || "").trim()) {
    case VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_DISABLED:
      return Boolean(state.review?.diffDisabled);
    case VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_LOADING:
      return Boolean(state.diff?.loading);
    default:
      return false;
  }
}

function controlStateActive(control = {}, field = "", state = {}) {
  return controlStateFlags(control, field).some((flag) => controlStateFlagActive(flag, state));
}

export {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS,
  controlClientAction,
  controlHasClientAction,
  controlIconToken,
  controlStateActive,
  controlStateFlagActive,
  controlStateFlags,
  controlUsesClientAction
};
