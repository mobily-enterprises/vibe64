// The application identity a Preview is signed in as: the configured
// identities, the one a grant exchange confirmed, and how each is labelled.

const PREVIEW_IDENTITY_TYPE_EMAIL = "email";

const PREVIEW_IDENTITY_TYPE_LOGIN = "login";

const PREVIEW_IDENTITY_TYPE_USER_ID = "user-id";

const PREVIEW_IDENTITY_TYPES = Object.freeze([
  PREVIEW_IDENTITY_TYPE_EMAIL,
  PREVIEW_IDENTITY_TYPE_LOGIN,
  PREVIEW_IDENTITY_TYPE_USER_ID
]);

function previewIdentityLabelText({
  busy = false,
  identity = null
} = {}) {
  if (busy) {
    return "Switching identity";
  }
  if (!identity) {
    return "Identity not confirmed";
  }
  if (identity.mode === "guest") {
    return "Guest";
  }
  const selectorValue = String(
    identity.selector?.value || identity.email || identity.login || identity.userId || ""
  ).trim();
  const name = String(identity.name || identity.displayName || "").trim();
  return name && name !== selectorValue
    ? `${name} — ${selectorValue}`
    : name || selectorValue || "Selected app identity";
}

function previewIdentityTitleText({
  busy = false,
  error = "",
  identity = null
} = {}) {
  if (busy) {
    return "Switching preview identity…";
  }
  const message = String(error || "").trim();
  return message
    ? `Preview identity failed: ${message}`
    : `Previewing as ${previewIdentityLabelText({ identity })}`;
}

function normalizePreviewIdentitySelector(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = String(source.type || "").trim();
  const rawValue = String(source.value || "").trim();
  if (!PREVIEW_IDENTITY_TYPES.includes(type) || !rawValue) {
    return null;
  }
  const normalizedValue = type === PREVIEW_IDENTITY_TYPE_EMAIL
    ? rawValue.toLowerCase()
    : rawValue;
  if (
    (type === PREVIEW_IDENTITY_TYPE_EMAIL && (!normalizedValue.includes("@") || normalizedValue.length > 320)) ||
    (type !== PREVIEW_IDENTITY_TYPE_EMAIL && normalizedValue.length > 256)
  ) {
    return null;
  }
  return {
    type,
    value: normalizedValue
  };
}

function normalizeConfiguredPreviewIdentities(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  const identities = [];
  const names = new Set();
  for (const entry of value) {
    const name = String(entry?.name || "").trim().toLowerCase();
    const selector = normalizePreviewIdentitySelector({
      type: entry?.type,
      value: entry?.value
    });
    if (!name || names.has(name) || !selector) {
      continue;
    }
    names.add(name);
    identities.push({
      name,
      selector,
      type: selector.type,
      value: selector.value
    });
  }
  return identities;
}

function previewIdentityTypeLabel(type = "") {
  return {
    [PREVIEW_IDENTITY_TYPE_EMAIL]: "Email",
    [PREVIEW_IDENTITY_TYPE_LOGIN]: "Login name",
    [PREVIEW_IDENTITY_TYPE_USER_ID]: "User ID"
  }[String(type || "").trim()] || "User identifier";
}

function previewIdentityFromExchange(exchangeResult = {}, requestedIdentity = {}) {
  if (requestedIdentity.mode === "guest") {
    return {
      mode: "guest"
    };
  }
  const identity = exchangeResult.identity && typeof exchangeResult.identity === "object"
    ? exchangeResult.identity
    : {};
  const selector = normalizePreviewIdentitySelector(
    identity.selector || requestedIdentity.selector
  );
  const email = String(identity.email || (selector?.type === PREVIEW_IDENTITY_TYPE_EMAIL
    ? selector.value
    : "")).trim().toLowerCase();
  const login = String(identity.login || (selector?.type === PREVIEW_IDENTITY_TYPE_LOGIN
    ? selector.value
    : "")).trim();
  const userId = String(identity.userId || (selector?.type === PREVIEW_IDENTITY_TYPE_USER_ID
    ? selector.value
    : "")).trim();
  const username = String(identity.username || "").trim();
  return {
    displayName: String(
      identity.displayName || username || requestedIdentity.displayName || requestedIdentity.name || selector?.value || ""
    ).trim(),
    email,
    login,
    mode: requestedIdentity.mode,
    name: String(requestedIdentity.name || "").trim(),
    selector,
    userId,
    username
  };
}

function defaultPreviewIdentitySelection({
  capability = null
} = {}) {
  const name = String(capability?.defaultIdentityName || "").trim();
  return capability?.defaultMode === "identity" && name
    ? {
        identityName: name,
        mode: "identity"
      }
    : {
        mode: "guest"
      };
}

export {
  defaultPreviewIdentitySelection,
  normalizeConfiguredPreviewIdentities,
  previewIdentityFromExchange,
  previewIdentityLabelText,
  previewIdentityTitleText,
  previewIdentityTypeLabel
};
