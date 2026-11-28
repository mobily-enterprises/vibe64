// JSKIT's shell offers Reload when the server serves another client build than the page runs (shell-web's client
// update, reported as "Vibe64 was updated. Reload to get the latest version."). A page that has the editor's top banner
// (Vibe64PlannedRestartBanner, on every StudioAppShellLayout page) shows that offer in the banner instead, so an update
// is one notice: after a planned restart its green message carries the Reload, and without one the banner says JSKIT's
// sentence. A page without the banner keeps JSKIT's own banner for it.
import { shallowRef } from "vue";

const CLIENT_UPDATE_SOURCE = "shell-web.client-update";
const CLIENT_UPDATE_PRESENTER_ID = "vibe64.client-update";

/**
 * @typedef {{ id: string, message: string, action: { label: string, handler: Function } | null }} ClientUpdateOffer
 */

// readable-check: allow module-state - shared resource: the page has one error runtime and one client update offer, which src/error.js routes here and the top banner shows
const shared = {
  /** @type {import("vue").ShallowRef<ClientUpdateOffer | null>} */
  offer: shallowRef(null),
  // How many top banners are on the page to show the offer.
  hosts: 0,
  /** @type {any} the page's error runtime, once src/error.js installed the offer */
  runtime: null,
  /**
   * The offer JSKIT's own banner shows, from before a top banner was on the page.
   * @type {ClientUpdateOffer | null}
   */
  shownByShell: null
};

function offerFrom(id, payload) {
  return Object.freeze({
    id,
    message: String(payload.message || ""),
    action: payload.action || null
  });
}

/** The presenter the policy hands the offer to while a top banner is on the page; its id is the offer's. */
function createClientUpdatePresenter() {
  let shown = 0;
  function supports() {
    return true;
  }
  function present(payload) {
    shown += 1;
    const id = `${CLIENT_UPDATE_PRESENTER_ID}-${shown}`;
    shared.offer.value = offerFrom(id, payload);
    return id;
  }
  // JSKIT withdraws the offer by its id when the server serves the page's own build again; no id clears it, as the
  // shell's own presenters clear their channel.
  function dismiss(presentationId = "") {
    const offer = shared.offer.value;
    if (!offer || (presentationId && presentationId !== offer.id)) return 0;
    shared.offer.value = null;
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
 * The app's policy, with the client update offer sent to the top banner while one is on the page.
 * @param {(event: any, context: any) => any} policy
 */
function routeClientUpdateOffer(policy) {
  return function vibe64ErrorPolicy(event, context) {
    const decision = policy(event, context);
    return event.source === CLIENT_UPDATE_SOURCE && shared.hosts > 0
      ? { ...decision, presenterId: CLIENT_UPDATE_PRESENTER_ID }
      : decision;
  };
}

/**
 * Remembers the offer JSKIT's own banner shows (before a top banner was on the page), so the first banner can take it
 * over.
 * @param {import("@jskit-ai/shell-web/client/types").ShellErrorRuntime} runtime
 * @returns {() => void} the unsubscribe
 */
function watchClientUpdateOffer(runtime) {
  shared.runtime = runtime;
  return runtime.subscribe((notice = {}) => {
    const result = notice.result || {};
    if (notice.type !== "reported" || result.event?.source !== CLIENT_UPDATE_SOURCE) return;
    shared.shownByShell = result.decision?.presenterId === CLIENT_UPDATE_PRESENTER_ID
      ? null
      : offerFrom(String(result.presentationId || ""), result.decision || {});
  });
}

/**
 * A top banner on the page shows the offer from now on; an offer JSKIT's banner still shows moves into it, keeping its
 * id, so JSKIT's withdrawal reaches it. Returns the function that ends it.
 */
function hostClientUpdateOffer() {
  shared.hosts += 1;
  const taken = shared.shownByShell;
  shared.shownByShell = null;
  // The shell's banner gives back 0 for an offer the person already closed there: closed stays closed.
  if (taken?.id && shared.runtime && shared.runtime.dismiss(taken.id) > 0) shared.offer.value = taken;
  return () => {
    shared.hosts -= 1;
  };
}

/** The person closed the offer: it stays closed until a newer build, as JSKIT's own banner keeps it. */
function dismissClientUpdateOffer() {
  shared.offer.value = null;
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
  clientUpdateOffer,
  createClientUpdatePresenter,
  dismissClientUpdateOffer,
  hostClientUpdateOffer,
  reloadForClientUpdate,
  routeClientUpdateOffer,
  watchClientUpdateOffer
};
