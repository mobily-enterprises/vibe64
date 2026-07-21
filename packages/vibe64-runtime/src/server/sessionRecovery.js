import { createHash } from "node:crypto";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

const SESSION_RECOVERY_KIND = "session_recovery";
const SESSION_RECOVERY_CAPABILITY_WORKFLOW_PROGRESS = "workflow_progress";
const SESSION_RECOVERY_METADATA_PREFIX = "recovery.resolved.";

function recoverySignature(value = {}) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function recoveryResolutionMetadataName(issueId = "") {
  return `${SESSION_RECOVERY_METADATA_PREFIX}${recoverySignature(normalizeText(issueId))}`;
}

function normalizedRecoveryOption(option = {}) {
  const id = normalizeText(option.id);
  const label = normalizeText(option.label);
  if (!id || !label) {
    return null;
  }
  return {
    description: normalizeText(option.description),
    id,
    label,
    recommended: option.recommended === true,
    style: normalizeText(option.style || (option.recommended === true ? "primary" : "secondary"))
  };
}

function publicRecoveryIssue(issue = {}) {
  const id = normalizeText(issue.id);
  const title = normalizeText(issue.title);
  const signature = normalizeText(issue.signature);
  if (!id || !title || !signature) {
    return null;
  }
  return {
    blockedCapabilities: Array.isArray(issue.blockedCapabilities)
      ? issue.blockedCapabilities.map(normalizeText).filter(Boolean)
      : [],
    code: normalizeText(issue.code || id),
    evidence: (Array.isArray(issue.evidence) ? issue.evidence : [])
      .map((entry) => ({
        label: normalizeText(entry?.label),
        value: normalizeText(entry?.value)
      }))
      .filter((entry) => entry.label && entry.value),
    explanation: normalizeText(issue.explanation),
    id,
    options: (Array.isArray(issue.options) ? issue.options : [])
      .map(normalizedRecoveryOption)
      .filter(Boolean),
    signature,
    title
  };
}

function sessionRecoveryView(issues = []) {
  const publicIssues = issues.map(publicRecoveryIssue).filter(Boolean);
  if (!publicIssues.length) {
    return null;
  }
  const decisionRequired = publicIssues.some((issue) => issue.options.length > 0);
  let title = "This session needs recovery";
  if (decisionRequired) {
    title = publicIssues.length === 1
      ? "This session needs your decision"
      : "This session has recovery decisions";
  }
  return {
    issues: publicIssues,
    kind: SESSION_RECOVERY_KIND,
    message: decisionRequired
      ? "Vibe64 found that saved session state no longer agrees with the project or runtime state it depends on. Your work has not been changed. Review the details and choose how this session should continue."
      : "Vibe64 found a recoverable problem with this session. Your work has not been changed. Review the details and use the available session tools to repair it.",
    signature: recoverySignature(publicIssues.map((issue) => ({
      id: issue.id,
      signature: issue.signature
    }))),
    title
  };
}

function recoveryInspectionFailure(provider = {}, error = {}) {
  const id = `diagnostic_${normalizeText(provider.id || "unknown")}`;
  const message = normalizeText(error?.message || error) || "The diagnostic could not run.";
  return {
    blockedCapabilities: [],
    code: normalizeText(error?.code) || "vibe64_session_recovery_diagnostic_failed",
    explanation: `Vibe64 could not verify one part of this session's saved state: ${message}`,
    id,
    options: [],
    signature: recoverySignature({
      code: normalizeText(error?.code),
      id,
      message
    }),
    title: "Session consistency could not be verified"
  };
}

function createSessionRecoveryCoordinator({
  providers = []
} = {}) {
  const recoveryProviders = new Map();
  for (const provider of Array.isArray(providers) ? providers : []) {
    const providerId = normalizeText(provider?.id);
    if (!providerId || typeof provider?.inspect !== "function") {
      throw new TypeError("Session recovery providers require an id and inspect function.");
    }
    if (recoveryProviders.has(providerId)) {
      throw new TypeError(`Session recovery provider “${providerId}” is registered more than once.`);
    }
    recoveryProviders.set(providerId, provider);
  }

  async function inspectProvider(provider, context) {
    const issue = await provider.inspect(context);
    if (!issue) {
      return null;
    }
    const publicIssue = publicRecoveryIssue(issue);
    if (!publicIssue || publicIssue.id !== normalizeText(provider.id)) {
      throw vibe64Error(
        `Session recovery provider “${normalizeText(provider.id)}” returned an invalid issue.`,
        "vibe64_session_recovery_provider_invalid"
      );
    }
    return {
      ...issue,
      id: publicIssue.id,
      options: publicIssue.options,
      signature: publicIssue.signature
    };
  }

  async function inspect(context = {}) {
    const issues = [];
    for (const provider of recoveryProviders.values()) {
      try {
        const issue = await inspectProvider(provider, context);
        if (!issue) {
          continue;
        }
        const acknowledgedSignature = normalizeText(
          context.session?.metadata?.[recoveryResolutionMetadataName(issue.id)]
        );
        if (acknowledgedSignature !== normalizeText(issue.signature)) {
          issues.push(issue);
        }
      } catch (error) {
        issues.push(recoveryInspectionFailure(provider, error));
      }
    }
    return sessionRecoveryView(issues);
  }

  async function resolve(context = {}, {
    issueId = "",
    optionId = "",
    signature = ""
  } = {}) {
    const normalizedIssueId = normalizeText(issueId);
    const normalizedOptionId = normalizeText(optionId);
    const provider = recoveryProviders.get(normalizedIssueId);
    if (!provider) {
      throw vibe64Error("That session recovery is no longer available.", "vibe64_session_recovery_not_available");
    }
    const issue = await inspectProvider(provider, context);
    if (!issue || normalizeText(issue.signature) !== normalizeText(signature)) {
      throw vibe64Error(
        "The session changed while you were reviewing it. Review the current recovery details before choosing again.",
        "vibe64_session_recovery_stale"
      );
    }
    const option = (Array.isArray(issue.options) ? issue.options : [])
      .find((candidate) => normalizeText(candidate?.id) === normalizedOptionId);
    if (!option) {
      throw vibe64Error("Choose one of the available recovery options.", "vibe64_session_recovery_option_invalid");
    }
    const operationContext = {
      ...context,
      issue,
      option
    };
    const snapshot = typeof provider.capture === "function"
      ? await provider.capture(operationContext)
      : null;
    let result = {};
    try {
      result = typeof provider.apply === "function"
        ? await provider.apply({
            ...operationContext,
            snapshot
          })
        : {};
      await context.runtime.store.writeMetadataValue(
        context.session.sessionId,
        recoveryResolutionMetadataName(issue.id),
        issue.signature
      );
    } catch (error) {
      if (snapshot && typeof provider.restore === "function") {
        try {
          await provider.restore({
            ...operationContext,
            snapshot
          });
        } catch (restoreError) {
          const rollbackError = new AggregateError(
            [error, restoreError],
            "Vibe64 could not apply or fully roll back this session recovery. The source clone and branch were not replaced."
          );
          rollbackError.code = "vibe64_session_recovery_rollback_failed";
          throw rollbackError;
        }
      }
      throw error;
    }
    const message = normalizeText(result?.message || option.description || option.label);
    await Promise.allSettled([
      context.runtime.store.appendCommandLogEntry(context.session.sessionId, {
        issueId: issue.id,
        kind: "session-recovery",
        message,
        optionId: option.id,
        signature: issue.signature
      }),
      context.runtime.store.writeConversationSystemMessage(context.session.sessionId, {
        text: `Session recovery: ${message}`
      })
    ]);
    return result || {};
  }

  return Object.freeze({ inspect, resolve });
}

export {
  SESSION_RECOVERY_CAPABILITY_WORKFLOW_PROGRESS,
  SESSION_RECOVERY_KIND,
  createSessionRecoveryCoordinator,
  publicRecoveryIssue,
  recoverySignature,
  sessionRecoveryView
};
