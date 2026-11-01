import { randomUUID } from "node:crypto";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime";

import {
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SUBJECT_SELECTOR,
  normalizePreviewIdentitySelection
} from "@local/vibe64-core/server/previewAuth";
import { VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL } from "@local/vibe64-genesis/server";
import { PREVIEW_PROXY_TOKEN_QUERY_PARAM } from "../shared/launchPreviewProtocol.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").RunVibe64Command} RunVibe64Command */

const PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES = 512 * 1024;
const PREVIEW_IDENTITY_COMMAND_MAX_COOKIES = 64;
const PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES = 16 * 1024;
// The proxy names its token cookie after the query parameter, optionally
// with a port suffix and __Host- prefix (launchPreviewProxy previewTokenCookieName).
const PREVIEW_TOKEN_COOKIE_PREFIX = PREVIEW_PROXY_TOKEN_QUERY_PARAM;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

function previewIdentityCommandError(message = "", code = "vibe64_preview_identity_command_failed", statusCode = 502) {
  return new AppError(statusCode, message || "Application preview identity command failed.", { code });
}

function commandRequestSubject(selection = {}) {
  return {
    kind: PREVIEW_IDENTITY_SUBJECT_SELECTOR,
    selector: selection.selector
  };
}

function previewIdentityCommandRequest(selection = {}, options = {}) {
  const {
    requestId = randomUUID(),
    targetHref = ""
  } = options;
  const normalizedSelection = normalizePreviewIdentitySelection(selection);
  const href = String(targetHref || "").trim();
  const target = new URL(href);
  // Vibe64 builds the target from its own Preview address: another protocol is an internal failure, so the caller
  // sees "Internal server error." rather than this text.
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Application preview identity target must use HTTP.");
  }
  return {
    operation: normalizedSelection.operation,
    protocol: VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    requestId: String(requestId),
    ...(normalizedSelection.operation === PREVIEW_IDENTITY_LOGIN_OPERATION
      ? { subject: commandRequestSubject(normalizedSelection) }
      : {}),
    target: {
      href: target.toString(),
      origin: target.origin
    }
  };
}

function normalizeCommandSetCookie(value = []) {
  if (!Array.isArray(value)) {
    throw previewIdentityCommandError(
      "Application preview identity command returned invalid cookies.",
      "vibe64_preview_identity_command_response_invalid"
    );
  }
  const entries = value;
  if (entries.length > PREVIEW_IDENTITY_COMMAND_MAX_COOKIES) {
    throw previewIdentityCommandError(
      "Application preview identity command returned too many cookies.",
      "vibe64_preview_identity_command_response_invalid"
    );
  }
  return entries.map((entry, index) => {
    const header = String(entry || "");
    const firstPart = header.split(";", 1)[0] || "";
    const separatorIndex = firstPart.indexOf("=");
    const name = (separatorIndex < 0 ? firstPart : firstPart.slice(0, separatorIndex)).trim();
    if (
      !header ||
      Buffer.byteLength(header) > PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES ||
      /[\r\n]/u.test(header) ||
      separatorIndex < 1 ||
      !COOKIE_NAME_PATTERN.test(name) ||
      (name === PREVIEW_TOKEN_COOKIE_PREFIX || name.startsWith(`${PREVIEW_TOKEN_COOKIE_PREFIX}_`)) ||
      /(?:^|;)\s*domain\s*=/iu.test(header)
    ) {
      throw previewIdentityCommandError(
        `Application preview identity command returned invalid cookie ${index + 1}.`,
        "vibe64_preview_identity_command_response_invalid"
      );
    }
    return header;
  });
}

function normalizeCommandIdentity(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const identity = {
    displayName: String(value.displayName || value.name || "").trim().slice(0, 256),
    email: String(value.email || "").trim().toLowerCase().slice(0, 320),
    login: String(value.login || "").trim().slice(0, 256),
    userId: String(value.userId || value.id || "").trim().slice(0, 256),
    username: String(value.username || "").trim().slice(0, 256)
  };
  return Object.values(identity).some(Boolean) ? identity : null;
}

function normalizePreviewIdentityCommandResponse(value = {}, options = {}) {
  const {
    operation = PREVIEW_IDENTITY_LOGIN_OPERATION,
    requestId = ""
  } = options;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw previewIdentityCommandError(
      "Application preview identity command returned invalid JSON.",
      "vibe64_preview_identity_command_response_invalid"
    );
  }
  if (
    value.protocol !== VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL ||
    String(value.requestId || "") !== String(requestId || "") ||
    typeof value.ok !== "boolean"
  ) {
    throw previewIdentityCommandError(
      "Application preview identity command returned an invalid protocol response.",
      "vibe64_preview_identity_command_response_invalid"
    );
  }
  const setCookie = normalizeCommandSetCookie(value.setCookie);
  if (value.ok === false) {
    const statusCodeValue = Number(value.statusCode);
    return {
      code: String(value.code || "vibe64_preview_identity_application_rejected").trim().slice(0, 128),
      error: String(value.error || "Application preview identity was rejected.").trim().slice(0, 2000),
      ok: false,
      // readable-check: allow setter-seam - not a slot: setCookie is the application's cookie list
      setCookie,
      signedOut: value.signedOut === true,
      statusCode: Number.isInteger(statusCodeValue) && statusCodeValue >= 400 && statusCodeValue < 600
        ? statusCodeValue
        : 400
    };
  }
  const signedOut = operation === PREVIEW_IDENTITY_LOGOUT_OPERATION || value.signedOut === true;
  const identity = signedOut ? null : normalizeCommandIdentity(value.identity);
  if (setCookie.length < 1 || (!signedOut && !identity)) {
    throw previewIdentityCommandError(
      "Application preview identity command did not return an authenticated browser session.",
      "vibe64_preview_identity_command_response_invalid"
    );
  }
  return {
    identity,
    ok: true,
    // readable-check: allow setter-seam - not a slot: setCookie is the application's cookie list
    setCookie,
    signedOut,
    statusCode: 200
  };
}

function parsePreviewIdentityCommandResponse(stdout = "", options = {}) {
  let value;
  try {
    value = JSON.parse(String(stdout || ""));
  } catch {
    throw previewIdentityCommandError(
      "Application preview identity command returned invalid JSON.",
      "vibe64_preview_identity_command_response_invalid"
    );
  }
  return normalizePreviewIdentityCommandResponse(value, options);
}

/**
 * @param {object} dependencies
 * @param {string[]} [dependencies.allowedRoots]
 * @param {object | null} [dependencies.capability]
 * @param {RuntimeEnv} [dependencies.env]
 * @param {ProjectService} [dependencies.project]
 * @param {RunVibe64Command} dependencies.runCommand
 * @param {string[]} [dependencies.runtimes]
 * @param {object} [dependencies.session]
 * @param {string} [dependencies.sourceRoot]
 * @param {string} [dependencies.targetHref]
 */
function createPreviewIdentityCommandRunner({
  allowedRoots = [],
  capability = null,
  env = {},
  project = {},
  runCommand,
  runtimes = [],
  session = {},
  sourceRoot = "",
  targetHref = ""
}) {
  // capability is the Outputs Preview identity @local/vibe64-genesis validated.
  if (!capability) {
    return null;
  }
  const commandRoot = String(sourceRoot || "").trim();
  if (!commandRoot) {
    throw new TypeError("Preview identity command runner requires sourceRoot.");
  }
  return async function runPreviewIdentityCommand(selection = {}) {
    const request = previewIdentityCommandRequest(selection, {
      targetHref: targetHref || capability.targetHref
    });
    const [relativeCommand, ...args] = capability.command;
    const result = await runCommand({
      actor: "app",
      allowedRoots,
      args,
      command: path.resolve(commandRoot, relativeCommand),
      cwd: commandRoot,
      env,
      envPolicy: "preview",
      input: `${JSON.stringify(request)}\n`,
      maxBuffer: PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES,
      mode: "capture",
      project,
      purpose: "preview",
      runtimes: capability.runtimes.length > 0
        ? capability.runtimes
        : runtimes,
      session,
      timeout: capability.timeoutMs
    });
    if (result?.ok !== true) {
      throw previewIdentityCommandError(
        result?.timedOut === true
          ? "Application preview identity command timed out."
          : "Application preview identity command failed.",
        result?.timedOut === true
          ? "vibe64_preview_identity_command_timed_out"
          : "vibe64_preview_identity_command_failed"
      );
    }
    return parsePreviewIdentityCommandResponse(result.stdout, {
      operation: request.operation,
      requestId: request.requestId
    });
  };
}

const __testables = Object.freeze({ normalizePreviewIdentityCommandResponse });

export {
  COOKIE_NAME_PATTERN as PREVIEW_IDENTITY_COMMAND_COOKIE_NAME_PATTERN,
  PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES,
  PREVIEW_IDENTITY_COMMAND_MAX_COOKIES,
  PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES,
  PREVIEW_TOKEN_COOKIE_PREFIX,
  createPreviewIdentityCommandRunner,
  parsePreviewIdentityCommandResponse,
  previewIdentityCommandRequest,
  __testables
};
