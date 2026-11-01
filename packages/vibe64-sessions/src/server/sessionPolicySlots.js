import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * The open sessions a project's session limit counts: the visible ones, plus
 * each renewal in progress that none of them stands for.
 * @param {Vibe64SessionRuntime} runtime
 * @param {object[] | null} [openSessions]
 */
async function sessionsOccupyingPolicySlots(runtime, openSessions = null) {
  const visible = Array.isArray(openSessions)
    ? openSessions
    : await runtime.listSessionSummaries({ statusGroup: "open" });
  const visibleIds = new Set(visible.map((session) => normalizeText(session?.sessionId)).filter(Boolean));
  const reservations = [];
  const reservedRenewalIds = new Set();
  for (const session of await runtime.store.listSessionsForRenewal()) {
    const status = normalizeText(session?.status);
    if (!["renewal_pending", "renewal_quiesced"].includes(status)) {
      continue;
    }
    const renewalId = normalizeText(
      session.metadata?.renewal_id || session.metadata?.renewal_quiesced_id
    );
    const linkedSessionIds = [
      normalizeText(session.sessionId),
      normalizeText(session.metadata?.renewed_from),
      normalizeText(session.metadata?.renewed_to)
    ].filter(Boolean);
    if (
      !renewalId ||
      reservedRenewalIds.has(renewalId)
    ) {
      continue;
    }
    reservedRenewalIds.add(renewalId);
    if (linkedSessionIds.some((sessionId) => visibleIds.has(sessionId))) {
      continue;
    }
    reservations.push(session);
  }
  return [...visible, ...reservations];
}

export { sessionsOccupyingPolicySlots };
