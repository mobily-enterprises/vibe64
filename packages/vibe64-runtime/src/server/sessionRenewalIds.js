import { normalizeText, vibe64Error } from "@local/vibe64-core/server/core";

const SESSION_RENEWAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

function assertRenewalId(renewalId = "") {
  const normalizedRenewalId = normalizeText(renewalId);
  if (!SESSION_RENEWAL_ID_PATTERN.test(normalizedRenewalId)) {
    throw vibe64Error(
      `Invalid Vibe64 session renewal id: ${normalizedRenewalId || "(empty)"}`,
      "vibe64_invalid_session_renewal_id"
    );
  }
  return normalizedRenewalId;
}

export { SESSION_RENEWAL_ID_PATTERN, assertRenewalId };
