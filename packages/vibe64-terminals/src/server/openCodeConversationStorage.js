import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { createHash, randomUUID } from "node:crypto";

function openCodeFingerprint(...values) {
  return createHash("sha256").update(values.map((value) => String(value ?? "")).join("\0")).digest("hex");
}

const fingerprint = openCodeFingerprint;

function upstreamMessageId(value = "") {
  return `msg_vibe64_${fingerprint(value || randomUUID()).slice(0, 40)}`;
}

function conversationMessageId(...values) {
  return `oc_${fingerprint(...values).slice(0, 48)}`;
}

function text(value = "") {
  return String(value ?? "").trim();
}

function renewalSession(context = {}) {
  return Boolean(text(context.session?.metadata?.renewed_from));
}

async function writeOpenCodeSessionMetadata(context = {}, values = {}) {
  const store = context.runtime?.store;
  const entries = Object.entries(values)
    .filter(([name, value]) => text(name) && value !== undefined && value !== null);
  if (!entries.length) {
    return;
  }
  const internal = renewalSession(context) &&
    typeof store?.writeMetadataValueForRenewal === "function";
  const write = internal
    ? store.writeMetadataValueForRenewal.bind(store)
    : store?.writeMetadataValue?.bind(store);
  const mutate = internal
    ? store?.mutateSessionForRenewal?.bind(store)
    : store?.mutateSession?.bind(store);
  if (typeof write !== "function") {
    throw new TypeError("OpenCode requires writable Vibe64 session metadata.");
  }
  const operation = async () => {
    await Promise.all(entries.map(([name, value]) => (
      write(context.sessionId, name, String(value))
    )));
  };
  if (typeof mutate === "function") {
    await mutate(context.sessionId, operation);
  } else {
    await operation();
  }
}

async function recordOpenCodeSessionIdentity(context, nativeId) {
  if (
    text(context.session?.metadata?.opencode_conversation_id) !== nativeId ||
    text(context.session?.metadata?.agent_identity_conversation_id) !== nativeId ||
    text(context.session?.metadata?.agent_identity_provider) !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE ||
    text(context.session?.metadata?.agent_transport_id) !== "opencode_server"
  ) {
    const capturedAt = new Date().toISOString();
    await writeOpenCodeSessionMetadata(context, {
      opencode_conversation_id: nativeId,
      agent_identity_captured_at: capturedAt,
      agent_identity_conversation_id: nativeId,
      agent_identity_provider: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      agent_identity_resume_strategy: "provider-native",
      agent_identity_status: "ready",
      agent_identity_updated_at: capturedAt,
      agent_identity_workdir: context.workdir,
      agent_transport_id: "opencode_server",
      agent_transport_kind: "loopback-http"
    });
    context.session.metadata.opencode_conversation_id = nativeId;
  }
}

export { openCodeFingerprint, upstreamMessageId, conversationMessageId, recordOpenCodeSessionIdentity, writeOpenCodeSessionMetadata };
