// JSKIT's shell offers Reload when the server serves another client build than the page runs (shell-web's client
// update, reported as "Vibe64 was updated. Reload to get the latest version."). The editor holds that offer here, under
// the id JSKIT withdraws it by. While the editor's top banner (Vibe64PlannedRestartBanner, on every
// StudioAppShellLayout page) is on the page it shows the offer, so an update is one notice: after a planned restart its
// green message carries the Reload, and without one the banner says JSKIT's sentence. While no top banner is on the
// page (Learning holding the route, or a host's own page) the shell's own banner shows it, and the next top banner takes
// it back.
import { shallowRef } from "vue";

const CLIENT_UPDATE_SOURCE = "shell-web.client-update";
const CLIENT_UPDATE_PRESENTER_ID = "vibe64.client-update";
// The same offer, reported again for the shell's own banner while no top banner is on the page.
const SHELL_COPY_SOURCE = "vibe64.client-update.shell";

/**
 * @typedef {{ id: string, message: string, action: { label: string, handler: Function } | null, event: object | null }}
 *   ClientUpdateOffer
 */

// readable-check: allow module-state - shared resource: the page has one error runtime and one client update offer, which src/error.js routes here and the top banner or the shell's banner shows
const shared = {
  /**
   * JSKIT's offer, from its report until JSKIT withdraws it or the person closes it.
   * @type {ClientUpdateOffer | null}
   */
  held: null,
  /**
   * The offer as the top banner shows it: the held one while a top banner is on the page.
   * @type {import("vue").ShallowRef<ClientUpdateOffer | null>}
   */
  offer: shallowRef(null),
  // How many top banners are on the page to show the offer.
  hosts: 0,
  /** @type {any} the page's error runtime, once src/error.js attached it */
  runtime: null,
  /**
   * The shell's banner's presentation of the offer, while it shows it.
   * @type {{ id: string, presenterId: string } | null}
   */
  shellCopy: null
};

function offerFrom(id, payload) {
  return Object.freeze({
    id,
    message: String(payload.message || ""),
    action: payload.action || null,
    event: payload.event || null
  });
}

/** Takes the offer out of the shell's banner, if it shows it there. Returns what the shell's banner removed (0 or 1). */
function hideShellCopy() {
  const copy = shared.shellCopy;
  shared.shellCopy = null;
  if (!copy || !shared.runtime) return 0;
  return shared.runtime.dismiss(copy.id, { presenterId: copy.presenterId });
}

/** Without a top banner on the page once it has settled, the shell's banner shows the held offer. */
function showInShellWithoutTopBanner() {
  const held = shared.held;
  if (!held || !held.event || shared.hosts > 0 || shared.shellCopy || !shared.runtime) return;
  const result = shared.runtime.report({ ...held.event, source: SHELL_COPY_SOURCE });
  const id = String(result.presentationId || "");
  if (id) shared.shellCopy = { id, presenterId: String(result.decision.presenterId || "") };
}

/**
 * The held offer goes where the page can show it: the top banner while one is there, otherwise the shell's banner once
 * the page has settled, so one page's top banner giving way to the next page's never shows it in the shell's.
 */
function showHeldOffer() {
  shared.offer.value = shared.hosts > 0 ? shared.held : null;
  if (shared.hosts === 0 && shared.held) queueMicrotask(showInShellWithoutTopBanner);
}

/** The offer is gone: withdrawn by JSKIT or closed by the person. */
function closeOffer() {
  shared.held = null;
  shared.offer.value = null;
  hideShellCopy();
}

/** The presenter the policy hands the offer to; its id is the offer's, which JSKIT withdraws it by. */
function createClientUpdatePresenter() {
  let shown = 0;
  function supports() {
    return true;
  }
  function present(payload) {
    shown += 1;
    const id = `${CLIENT_UPDATE_PRESENTER_ID}-${shown}`;
    hideShellCopy();
    shared.held = offerFrom(id, payload);
    showHeldOffer();
    return id;
  }
  // JSKIT withdraws the offer by its id when the server serves the page's own build again; no id clears it, as the
  // shell's own presenters clear their channel.
  function dismiss(presentationId = "") {
    const held = shared.held;
    if (!held || (presentationId && presentationId !== held.id)) return 0;
    closeOffer();
    return 1;
  }
  return Object.freeze({
    id: CLIENT_UPDATE_PRESENTER_ID,
    supports,
    present,
    dismiss
  });
}

/**
 * The app's policy, with the client update offer sent to the editor's presenter.
 * @param {(event: any, context: any) => any} policy
 */
function routeClientUpdateOffer(policy) {
  return function vibe64ErrorPolicy(event, context) {
    const decision = policy(event, context);
    return event.source === CLIENT_UPDATE_SOURCE ? { ...decision, presenterId: CLIENT_UPDATE_PRESENTER_ID } : decision;
  };
}

/**
 * The error runtime the shell's banner is reached through.
 * @param {import("@jskit-ai/shell-web/client/types").ShellErrorRuntime} runtime
 */
function attachClientUpdateOffer(runtime) {
  shared.runtime = runtime;
}

/**
 * A top banner on the page shows the offer from now on, taking it from the shell's banner if that shows it. Returns
 * the function that ends it.
 */
function hostClientUpdateOffer() {
  shared.hosts += 1;
  // The shell's banner gives back 0 for an offer the person already closed there: closed stays closed.
  if (shared.shellCopy && hideShellCopy() === 0) shared.held = null;
  showHeldOffer();
  return () => {
    shared.hosts -= 1;
    showHeldOffer();
  };
}

/** The person closed the offer: it stays closed until a newer build, as JSKIT's own banner keeps it. */
function dismissClientUpdateOffer() {
  closeOffer();
}

/** The offer's Reload: JSKIT's, which checks that the server answers, then reloads the same address. */
async function reloadForClientUpdate() {
  const action = shared.offer.value?.action;
  if (!action) return;
  try {
    await action.handler();
  } catch (error) {
    if (!shared.runtime) throw error;
    shared.runtime.report({
      source: "vibe64.client-update.reload",
      message: String(error?.message || "Vibe64 could not reload. Reload the page."),
      cause: error,
      intent: "action-feedback",
      severity: "error"
    });
  }
}

const clientUpdateOffer = shared.offer;

export {
  CLIENT_UPDATE_PRESENTER_ID,
  CLIENT_UPDATE_SOURCE,
  attachClientUpdateOffer,
  clientUpdateOffer,
  createClientUpdatePresenter,
  dismissClientUpdateOffer,
  hostClientUpdateOffer,
  reloadForClientUpdate,
  routeClientUpdateOffer
};
