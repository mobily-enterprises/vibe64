import crypto from "node:crypto";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";

const SESSION_RENEWAL_HANDOVER_SCHEMA_VERSION =
  "vibe64.session-renewal-handover.v1";
const SESSION_RENEWAL_ACKNOWLEDGEMENT_SCHEMA_VERSION =
  "vibe64.session-renewal-acknowledgement.v1";
const SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS = 20_000;
const SESSION_RENEWAL_MAX_OPERATION_ID_CHARACTERS = 128;
const SESSION_RENEWAL_REQUIRED_HANDOVER_HEADINGS = Object.freeze([
  "# Session handover",
  "## Objective",
  "## Decisions",
  "## Saved source",
  "## Touched areas",
  "## Verification",
  "## Unresolved work",
  "## Next action"
]);

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function textHasDisallowedControlCharacter(value = "") {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === 0x7f || (
      codePoint < 0x20 &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d
    );
  });
}

function sessionRenewalProtocolError(code, message, details = {}, {
  retryable = false
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = {
    ...details,
    retryable
  };
  error.retryable = retryable;
  return error;
}

function assertBoundedPlainText(value = "", {
  code,
  label,
  maxCharacters,
  required = true
} = {}) {
  const text = normalizeText(value);
  const characterCount = Array.from(text).length;
  if ((required && !text) || characterCount > maxCharacters || textHasDisallowedControlCharacter(text)) {
    throw sessionRenewalProtocolError(
      code,
      `${label} must be ${required ? "non-empty, " : ""}plain text no longer than ${maxCharacters.toLocaleString("en")} characters.`,
      {
        actualCharacters: characterCount,
        maxCharacters
      }
    );
  }
  return text;
}

function defineSessionRenewalOperationId(value = "") {
  const operationId = assertBoundedPlainText(value, {
    code: "vibe64_session_renewal_operation_id_invalid",
    label: "Session renewal operation id",
    maxCharacters: SESSION_RENEWAL_MAX_OPERATION_ID_CHARACTERS
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(operationId)) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_operation_id_invalid",
      "Session renewal operation id is invalid."
    );
  }
  return operationId;
}

function sessionRenewalClientMessageId(kind = "", operationId = "") {
  const normalizedKind = assertBoundedPlainText(kind, {
    code: "vibe64_session_renewal_operation_kind_invalid",
    label: "Session renewal operation kind",
    maxCharacters: 32
  }).toLowerCase();
  const normalizedOperationId = defineSessionRenewalOperationId(operationId);
  const fingerprint = crypto.createHash("sha256")
    .update(`${normalizedKind}\0${normalizedOperationId}`, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `vibe64:session-renewal:${normalizedKind}:${fingerprint}`;
}

function sessionRenewalHandoverHash(handover = "") {
  const normalizedHandover = defineSessionRenewalHandoverText(handover);
  return crypto.createHash("sha256")
    .update(normalizedHandover, "utf8")
    .digest("hex");
}

function defineSessionRenewalSourceEnvelope(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const authority = assertBoundedPlainText(input.authority, {
    code: "vibe64_session_renewal_source_invalid",
    label: "Canonical source authority",
    maxCharacters: 128
  });
  const commit = assertBoundedPlainText(input.commit, {
    code: "vibe64_session_renewal_source_invalid",
    label: "Canonical source commit",
    maxCharacters: 128
  });
  if (!/^[0-9a-f]{40,64}$/iu.test(commit)) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_source_invalid",
      "Canonical source commit must be a complete Git object id.",
      { commit }
    );
  }
  const ref = assertBoundedPlainText(input.ref, {
    code: "vibe64_session_renewal_source_invalid",
    label: "Canonical source ref",
    maxCharacters: 1_024
  });
  const repository = assertBoundedPlainText(input.repository, {
    code: "vibe64_session_renewal_source_invalid",
    label: "Canonical source repository",
    maxCharacters: 2_048,
    required: false
  });
  if ([authority, ref, repository].some((field) => /[\t\r\n]/u.test(field))) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_source_invalid",
      "Canonical source envelope fields must each be a single line."
    );
  }
  return Object.freeze({
    authority,
    commit: commit.toLowerCase(),
    ref,
    ...(repository ? { repository } : {})
  });
}

function defineSessionRenewalHandoverText(value = "", {
  requireStructure = false,
  source = null
} = {}) {
  // Draft review preserves the exact approved text. In particular, leading or
  // trailing whitespace is part of the frozen SHA-256 and must not be trimmed
  // while the handover crosses the provider boundary.
  const handover = String(value ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const characterCount = Array.from(handover).length;
  if (
    !handover.trim() ||
    characterCount > SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS ||
    textHasDisallowedControlCharacter(handover)
  ) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_handover_invalid",
      `Session handover must be non-empty, plain text no longer than ${SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS.toLocaleString("en")} characters.`,
      {
        actualCharacters: characterCount,
        maxCharacters: SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS
      }
    );
  }
  if (!requireStructure) {
    return handover;
  }
  const handoverLines = handover.split("\n");
  const headingIndexes = [];
  let previousIndex = -1;
  for (const heading of SESSION_RENEWAL_REQUIRED_HANDOVER_HEADINGS) {
    const indexes = handoverLines.reduce((matches, line, index) => (
      line === heading ? [...matches, index] : matches
    ), []);
    const [index = -1] = indexes;
    const occurrenceCount = indexes.length;
    if (index < 0 || index <= previousIndex || occurrenceCount !== 1) {
      throw sessionRenewalProtocolError(
        "vibe64_session_renewal_handover_invalid",
        `Session handover must contain the required ${heading} section exactly once and in order.`,
        { heading, occurrenceCount }
      );
    }
    headingIndexes.push(index);
    previousIndex = index;
  }
  for (let index = 1; index < headingIndexes.length; index += 1) {
    const heading = SESSION_RENEWAL_REQUIRED_HANDOVER_HEADINGS[index];
    const sectionStart = headingIndexes[index] + 1;
    const sectionEnd = headingIndexes[index + 1] ?? handoverLines.length;
    const hasContent = handoverLines
      .slice(sectionStart, sectionEnd)
      .some((line) => line.trim());
    if (!hasContent) {
      throw sessionRenewalProtocolError(
        "vibe64_session_renewal_handover_invalid",
        `Session handover section ${heading} must contain a concrete answer.`,
        { heading }
      );
    }
  }
  if (source) {
    const expected = defineSessionRenewalSourceEnvelope(source);
    const savedSourceStart = handover.indexOf("## Saved source");
    const savedSourceEnd = handover.indexOf("## Touched areas", savedSourceStart + 1);
    const savedSourceLines = handover
      .slice(savedSourceStart, savedSourceEnd)
      .split("\n");
    for (const [label, text] of [
      ["Authority", expected.authority],
      ["Ref", expected.ref],
      ["Commit", expected.commit],
      ...(expected.repository ? [["Repository", expected.repository]] : [])
    ]) {
      if (!savedSourceLines.includes(`- ${label}: ${text}`)) {
        throw sessionRenewalProtocolError(
          "vibe64_session_renewal_handover_source_mismatch",
          `Session handover must preserve the exact canonical ${label.toLowerCase()}.`,
          {
            expected: text,
            field: label.toLowerCase()
          }
        );
      }
    }
  }
  return handover;
}

function parseStructuredJson(rawOutput = "", {
  code,
  label,
  maxCharacters = SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS * 2
} = {}) {
  const raw = assertBoundedPlainText(rawOutput, {
    code,
    label,
    maxCharacters
  });
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw sessionRenewalProtocolError(
      code,
      `${label} was not valid structured JSON.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw sessionRenewalProtocolError(
      code,
      `${label} must be a structured object.`
    );
  }
  return {
    parsed,
    raw
  };
}

function parseSessionRenewalHandoverOutput(rawOutput = "", {
  source = null
} = {}) {
  const handover = defineSessionRenewalHandoverText(rawOutput, {
    requireStructure: true,
    source
  });
  return Object.freeze({
    handover,
    handoverHash: sessionRenewalHandoverHash(handover),
    rawOutput: handover,
    schemaVersion: SESSION_RENEWAL_HANDOVER_SCHEMA_VERSION
  });
}

function sessionRenewalHandoverPrompt({
  source = null
} = {}) {
  const canonical = defineSessionRenewalSourceEnvelope(source);
  return [
    "Vibe64 is renewing this long-running session safely.",
    "Write the authoritative handover for the fresh session that will continue this exact saved work.",
    "Do not edit files, run commands, start unrelated work, or ask questions during this turn.",
    "Use only facts established in this main conversation and the trusted canonical source envelope below.",
    "Be comprehensive but stay within 20,000 characters.",
    "Return only the Markdown handover, with no JSON wrapper or preamble.",
    "The handover must contain these headings, exactly once and in this order:",
    ...SESSION_RENEWAL_REQUIRED_HANDOVER_HEADINGS.map((heading) => `- ${heading}`),
    "Under `## Saved source`, copy these lines exactly:",
    `- Authority: ${canonical.authority}`,
    ...(canonical.repository ? [`- Repository: ${canonical.repository}`] : []),
    `- Ref: ${canonical.ref}`,
    `- Commit: ${canonical.commit}`,
    "Cover the objective, durable decisions, touched areas, verification actually run, unresolved work or risks, and the single best next action.",
    "Do not claim unsaved work exists: this renewal begins only after Vibe64 has proven the source clean and canonical-current."
  ].join("\n");
}

function sessionRenewalManualHandoverTemplate({
  source = null
} = {}) {
  const canonical = defineSessionRenewalSourceEnvelope(source);
  return [
    "# Session handover",
    "",
    "## Objective",
    "Describe the exact objective the fresh session should continue.",
    "",
    "## Decisions",
    "List the durable decisions already made.",
    "",
    "## Saved source",
    `- Authority: ${canonical.authority}`,
    ...(canonical.repository ? [`- Repository: ${canonical.repository}`] : []),
    `- Ref: ${canonical.ref}`,
    `- Commit: ${canonical.commit}`,
    "",
    "## Touched areas",
    "List the files or subsystems already involved.",
    "",
    "## Verification",
    "Record the checks actually completed.",
    "",
    "## Unresolved work",
    "Describe remaining work, risks, or open questions.",
    "",
    "## Next action",
    "State the single best next action for the fresh session."
  ].join("\n");
}

function defineSessionRenewalApprovedHandover({
  handover = "",
  handoverHash = "",
  source = null
} = {}) {
  const normalizedHandover = defineSessionRenewalHandoverText(handover);
  const actualHash = sessionRenewalHandoverHash(normalizedHandover);
  const expectedHash = assertBoundedPlainText(handoverHash, {
    code: "vibe64_session_renewal_handover_hash_invalid",
    label: "Approved handover hash",
    maxCharacters: 96
  }).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expectedHash) || expectedHash !== actualHash) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_handover_hash_invalid",
      "Approved handover content no longer matches its frozen review hash.",
      {
        actualHash,
        expectedHash
      }
    );
  }
  return Object.freeze({
    handover: normalizedHandover,
    handoverHash: actualHash,
    source: defineSessionRenewalSourceEnvelope(source)
  });
}

function sessionRenewalAcknowledgementOutputSchema({
  handoverHash = "",
  source = null
} = {}) {
  const canonical = defineSessionRenewalSourceEnvelope(source);
  const expectedHash = assertBoundedPlainText(handoverHash, {
    code: "vibe64_session_renewal_handover_hash_invalid",
    label: "Approved handover hash",
    maxCharacters: 96
  }).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expectedHash)) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_handover_hash_invalid",
      "Approved handover hash is invalid."
    );
  }
  return Object.freeze({
    additionalProperties: false,
    properties: {
      handoverHash: {
        enum: [expectedHash],
        type: "string"
      },
      message: {
        maxLength: 500,
        minLength: 1,
        type: "string"
      },
      schemaVersion: {
        enum: [SESSION_RENEWAL_ACKNOWLEDGEMENT_SCHEMA_VERSION],
        type: "string"
      },
      sourceCommit: {
        enum: [canonical.commit],
        type: "string"
      },
      status: {
        enum: ["ready"],
        type: "string"
      }
    },
    required: [
      "schemaVersion",
      "status",
      "handoverHash",
      "sourceCommit",
      "message"
    ],
    type: "object"
  });
}

function sessionRenewalSeedPrompt(input = {}) {
  const approved = defineSessionRenewalApprovedHandover(input);
  return [
    "Vibe64 created this genuinely fresh session from the canonical saved source below.",
    "Treat the approved handover as continuity context for future ordinary project work.",
    "Do not edit files, run commands, begin the next action, or ask questions during this acknowledgement turn.",
    "Acknowledge only after you have accepted the handover and canonical source as this new thread's starting context.",
    "Return exactly the required structured acknowledgement.",
    "",
    "Trusted canonical source envelope:",
    `Authority: ${approved.source.authority}`,
    ...(approved.source.repository ? [`Repository: ${approved.source.repository}`] : []),
    `Ref: ${approved.source.ref}`,
    `Commit: ${approved.source.commit}`,
    `Approved handover hash: ${approved.handoverHash}`,
    "",
    "Approved handover:",
    approved.handover
  ].join("\n");
}

function parseSessionRenewalAcknowledgement(rawOutput = "", {
  handoverHash = "",
  source = null
} = {}) {
  const canonical = defineSessionRenewalSourceEnvelope(source);
  const expectedHash = assertBoundedPlainText(handoverHash, {
    code: "vibe64_session_renewal_handover_hash_invalid",
    label: "Approved handover hash",
    maxCharacters: 96
  }).toLowerCase();
  const { parsed, raw } = parseStructuredJson(rawOutput, {
    code: "vibe64_session_renewal_acknowledgement_invalid",
    label: "Session renewal acknowledgement",
    maxCharacters: 4_096
  });
  const allowedKeys = new Set([
    "handoverHash",
    "message",
    "schemaVersion",
    "sourceCommit",
    "status"
  ]);
  const valid = parsed.schemaVersion === SESSION_RENEWAL_ACKNOWLEDGEMENT_SCHEMA_VERSION &&
    parsed.status === "ready" &&
    parsed.handoverHash === expectedHash &&
    normalizeText(parsed.sourceCommit).toLowerCase() === canonical.commit &&
    Object.keys(parsed).every((key) => allowedKeys.has(key));
  if (!valid) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_acknowledgement_invalid",
      "The fresh assistant thread did not acknowledge the exact approved handover and canonical source.",
      {
        expectedHandoverHash: expectedHash,
        expectedSourceCommit: canonical.commit
      },
      { retryable: true }
    );
  }
  const message = assertBoundedPlainText(parsed.message, {
    code: "vibe64_session_renewal_acknowledgement_invalid",
    label: "Session renewal acknowledgement message",
    maxCharacters: 500
  });
  return Object.freeze({
    handoverHash: expectedHash,
    message,
    rawOutput: raw,
    schemaVersion: SESSION_RENEWAL_ACKNOWLEDGEMENT_SCHEMA_VERSION,
    sourceCommit: canonical.commit,
    status: "ready"
  });
}

function prepareSessionRenewalHandoverRequest(input = {}) {
  if (input && Object.prototype.hasOwnProperty.call(input, "executionProfile")) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_interactive_provider_required",
      "Session handover generation must use the old session's normal interactive assistant settings."
    );
  }
  const operationId = defineSessionRenewalOperationId(
    input.operationId || input.operationKey
  );
  const source = defineSessionRenewalSourceEnvelope(input.source);
  const clientMessageId = sessionRenewalClientMessageId("handover", operationId);
  return { operationId, source, clientMessageId };
}

function prepareSessionRenewalSeedRequest(input = {}) {
  if (input && Object.prototype.hasOwnProperty.call(input, "executionProfile")) {
    throw sessionRenewalProtocolError(
      "vibe64_session_renewal_interactive_provider_required",
      "A renewed session must start with normal interactive assistant settings."
    );
  }
  const operationId = defineSessionRenewalOperationId(
    input.operationId || input.operationKey
  );
  const approved = defineSessionRenewalApprovedHandover({
    handover: input.handover,
    handoverHash: input.handoverHash,
    source: input.source
  });
  const oldThreadId = String(input.oldThreadId || input.forbiddenThreadId || "").trim();
  const clientMessageId = sessionRenewalClientMessageId("seed", operationId);
  return { operationId, approved, oldThreadId, clientMessageId };
}

const RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND =
  "vibe64.session_renewal_successor_process_exit_proof_release";

function normalizeRenewalContextText(value) {
  return String(value || "").trim();
}

function renewalCleanupContext(sessionId = "", options = {}) {
  const renewalCleanup = options?.renewalCleanup;
  if (!renewalCleanup) {
    return null;
  }
  const normalizedSessionId = normalizeRenewalContextText(sessionId);
  const runtime = options.runtime;
  const session = options.session;
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const cleanupKind = normalizeRenewalContextText(renewalCleanup.kind);
  const renewalId = normalizeRenewalContextText(renewalCleanup.renewalId);
  const sourceSessionId = normalizeRenewalContextText(renewalCleanup.sourceSessionId);
  const status = normalizeRenewalContextText(session?.status);
  const successorIsExact = cleanupKind === "successor" &&
    status === VIBE64_SESSION_STATUS.RENEWAL_PENDING &&
    normalizeRenewalContextText(metadata.renewal_id) === renewalId &&
    normalizeRenewalContextText(metadata.renewed_from) === sourceSessionId &&
    Boolean(normalizeRenewalContextText(metadata.renewed_from));
  // renewal_restored_id belongs to a completed rollback, not the next
  // transition. Current quiescence or renewed_to still owns the predecessor.
  const predecessorIsExact = cleanupKind === "predecessor" &&
    sourceSessionId === normalizedSessionId &&
    (
      (
        status === VIBE64_SESSION_STATUS.ACTIVE &&
        !normalizeRenewalContextText(metadata.renewal_quiesced_id) &&
        !normalizeRenewalContextText(metadata.renewed_to)
      ) ||
      (
        status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
        normalizeRenewalContextText(metadata.renewal_quiesced_id) === renewalId
      )
    );
  if (
    !runtime ||
    normalizeRenewalContextText(session?.sessionId) !== normalizedSessionId ||
    !renewalId ||
    (!successorIsExact && !predecessorIsExact)
  ) {
    throw new TypeError("Renewal terminal cleanup requires its exact predecessor or successor and runtime.");
  }
  return {
    kind: cleanupKind,
    runtime,
    session
  };
}

function renewalArchivedPredecessorContext(sessionId = "", options = {}) {
  const normalizedSessionId = normalizeRenewalContextText(sessionId);
  const runtime = options.runtime;
  const session = options.session;
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const renewalId = normalizeRenewalContextText(options.renewalId);
  if (
    !runtime ||
    !renewalId ||
    normalizeRenewalContextText(session?.sessionId) !== normalizedSessionId ||
    session?.archived !== true ||
    normalizeRenewalContextText(session?.status) !== VIBE64_SESSION_STATUS.ARCHIVED ||
    normalizeRenewalContextText(metadata.renewal_id) !== renewalId ||
    !normalizeRenewalContextText(metadata.renewed_to)
  ) {
    throw new TypeError("Renewal maintenance requires its exact archived predecessor and runtime.");
  }
  return {
    renewalId,
    runtime,
    session
  };
}

function renewalSuccessorProcessExitProofReleaseContext(sessionId = "", options = {}) {
  const normalizedSessionId = normalizeRenewalContextText(sessionId);
  const runtime = options.runtime;
  const session = options.session;
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const renewalId = normalizeRenewalContextText(options.renewalId);
  const authorization = options.authorization && typeof options.authorization === "object"
    ? options.authorization
    : {};
  const authorizedAt = normalizeRenewalContextText(authorization.authorizedAt);
  const authorizedAtMs = Date.parse(authorizedAt);
  if (
    !runtime ||
    !renewalId ||
    normalizeRenewalContextText(session?.sessionId) !== normalizedSessionId ||
    normalizeRenewalContextText(session?.status) !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
    normalizeRenewalContextText(metadata.renewal_id) !== renewalId ||
    !normalizeRenewalContextText(metadata.renewed_from) ||
    normalizeRenewalContextText(authorization.kind) !== RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND ||
    Number(authorization.schemaVersion) !== 1 ||
    normalizeRenewalContextText(authorization.renewalId) !== renewalId ||
    normalizeRenewalContextText(authorization.sourceSessionId) !== normalizeRenewalContextText(metadata.renewed_from) ||
    normalizeRenewalContextText(authorization.successorSessionId) !== normalizedSessionId ||
    normalizeRenewalContextText(authorization.runtimeDir) !== normalizeRenewalContextText(metadata.agent_transport_runtime_dir) ||
    !Number.isFinite(authorizedAtMs) ||
    new Date(authorizedAtMs).toISOString() !== authorizedAt
  ) {
    throw new TypeError(
      "Renewal successor process-exit proof release requires its exact authorization, pending successor, and runtime."
    );
  }
  return {
    authorization,
    renewalId,
    runtime,
    session
  };
}

export {
  renewalCleanupContext,
  renewalArchivedPredecessorContext,
  renewalSuccessorProcessExitProofReleaseContext,
  SESSION_RENEWAL_ACKNOWLEDGEMENT_SCHEMA_VERSION,
  SESSION_RENEWAL_HANDOVER_SCHEMA_VERSION,
  SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
  SESSION_RENEWAL_REQUIRED_HANDOVER_HEADINGS,
  defineSessionRenewalApprovedHandover,
  defineSessionRenewalHandoverText,
  defineSessionRenewalOperationId,
  defineSessionRenewalSourceEnvelope,
  parseSessionRenewalAcknowledgement,
  parseSessionRenewalHandoverOutput,
  prepareSessionRenewalHandoverRequest,
  prepareSessionRenewalSeedRequest,
  sessionRenewalAcknowledgementOutputSchema,
  sessionRenewalClientMessageId,
  sessionRenewalHandoverHash,
  sessionRenewalHandoverPrompt,
  sessionRenewalManualHandoverTemplate,
  sessionRenewalProtocolError,
  sessionRenewalSeedPrompt
};
