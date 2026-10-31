// Checks a Codex message's attachments before delivery and renews accepted ones, retrying a busy renewal.

import { normalizeText } from "@local/vibe64-core/server/core";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";

const CODEX_ATTACHMENT_MAX_ITEMS = 10;
const CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS = Object.freeze([500, 1_000, 2_000, 5_000]);

const acceptedAttachmentRenewalTimers = new WeakMap();

function codexAttachmentIds(input = {}) {
  return Array.isArray(input?.attachmentIds)
    ? input.attachmentIds.map(normalizeText).filter(Boolean)
    : [];
}

function codexAttachmentDeliveryFailure(code, error, retryable) {
  return {
    code,
    error,
    ok: false,
    retryable
  };
}

async function validateCodexAttachmentsBeforeDelivery(attachments, sessionId = "", input = {}) {
  const attachmentIds = codexAttachmentIds(input);
  if (attachmentIds.length < 1) {
    return null;
  }
  let renewal;
  try {
    renewal = await attachments.renewAttachments(sessionId, attachmentIds);
  } catch (error) {
    vibe64SessionDebugLog("server.codexAttachments.deliveryValidation.error", {
      attachmentCount: attachmentIds.length,
      error: vibe64SessionDebugError(error),
      sessionId
    });
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments are temporarily unavailable. Try sending again.",
      true
    );
  }
  if (renewal?.ok === false) {
    return codexAttachmentDeliveryFailure(
      normalizeText(renewal?.code) || "vibe64_agent_attachment_unavailable",
      normalizeText(renewal?.error) || "Attachments are temporarily unavailable. Try sending again.",
      renewal?.retryable !== false
    );
  }

  const expectedIds = new Set(attachmentIds);
  const busyIds = new Set((Array.isArray(renewal?.busy) ? renewal.busy : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  const missingIds = new Set((Array.isArray(renewal?.missing) ? renewal.missing : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  const retainedIds = new Set((Array.isArray(renewal?.retained) ? renewal.retained : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  if (missingIds.size > 0) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_missing",
      "One or more attachments are no longer available. Remove and upload them again.",
      false
    );
  }
  if (busyIds.size > 0) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_busy",
      "One or more attachments are still being prepared. Try sending again.",
      true
    );
  }
  if ([...expectedIds].some((attachmentId) => !retainedIds.has(attachmentId))) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments could not be verified. Try sending again.",
      true
    );
  }
  return null;
}

async function renewAcceptedCodexAttachments(attachments, sessionId = "", input = {}, accepted = false) {
  const attachmentIds = codexAttachmentIds(input);
  if (!accepted || attachmentIds.length < 1) {
    return;
  }
  // Delivery cannot be rolled back after the provider or PTY has accepted it.
  // Retrying only the lease operation cannot submit the human turn twice.
  let pendingIds = attachmentIds;
  let lastRenewal = null;
  for (const retryDelayMs of [0, 100, 250]) {
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    let renewal;
    try {
      renewal = await attachments.renewAttachments(sessionId, pendingIds);
    } catch (error) {
      vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.error", {
        attachmentCount: pendingIds.length,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds);
      return lastRenewal;
    }
    lastRenewal = renewal;
    if (renewal?.ok === false) {
      scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds);
      return renewal;
    }
    const busy = Array.isArray(renewal?.busy)
      ? renewal.busy.map(normalizeText).filter(Boolean)
      : [];
    if (busy.length < 1) {
      return renewal;
    }
    pendingIds = busy;
  }
  scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds);
  return lastRenewal;
}

function acceptedCodexAttachmentRenewalTimerMap(attachments) {
  let timers = acceptedAttachmentRenewalTimers.get(attachments);
  if (!timers) {
    timers = new Map();
    acceptedAttachmentRenewalTimers.set(attachments, timers);
  }
  return timers;
}

function scheduleAcceptedCodexAttachmentRenewal(
  attachments,
  sessionId,
  attachmentIds,
  attempt = 0
) {
  const pendingIds = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : [])
    .map(normalizeText)
    .filter(Boolean))];
  if (pendingIds.length < 1) {
    return;
  }
  if (attempt >= CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS.length) {
    vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.exhausted", {
      attachmentCount: pendingIds.length,
      sessionId
    });
    return;
  }
  const timerKey = `${normalizeText(sessionId)}:${[...pendingIds].sort().join(",")}`;
  const timers = acceptedCodexAttachmentRenewalTimerMap(attachments);
  const existingTimer = timers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    if (timers.get(timerKey) !== timer) {
      return;
    }
    timers.delete(timerKey);
    void Promise.resolve().then(() => (
      attachments.renewAttachments(sessionId, pendingIds)
    )).then((renewal) => {
      const busy = Array.isArray(renewal?.busy)
        ? renewal.busy.map(normalizeText).filter(Boolean)
        : [];
      if (renewal?.ok === false) {
        scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds, attempt + 1);
        return;
      }
      if (busy.length > 0) {
        scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, busy, attempt + 1);
        return;
      }
      const missing = Array.isArray(renewal?.missing)
        ? renewal.missing.map(normalizeText).filter(Boolean)
        : [];
      if (missing.length > 0) {
        vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.missing", {
          attachmentCount: missing.length,
          sessionId
        });
      }
    }).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.error", {
        attachmentCount: pendingIds.length,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds, attempt + 1);
    });
  }, CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS[attempt]);
  timer.unref();
  timers.set(timerKey, timer);
}

function codexAttachmentLimitResult(input = {}) {
  const attachmentIds = codexAttachmentIds(input);
  if (attachmentIds.length <= CODEX_ATTACHMENT_MAX_ITEMS) {
    return null;
  }
  return {
    code: "vibe64_agent_attachment_limit_exceeded",
    error: `A message can include at most ${CODEX_ATTACHMENT_MAX_ITEMS} attachments.`,
    ok: false
  };
}

export {
  codexAttachmentLimitResult,
  renewAcceptedCodexAttachments,
  validateCodexAttachmentsBeforeDelivery
};
