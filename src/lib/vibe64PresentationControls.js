import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS
} from "@local/vibe64-core/shared";
import {
  mdiArchiveOutline,
  mdiBugCheckOutline,
  mdiCallMerge,
  mdiCodeBraces,
  mdiFileCompare,
  mdiFileDocumentOutline,
  mdiGithub,
  mdiSourceCommit,
  mdiSourcePull,
  mdiSync,
  mdiWebCheck
} from "@mdi/js";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function controlPresentation(control = {}) {
  return objectValue(objectValue(control).control);
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

function presentationIconForToken(token = "", fallbackIcon = mdiFileDocumentOutline) {
  switch (String(token || "").trim()) {
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.ARCHIVE:
      return mdiArchiveOutline;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.BUG_CHECK:
      return mdiBugCheckOutline;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.CODE_REVIEW:
      return mdiCodeBraces;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF:
      return mdiFileCompare;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.GITHUB:
      return mdiGithub;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.MERGE:
      return mdiCallMerge;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.MONITOR_CHECK:
      return mdiWebCheck;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.PULL_REQUEST:
      return mdiSourcePull;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.SOURCE_COMMIT:
      return mdiSourceCommit;
    case VIBE64_CLIENT_CONTROL_ICON_TOKENS.SYNC:
      return mdiSync;
    default:
      return fallbackIcon;
  }
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
  controlUsesClientAction,
  presentationIconForToken
};
