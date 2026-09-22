const ZAI_CHAT_COMPLETIONS_URL = "https://api.z.ai/api/paas/v4/chat/completions";
const ZAI_FREE_MODEL_ID = "glm-4.7-flash";
const ZAI_VERIFICATION_TIMEOUT_MS = 15_000;
const ZAI_RETRYABLE_ERROR_CODES = new Set([
  "500",
  "1120",
  "1230",
  "1231",
  "1234",
  "1302"
]);

function zaiVerificationError({ retryable = false } = {}) {
  const error = new Error("Z.AI key verification did not complete.");
  error.retryable = retryable;
  error.statusCode = retryable ? 503 : 422;
  return error;
}

async function zaiResponseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function zaiFailureIsRetryable(statusCode, errorCode = "") {
  if (statusCode >= 500 || statusCode === 408) return true;
  if (statusCode === 401 || statusCode === 403) return false;
  if (statusCode === 429) return ZAI_RETRYABLE_ERROR_CODES.has(errorCode);
  return true;
}

async function verifyZaiConnection({ apiKey = "" } = {}) {
  let response;
  try {
    response = await fetch(ZAI_CHAT_COMPLETIONS_URL, {
      body: JSON.stringify({
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply only OK." }],
        model: ZAI_FREE_MODEL_ID,
        stream: false,
        thinking: { type: "disabled" }
      }),
      headers: {
        "Accept-Language": "en-US,en",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: AbortSignal.timeout(ZAI_VERIFICATION_TIMEOUT_MS)
    });
  } catch {
    throw zaiVerificationError({ retryable: true });
  }

  const body = await zaiResponseBody(response);
  if (!response.ok) {
    const errorCode = String(body?.error?.code ?? "").trim();
    throw zaiVerificationError({
      retryable: zaiFailureIsRetryable(response.status, errorCode)
    });
  }

  const choice = body?.choices?.[0];
  if (!choice?.message || choice.finish_reason === "network_error") {
    throw zaiVerificationError({ retryable: true });
  }
  return { ok: true };
}

export {
  verifyZaiConnection,
  ZAI_FREE_MODEL_ID
};
