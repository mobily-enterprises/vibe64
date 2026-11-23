// The ways a Preview application identity selects its user, and the rules a
// managed app identity list follows. One owner for both the server, which
// refuses an invalid list on every write and skips invalid entries on every
// read, and App access, which marks them while the person edits.
const PREVIEW_IDENTITY_SELECTOR_EMAIL = "email";
const PREVIEW_IDENTITY_SELECTOR_LOGIN = "login";
const PREVIEW_IDENTITY_SELECTOR_USER_ID = "user-id";
const PREVIEW_IDENTITY_SELECTOR_TYPES = Object.freeze([
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_USER_ID
]);
const PREVIEW_IDENTITY_EMAIL_MAX_LENGTH = 320;
const PREVIEW_IDENTITY_VALUE_MAX_LENGTH = 256;

const PREVIEW_APPLICATION_IDENTITY_LIMIT = 32;
const PREVIEW_APPLICATION_IDENTITY_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES = new Set([
  "default",
  "guest",
  "you"
]);
const PREVIEW_APPLICATION_IDENTITY_FIELDS = new Set(["name", "type", "value"]);

// What is wrong with an entry: each code names one rule, as the server's
// refusal reports it.
const IDENTITY_NOT_OBJECT = "vibe64_application_identity_not_object";
const IDENTITY_FIELDS_UNSUPPORTED = "vibe64_application_identity_fields_unsupported";
const IDENTITY_NAME_INVALID = "vibe64_application_identity_name_invalid";
const IDENTITY_NAME_RESERVED = "vibe64_application_identity_name_reserved";
const IDENTITY_SELECTOR_INVALID = "vibe64_application_identity_selector_invalid";
const IDENTITY_NAME_DUPLICATED = "vibe64_application_identity_name_duplicated";
const IDENTITIES_TOO_MANY = "vibe64_application_identities_too_many";

const SELECTOR_TYPE_LIST = "email, login or user-id";
const RESERVED_NAME_LIST = "default, guest and you";
const NAME_EXAMPLE = "Choose another, such as admin or user.";

/** A text field as the file holds it: trimmed text, a number's digits, otherwise nothing. */
function entryText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** A value quoted in a reason, shortened so a long one stays readable. */
function quoted(text = "") {
  const value = String(text);
  return `"${value.length > 60 ? `${value.slice(0, 59)}…` : value}"`;
}

function problem(code, reason) {
  return { code, reason };
}

/**
 * A selector checked: `{ selector }`, its type and its value trimmed (an email
 * lowercased), or `{ problem }`, the code of the rule it breaks and the reason
 * in plain words.
 * @param {{ type?: unknown, value?: unknown }} source
 */
function checkPreviewIdentitySelector(source) {
  const type = entryText(source?.type);
  if (!PREVIEW_IDENTITY_SELECTOR_TYPES.includes(type)) {
    const reason = type
      ? `Its app identifier ${quoted(type)} is not one Vibe64 knows: use ${SELECTOR_TYPE_LIST}.`
      : `It has no app identifier: use ${SELECTOR_TYPE_LIST}.`;
    return { problem: problem("vibe64_preview_identity_selector_type_invalid", reason) };
  }
  const raw = entryText(source?.value);
  const value = type === PREVIEW_IDENTITY_SELECTOR_EMAIL ? raw.toLowerCase() : raw;
  if (!value) {
    const reason = "It has no application value: enter the account's email, login name or user ID.";
    return { problem: problem("vibe64_preview_identity_selector_missing", reason) };
  }
  if (type === PREVIEW_IDENTITY_SELECTOR_EMAIL) {
    if (!value.includes("@")) return { problem: problem("vibe64_preview_identity_email_invalid", `Its email ${quoted(value)} has no @.`) };
    if (value.length > PREVIEW_IDENTITY_EMAIL_MAX_LENGTH) {
      const reason = `Its email is longer than ${PREVIEW_IDENTITY_EMAIL_MAX_LENGTH} characters.`;
      return { problem: problem("vibe64_preview_identity_email_invalid", reason) };
    }
  } else if (value.length > PREVIEW_IDENTITY_VALUE_MAX_LENGTH) {
    const login = type === PREVIEW_IDENTITY_SELECTOR_LOGIN;
    const reason = `Its ${login ? "login name" : "user ID"} is longer than ${PREVIEW_IDENTITY_VALUE_MAX_LENGTH} characters.`;
    return { problem: problem(login ? "vibe64_preview_identity_login_invalid" : "vibe64_preview_identity_user_id_invalid", reason) };
  }
  return { selector: { type, value } };
}

/** What is wrong with an entry on its own, apart from the names and the count it shares with the others. */
function entryProblem(entry, held) {
  const unsupported = Object.keys(entry).filter((key) => !PREVIEW_APPLICATION_IDENTITY_FIELDS.has(key));
  if (unsupported.length > 0) {
    const listed = unsupported.slice(0, 5).map((key) => (key.length > 40 ? `${key.slice(0, 39)}…` : key));
    const fields = `${listed.join(", ")}${unsupported.length > 5 ? ", …" : ""}`;
    const reason = `It has fields Vibe64 does not use (${fields}): an identity has only a name, an app identifier and an application value.`;
    return problem(IDENTITY_FIELDS_UNSUPPORTED, reason);
  }
  const name = held.name.toLowerCase();
  if (!name) return problem(IDENTITY_NAME_INVALID, "It has no name. Give it a short name such as admin or user.");
  if (PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES.has(name)) {
    return problem(IDENTITY_NAME_RESERVED, `The name ${quoted(name)} is reserved by Vibe64 (${RESERVED_NAME_LIST} are). ${NAME_EXAMPLE}`);
  }
  if (!PREVIEW_APPLICATION_IDENTITY_NAME_PATTERN.test(name)) {
    const rule = "a name starts with a letter a-z and has only letters a-z, digits, \"_\" and \"-\", at most 64 characters";
    return problem(IDENTITY_NAME_INVALID, `The name ${quoted(held.name)} can't be used: ${rule}.`);
  }
  const checked = checkPreviewIdentitySelector(entry);
  return checked.problem ? problem(IDENTITY_SELECTOR_INVALID, checked.problem.reason) : null;
}

function inspectEntry(entry, position) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    const reason = "It is not an identity: an identity has a name, an app identifier and an application value.";
    return { name: "", position, problem: problem(IDENTITY_NOT_OBJECT, reason), type: "", value: "" };
  }
  const held = { name: entryText(entry.name), position, problem: null, type: entryText(entry.type), value: entryText(entry.value) };
  const found = entryProblem(entry, held);
  if (found) return { ...held, problem: found };
  const { selector } = checkPreviewIdentitySelector(entry);
  return { name: held.name.toLowerCase(), position, problem: null, type: selector.type, value: selector.value };
}

function identityPositionList(positions = []) {
  const labels = positions.map((position) => `identity ${position}`);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0];
}

/**
 * Every entry of a managed app identity list, in its order, checked against
 * the rules a save enforces: `{ position, name, type, value, problem }`, the
 * position counted from 1. A valid entry has problem null and is in its stored
 * form (the name lowercased, an email lowercased). An invalid entry keeps what
 * it holds, trimmed, so it can be shown and fixed, and its problem gives the
 * rule's code and the reason in plain words. Every entry that shares its name
 * with another is invalid, as is every entry past the limit, so nothing is
 * guessed about which of them was meant.
 * @param {unknown[]} entries
 */
function inspectPreviewApplicationIdentities(entries = []) {
  const rows = (Array.isArray(entries) ? entries : []).map((entry, index) => inspectEntry(entry, index + 1));
  const positionsByName = new Map();
  for (const row of rows) {
    if (!row.problem) positionsByName.set(row.name, [...(positionsByName.get(row.name) || []), row.position]);
  }
  return rows.map((row) => {
    if (row.problem) return row;
    const others = positionsByName.get(row.name).filter((position) => position !== row.position);
    if (others.length > 0) {
      const reason = `The name ${quoted(row.name)} is also used by ${identityPositionList(others)}. Each name must be unique.`;
      return { ...row, problem: problem(IDENTITY_NAME_DUPLICATED, reason) };
    }
    if (row.position > PREVIEW_APPLICATION_IDENTITY_LIMIT) {
      const reason = `Only ${PREVIEW_APPLICATION_IDENTITY_LIMIT} identities are allowed, and this is identity ${row.position}.`;
      return { ...row, problem: problem(IDENTITIES_TOO_MANY, reason) };
    }
    return row;
  });
}

/**
 * How text names one entry: `identity 2 ("you")`, or `identity 2` when it has
 * no name; `Identity 2 ("you")` to start a sentence.
 * @param {{ position: number, name?: unknown }} entry
 * @param {{ sentenceStart?: boolean }} [options]
 */
function previewApplicationIdentityLabel({ name = "", position = 0 } = {}, { sentenceStart = false } = {}) {
  const text = entryText(name);
  const word = sentenceStart ? "Identity" : "identity";
  return text ? `${word} ${position} (${quoted(text)})` : `${word} ${position}`;
}

export {
  IDENTITY_FIELDS_UNSUPPORTED,
  PREVIEW_APPLICATION_IDENTITY_LIMIT,
  PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES,
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_TYPES,
  PREVIEW_IDENTITY_SELECTOR_USER_ID,
  checkPreviewIdentitySelector,
  inspectPreviewApplicationIdentities,
  previewApplicationIdentityLabel
};
