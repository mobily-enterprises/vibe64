import { createHash } from "node:crypto";

import {
  vibe64Error
} from "@local/vibe64-core/server/core";

const DEFAULT_PUBLIC_DOMAIN = "users.vibe64.dev";
const PUBLIC_NAME_MAX_LENGTH = 63;
const PUBLIC_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const RESERVED_PUBLIC_NAMES = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "blog",
  "cdn",
  "console",
  "dashboard",
  "docs",
  "help",
  "home",
  "login",
  "logout",
  "mail",
  "manage",
  "management",
  "pay",
  "payment",
  "payments",
  "pricing",
  "root",
  "security",
  "signin",
  "signup",
  "status",
  "studio",
  "support",
  "system",
  "team",
  "teams",
  "user",
  "users",
  "vibe64",
  "www"
]);

const RESERVED_PUBLIC_NAME_PREFIXES = Object.freeze([
  "admin-",
  "auth-",
  "billing-",
  "login-",
  "openai-",
  "payment-",
  "security-",
  "support-",
  "vibe64-"
]);

const RESERVED_PUBLIC_NAME_SUFFIXES = Object.freeze([
  "-openai",
  "-vibe64"
]);

const PLATFORM_DOMAIN_SUFFIXES = Object.freeze([
  ".vibe64.com",
  ".vibe64.dev"
]);

function normalizePublicName(value = "") {
  return String(value || "").trim().toLowerCase();
}

function publicHostForName(publicName = "") {
  return `${normalizePublicName(publicName)}.${DEFAULT_PUBLIC_DOMAIN}`;
}

function publicNameFromHost(hostname = "") {
  const normalizedHostname = normalizeHostname(hostname);
  const suffix = `.${DEFAULT_PUBLIC_DOMAIN}`;
  if (!normalizedHostname.endsWith(suffix)) {
    return "";
  }
  const publicName = normalizedHostname.slice(0, -suffix.length);
  return publicName.includes(".") ? "" : publicName;
}

function validatePublicName(publicName = "") {
  const normalizedPublicName = normalizePublicName(publicName);
  if (!normalizedPublicName) {
    return invalidPublicName("Choose a public name before publishing.");
  }
  if (normalizedPublicName.length > PUBLIC_NAME_MAX_LENGTH || !PUBLIC_NAME_PATTERN.test(normalizedPublicName)) {
    return invalidPublicName("Public names must use lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen.");
  }
  if (RESERVED_PUBLIC_NAMES.has(normalizedPublicName)) {
    return invalidPublicName("That public name is reserved for Vibe64 platform use.", "vibe64_public_name_reserved");
  }
  if (
    RESERVED_PUBLIC_NAME_PREFIXES.some((prefix) => normalizedPublicName.startsWith(prefix)) ||
    RESERVED_PUBLIC_NAME_SUFFIXES.some((suffix) => normalizedPublicName.endsWith(suffix))
  ) {
    return invalidPublicName("That public name looks like an official Vibe64 or platform service.", "vibe64_public_name_reserved");
  }
  return {
    ok: true,
    publicHost: publicHostForName(normalizedPublicName),
    publicName: normalizedPublicName
  };
}

function assertValidPublicName(publicName = "") {
  const validation = validatePublicName(publicName);
  if (!validation.ok) {
    throw vibe64Error(validation.message, validation.code);
  }
  return validation.publicName;
}

function normalizeHostname(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/u, "");
}

function validateCustomHostname(hostname = "") {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    return invalidHostname("Enter a custom domain name.");
  }
  if (normalizedHostname.length > 253) {
    return invalidHostname("Custom domain names must be 253 characters or fewer.");
  }
  const labels = normalizedHostname.split(".");
  if (labels.length < 2 || labels.some((label) => !HOSTNAME_LABEL_PATTERN.test(label))) {
    return invalidHostname("Custom domains must be valid hostnames such as www.example.com.");
  }
  if (normalizedHostname === DEFAULT_PUBLIC_DOMAIN || normalizedHostname.endsWith(`.${DEFAULT_PUBLIC_DOMAIN}`)) {
    return invalidHostname("Use public-name reservation for Vibe64 default domains, not custom domain binding.", "vibe64_custom_domain_platform_owned");
  }
  if (PLATFORM_DOMAIN_SUFFIXES.some((suffix) => normalizedHostname === suffix.slice(1) || normalizedHostname.endsWith(suffix))) {
    return invalidHostname("Vibe64 platform domains cannot be added as custom domains.", "vibe64_custom_domain_platform_owned");
  }
  return {
    hostname: normalizedHostname,
    ok: true
  };
}

function assertValidCustomHostname(hostname = "") {
  const validation = validateCustomHostname(hostname);
  if (!validation.ok) {
    throw vibe64Error(validation.message, validation.code);
  }
  return validation.hostname;
}

function domainVerificationRecord({
  hostname = "",
  projectSlug = "",
  publicName = ""
} = {}) {
  const normalizedHostname = assertValidCustomHostname(hostname);
  const token = createHash("sha256")
    .update(`vibe64-domain:${normalizedHostname}:${projectSlug}:${publicName}`)
    .digest("hex")
    .slice(0, 32);
  return {
    host: `_vibe64.${normalizedHostname}`,
    type: "TXT",
    value: `vibe64-domain=${token}`
  };
}

function invalidPublicName(message, code = "vibe64_invalid_public_name") {
  return {
    available: false,
    code,
    errors: [
      {
        code,
        message
      }
    ],
    message,
    ok: false,
    publicHost: "",
    publicName: ""
  };
}

function invalidHostname(message, code = "vibe64_invalid_custom_domain") {
  return {
    code,
    errors: [
      {
        code,
        message
      }
    ],
    hostname: "",
    message,
    ok: false
  };
}

export {
  DEFAULT_PUBLIC_DOMAIN,
  assertValidCustomHostname,
  assertValidPublicName,
  domainVerificationRecord,
  normalizeHostname,
  normalizePublicName,
  publicNameFromHost,
  publicHostForName,
  validateCustomHostname,
  validatePublicName
};
