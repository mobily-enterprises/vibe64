import { learningPanelMatches } from "../shared/learningFocus.js";

// A guided "show me" names its own place; its route, or its pane and database
// view, must be the ones the browser settled on.
function guidedPlaceMatches(command, focus) {
  if (!command.guide?.navigate) return true;
  if (command.route) return focus?.route === command.route;
  if (!command.pane) return true;
  return focus?.pane === command.pane &&
    (!command.databaseView || focus.databaseScreen === "workspace" && focus.databaseView === command.databaseView);
}
// One pending browser navigation per connection: begin waits for the browser's
// acknowledgement (or times out), and acknowledge accepts only a receipt that
// matches the command's Learning state, guided place and guide highlight.
function createColleagueNavigationCoordination({ changed }) {
  function begin(connection, command) {
    connection.navigation = command;
    changed();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        command.status = "failed";
        connection.acknowledge = null;
        changed();
        resolve({ ok: false, error: "The browser did not acknowledge navigation. Keep the initiating conversation open and check its current status before trying again." });
      }, 15000);
      connection.acknowledge = (result) => {
        clearTimeout(timer);
        command.status = result.ok ? "completed" : "failed";
        connection.acknowledge = null;
        if (result.focus) connection.focus = result.focus;
        changed();
        resolve(result);
      };
    });
  }
  function acknowledge(connection, input) {
    if (!connection || connection.navigation?.id !== input.commandId || !connection.acknowledge) {
      return { ok: false, error: "This navigation command is no longer pending." };
    }
    if (input.ok && !learningPanelMatches(connection.navigation, input.focus)) {
      return { ok: false, error: "The browser has not confirmed this exact Learning state, lesson and step." };
    }
    if (input.ok && !guidedPlaceMatches(connection.navigation, input.focus)) {
      return { ok: false, error: "The browser has not confirmed the guided place it opened." };
    }
    // A guide receipt reports only what the overlay actually drew.
    const guide = connection.navigation.guide;
    const guideReceipt = guide && input.guide ? { shown: input.guide.shown === true,
      ...(input.guide.reason ? { reason: input.guide.reason } : {}), ...(input.guide.step ? { step: input.guide.step } : {}) } : null;
    if (input.ok && guide && (typeof input.guide?.shown !== "boolean" || guideReceipt.shown && (!guide.highlight || !guideReceipt.step) ||
        !guideReceipt.shown && !guideReceipt.reason)) {
      return { ok: false, error: "The browser has not confirmed whether this guide highlight was drawn." };
    }
    connection.acknowledge({ ok: input.ok, ...(input.error ? { error: input.error } : {}), ...(input.focus ? { focus: input.focus } : {}),
      ...(guideReceipt ? { guide: guideReceipt } : {}) });
    return { ok: true };
  }
  return { begin, acknowledge };
}

export { createColleagueNavigationCoordination };
