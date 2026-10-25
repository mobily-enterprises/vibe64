import { onBeforeMount, onBeforeUnmount, unref, watch } from "vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { usePageActivity } from "@/lib/vibe64PageActivity.js";

// The practice App's orientation protocol: the App announces itself with
// `orientation-available`, and Learning answers with `orientation-init`
// carrying one MessageChannel port.
const ORIENTATION_AVAILABLE_MESSAGE_TYPE = "orientation-available";
const ORIENTATION_INIT_MESSAGE_TYPE = "orientation-init";
const ORIENTATION_PROTOCOL_VERSION = 1;
const PACKET_FIELDS = Object.freeze(["type", "protocolVersion", "playerInstanceId", "instanceId"]);

function isOrientationAnnouncement(value) {
  return value?.type === ORIENTATION_AVAILABLE_MESSAGE_TYPE;
}

function orientationUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function exactFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === fields.slice().sort().join(",");
}

// Learner-origin App interaction capture for the Learning controller's
// step.observe. The orientation protocol runs over one MessageChannel bound to
// this exact Preview frame request, session, App run, App instance and a fresh
// player identity. A trusted press, its request and the displayed response are
// correlated while the frame stays visible; what the response must be belongs
// to the step's declared check, which verifies these identities against the
// App server.
//
// `preview()` returns the displayed Preview ({ frame, frameRequestId, loaded,
// displayed, projectSlug, sessionId, terminalSessionId }) or null when none is
// displayed; `frameVisible(frame)` says whether that frame is visible now. The
// Preview surface admits announcements (exact frame window and origin) and
// calls close() whenever it replaces or clears its frame.
function useVibe64LearningOrientation({ preview, frameVisible }) {
  const learning = useVibe64Learning();
  const reportActivity = usePageActivity();
  let orientation = null;

  function learningOwner() {
    const owner = unref(learning);
    return typeof owner?.beginExercise === "function" && typeof owner.finishExercise === "function" ? owner : null;
  }

  function frameCurrent(channel) {
    const current = preview();
    return orientation === channel && Boolean(current) && current.frame === channel.frame &&
      current.frame?.contentWindow === channel.window && current.frameRequestId === channel.frameRequestId &&
      current.sessionId === channel.sessionId && current.terminalSessionId === channel.terminalSessionId &&
      current.projectSlug === channel.projectSlug;
  }

  function channelVisible(channel) {
    return frameCurrent(channel) && frameVisible(channel.frame);
  }

  function retireInteraction(channel = orientation) {
    if (channel) channel.pending = null;
  }

  function close() {
    retireInteraction();
    orientation?.port?.close();
    orientation = null;
  }

  function interactionCurrent(channel, pending) {
    return channel.pending === pending && channelVisible(channel) && learningOwner() === pending.owner &&
      pending.owner.exerciseCurrent(pending.ticket);
  }

  function handlePacket(channel, input) {
    if (!frameCurrent(channel)) return;
    if (input?.protocolVersion !== ORIENTATION_PROTOCOL_VERSION || input.playerInstanceId !== channel.playerInstanceId ||
        input.instanceId !== channel.instanceId) {
      retireInteraction(channel);
      return;
    }
    if (input.type === "ready" && exactFields(input, PACKET_FIELDS)) {
      channel.ready = true;
      return;
    }
    if (!channel.ready || !channelVisible(channel)) {
      retireInteraction(channel);
      return;
    }
    if (input.type === "button" && exactFields(input, [...PACKET_FIELDS, "interactionId"]) && orientationUuid(input.interactionId)) {
      retireInteraction(channel);
      reportActivity("app-pressed", { projectSlug: channel.projectSlug, sessionId: channel.sessionId });
      const owner = learningOwner();
      const ticket = owner?.beginExercise(channel.projectSlug);
      if (ticket) channel.pending = { owner, ticket, interactionId: input.interactionId, phase: "button" };
      return;
    }
    const pending = channel.pending;
    if (!pending || input.interactionId !== pending.interactionId) return;
    if (!interactionCurrent(channel, pending)) {
      retireInteraction(channel);
      return;
    }
    if (input.type === "request" && pending.phase === "button" && typeof input.method === "string" &&
        typeof input.path === "string" && exactFields(input, [...PACKET_FIELDS, "interactionId", "method", "path"])) {
      pending.phase = "request";
      return;
    }
    if (input.type === "response-displayed" && pending.phase === "request" && orientationUuid(input.requestId) &&
        typeof input.message === "string" && exactFields(input, [...PACKET_FIELDS, "interactionId", "requestId", "message"])) {
      retireInteraction(channel);
      void pending.owner.finishExercise(pending.ticket, { sessionId: channel.sessionId,
        instanceId: channel.instanceId, interactionId: pending.interactionId, requestId: input.requestId });
      return;
    }
    retireInteraction(channel);
  }

  function connect() {
    const channel = orientation;
    if (!channel || channel.port || !frameCurrent(channel) || !preview()?.loaded) return;
    const ports = new MessageChannel();
    channel.port = ports.port1;
    channel.port.onmessage = event => handlePacket(channel, event.data);
    channel.port.onmessageerror = () => retireInteraction(channel);
    channel.port.start();
    try {
      channel.window.postMessage({ type: ORIENTATION_INIT_MESSAGE_TYPE, protocolVersion: ORIENTATION_PROTOCOL_VERSION,
        playerInstanceId: channel.playerInstanceId }, channel.origin, [ports.port2]);
    } catch {
      ports.port2.close();
      close();
    }
  }

  // An admitted announcement from the displayed frame's window and origin.
  function announce(event) {
    const owner = learningOwner();
    const current = preview();
    if (!owner || !exactFields(event.data, ["type", "protocolVersion", "instanceId"]) ||
        event.data.protocolVersion !== ORIENTATION_PROTOCOL_VERSION || !orientationUuid(event.data.instanceId) ||
        event.ports?.length || !current?.frameRequestId || !current.projectSlug || !current.sessionId ||
        !current.terminalSessionId) return;
    void owner.prepareExercise?.(current.projectSlug);
    if (orientation && frameCurrent(orientation) && orientation.instanceId === event.data.instanceId) return;
    close();
    orientation = { frame: current.frame, window: event.source, origin: event.origin,
      frameRequestId: current.frameRequestId, projectSlug: current.projectSlug,
      sessionId: current.sessionId, terminalSessionId: current.terminalSessionId,
      instanceId: event.data.instanceId, playerInstanceId: crypto.randomUUID(), ready: false, port: null, pending: null };
    connect();
  }

  function invalidateHidden() {
    if (orientation?.pending && !interactionCurrent(orientation, orientation.pending)) retireInteraction();
  }

  // Any change to the displayed Preview or the current exercise step closes a
  // channel whose frame is gone, connects one whose frame finished loading, and
  // retires a press that is no longer visible or current.
  watch(() => {
    const current = preview();
    return [current?.frame, current?.frameRequestId, current?.loaded, current?.displayed, current?.projectSlug,
      current?.sessionId, current?.terminalSessionId, learningOwner()?.exerciseStep(current?.projectSlug)];
  }, () => {
    if (orientation && !frameCurrent(orientation)) {
      close();
    } else {
      connect();
    }
    invalidateHidden();
  }, { flush: "sync" });

  onBeforeMount(() => {
    document.addEventListener("visibilitychange", invalidateHidden);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", invalidateHidden);
    close();
  });

  return { announce, close };
}

export {
  isOrientationAnnouncement,
  useVibe64LearningOrientation
};
