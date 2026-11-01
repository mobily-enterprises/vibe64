// Exchanges a managed app identity grant through the Preview proxy, once per grant.

import { PREVIEW_IDENTITY_LOGOUT_OPERATION, verifyPreviewIdentityGrant } from "@local/vibe64-core/server/previewAuth";
import { previewTokenCookie } from "./launchPreviewHeaders.js";

const PREVIEW_IDENTITY_REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
const consumedPreviewIdentityGrantNonces = new Map();

async function readStreamBuffer(stream, {
  maxBytes = 0,
  tooLargeError = () => new Error("Stream is too large.")
} = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (maxBytes > 0 && totalBytes > maxBytes) {
      throw tooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requestBody(request, {
  maxBytes
}) {
  return readStreamBuffer(request, {
    maxBytes,
    tooLargeError: () => previewIdentityProxyError(
      "Preview identity request is too large.",
      "vibe64_preview_identity_request_too_large",
      413
    )
  });
}

async function previewIdentityRequestGrant(request) {
  const contentLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > PREVIEW_IDENTITY_REQUEST_BODY_LIMIT_BYTES) {
    throw previewIdentityProxyError(
      "Preview identity request is too large.",
      "vibe64_preview_identity_request_too_large",
      413
    );
  }
  const body = await requestBody(request, {
    maxBytes: PREVIEW_IDENTITY_REQUEST_BODY_LIMIT_BYTES
  });
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw previewIdentityProxyError(
      "Preview identity request is invalid.",
      "vibe64_preview_identity_request_invalid",
      400
    );
  }
  const grant = String(payload?.grant || "").trim();
  if (!grant) {
    throw previewIdentityProxyError(
      "Preview identity grant is required.",
      "vibe64_preview_identity_grant_missing",
      400
    );
  }
  return grant;
}

function previewIdentityProxyError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function previewIdentityErrorPayload(error = {}, options = {}) {
  const {
    signedOut = false
  } = options;
  return {
    code: String(error.code || "vibe64_preview_identity_exchange_failed"),
    error: String(error.message || error || "Preview identity exchange failed."),
    ok: false,
    signedOut: signedOut === true
  };
}

function writePreviewIdentityJson(response, statusCode, payload = {}, setCookie = []) {
  const body = JSON.stringify(payload);
  const headers = {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  };
  if (setCookie.length > 0) {
    headers["Set-Cookie"] = setCookie;
  }
  response.writeHead(statusCode, headers);
  response.end(body);
}

function previewIdentityResult(payload = {}, selection = {}) {
  if (selection.operation === PREVIEW_IDENTITY_LOGOUT_OPERATION) {
    return {
      identity: null,
      ok: true
    };
  }
  const identityPayload = payload.identity && typeof payload.identity === "object" && !Array.isArray(payload.identity)
    ? payload.identity
    : payload;
  const selector = selection.subject?.selector || selection.selector || selection.subject?.identifiers?.[0] || {};
  return {
    identity: {
      displayName: String(identityPayload.displayName || identityPayload.name || "").trim(),
      email: String(identityPayload.email || (selector.type === "email" ? selector.value : "")).trim().toLowerCase(),
      login: String(identityPayload.login || (selector.type === "login" ? selector.value : "")).trim(),
      selector,
      userId: String(identityPayload.userId || "").trim(),
      username: String(identityPayload.username || "").trim()
    },
    ok: true
  };
}

function createPreviewIdentityGrantConsumer(previewAuth = {}) {
  return function consume(grant = "") {
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const [nonce, expiresAt] of consumedPreviewIdentityGrantNonces) {
      if (expiresAt <= nowSeconds) {
        consumedPreviewIdentityGrantNonces.delete(nonce);
      }
    }
    const verified = verifyPreviewIdentityGrant(grant, previewAuth, {
      nowSeconds
    });
    if (consumedPreviewIdentityGrantNonces.has(verified.nonce)) {
      throw previewIdentityProxyError(
        "Preview identity grant has already been used.",
        "vibe64_preview_identity_grant_replayed",
        409
      );
    }
    consumedPreviewIdentityGrantNonces.set(verified.nonce, verified.expiresAt);
    return verified.selection;
  };
}

async function proxyPreviewIdentityExchange(request, response, {
  consumeIdentityGrant,
  executePreviewIdentityCommand = null,
  previewAuth = null,
  proxyOrigin = "",
  token = ""
} = {}) {
  const setCookie = [];
  let signedOut = false;
  try {
    if (typeof consumeIdentityGrant !== "function") {
      throw previewIdentityProxyError(
        "This preview does not support identity switching.",
        "vibe64_preview_identity_unsupported",
        404
      );
    }
    const grant = await previewIdentityRequestGrant(request);
    const selection = consumeIdentityGrant(grant);
    if (typeof executePreviewIdentityCommand !== "function") {
      throw previewIdentityProxyError(
        "Application preview identity command is unavailable. Restart the preview.",
        "vibe64_preview_identity_command_unavailable",
        409
      );
    }
    const commandResult = await executePreviewIdentityCommand({
      previewAuth,
      selection
    });
    setCookie.push(...(Array.isArray(commandResult?.setCookie) ? commandResult.setCookie : []));
    signedOut = commandResult?.signedOut === true;
    if (commandResult?.ok !== true) {
      throw previewIdentityProxyError(
        String(commandResult?.error || "Application preview identity was rejected."),
        String(commandResult?.code || "vibe64_preview_identity_application_rejected"),
        Number(commandResult?.statusCode || 400)
      );
    }
    writePreviewIdentityJson(
      response,
      200,
      previewIdentityResult(commandResult, selection),
      [
        ...setCookie,
        previewTokenCookie(token, { proxyOrigin })
      ]
    );
  } catch (error) {
    writePreviewIdentityJson(
      response,
      Number(error?.statusCode || 400),
      previewIdentityErrorPayload(error, {
        signedOut
      }),
      setCookie
    );
  }
}

export {
  createPreviewIdentityGrantConsumer,
  previewIdentityProxyError,
  proxyPreviewIdentityExchange,
  readStreamBuffer,
  writePreviewIdentityJson
};
