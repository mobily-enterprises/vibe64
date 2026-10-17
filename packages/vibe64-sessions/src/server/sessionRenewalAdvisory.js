import { sessionContextUsageFromMetadata } from "@local/vibe64-terminals/server/context-usage";

const DAY_MS = 24 * 60 * 60 * 1000;

const SESSION_RENEWAL_THRESHOLDS = Object.freeze({
  contextConsiderRatio: 0.75,
  contextSoonRatio: 0.9,
  conversationConsiderTurns: 100,
  conversationSoonTurns: 180,
  compactionConsiderCount: 2,
  compactionSoonCount: 3,
  establishedAgeDays: 21,
  establishedConversationTurns: 40
});

function finiteNonNegativeInteger(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function finitePositiveInteger(value) {
  const number = finiteNonNegativeInteger(value);
  return number > 0 ? number : 0;
}

function contextUsageSignal(value = null) {
  const usedTokens = finiteNonNegativeInteger(value?.usedTokens);
  const windowTokens = finitePositiveInteger(value?.windowTokens);
  if (!windowTokens || usedTokens > windowTokens) {
    return null;
  }
  return {
    exact: value?.exact === true,
    ratio: usedTokens / windowTokens,
    updatedAt: String(value?.updatedAt || "").trim(),
    usedTokens,
    windowTokens
  };
}


function sessionAgeDays(session = {}, now = new Date()) {
  const createdAt = Date.parse(String(session?.manifest?.createdAt || ""));
  const current = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  if (!Number.isFinite(createdAt) || !Number.isFinite(current) || current < createdAt) {
    return 0;
  }
  return Math.floor((current - createdAt) / DAY_MS);
}

function sessionRenewalAdvisory({
  contextUsage = null,
  conversationTurnCount = 0,
  now = new Date(),
  session = {}
} = {}) {
  const ageDays = sessionAgeDays(session, now);
  const compactionCount = finiteNonNegativeInteger(
    session?.metadata?.agent_context_compaction_count
  );
  const turnCount = finiteNonNegativeInteger(conversationTurnCount);
  const usage = contextUsageSignal(contextUsage);
  const exactContextRatio = usage?.exact === true ? usage.ratio : null;
  const establishedHistory = ageDays >= SESSION_RENEWAL_THRESHOLDS.establishedAgeDays &&
    turnCount >= SESSION_RENEWAL_THRESHOLDS.establishedConversationTurns;
  const consider = (
    exactContextRatio >= SESSION_RENEWAL_THRESHOLDS.contextConsiderRatio ||
    turnCount >= SESSION_RENEWAL_THRESHOLDS.conversationConsiderTurns ||
    compactionCount >= SESSION_RENEWAL_THRESHOLDS.compactionConsiderCount ||
    establishedHistory
  );
  const soon = (
    exactContextRatio >= SESSION_RENEWAL_THRESHOLDS.contextSoonRatio ||
    turnCount >= SESSION_RENEWAL_THRESHOLDS.conversationSoonTurns ||
    compactionCount >= SESSION_RENEWAL_THRESHOLDS.compactionSoonCount
  );
  const primarySignal = exactContextRatio >= SESSION_RENEWAL_THRESHOLDS.contextConsiderRatio
    ? "provider-context"
    : compactionCount >= SESSION_RENEWAL_THRESHOLDS.compactionConsiderCount
      ? "context-compactions"
      : turnCount >= SESSION_RENEWAL_THRESHOLDS.conversationConsiderTurns
        ? "conversation-turns"
        : establishedHistory
          ? "established-history"
          : "none";
  return Object.freeze({
    available: true,
    primarySignal,
    reason: soon
      ? "This session has a very long working history. Renew it before the assistant loses useful context."
      : consider
        ? "This session has a long working history. Consider renewing it while the context is still reliable."
        : "Renew this session whenever you want a fresh conversation with a reviewed handover.",
    recommended: consider,
    severity: soon ? "soon" : consider ? "consider" : "none",
    signals: {
      ageDays,
      compactionCount,
      contextUsage: usage?.exact === true ? usage : null,
      conversationTurnCount: turnCount
    }
  });
}

export {
  SESSION_RENEWAL_THRESHOLDS,
  contextUsageSignal,
  sessionAgeDays,
  sessionContextUsageFromMetadata,
  sessionRenewalAdvisory
};
