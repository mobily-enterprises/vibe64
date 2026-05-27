import {
  stableLocalStorageKeyPart
} from "@/lib/browserLocalStorage.js";

function vibe64ShellPanelTargetId(sessionId = "") {
  return `vibe64-shell-panel-${stableLocalStorageKeyPart(sessionId)}`;
}

function vibe64ShellPanelTargetSelector(sessionId = "") {
  return `#${vibe64ShellPanelTargetId(sessionId)}`;
}

export {
  vibe64ShellPanelTargetId,
  vibe64ShellPanelTargetSelector
};
