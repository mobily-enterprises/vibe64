// A problem report (Report a problem): what the editor saw around a problem, as one self-contained bundle the person
// reviews before it goes anywhere. Public Vibe64 collects it and offers it to Download or Copy; a host may also deliver
// it, through its own facility. This module is the bundle's one definition for the server that builds it and the page
// that shows it: its schema name, its bounds, and the masking every one of its strings passes through.
//
// Masking is the last step of building a bundle (maskProblemReport): every string value, wherever it sits, has the
// exact secret values the collector knows removed (a project's Env values, a host's own), then every pattern below,
// then is cut to its field's length. Masking before cutting means a cut never leaves part of a secret behind. Keys are
// the bundle's own fixed names and are never masked. A hidden value reads HIDDEN, and the bundle counts them.

const PROBLEM_REPORT_SCHEMA = "vibe64.problem-report.v1";
const PROBLEM_REPORT_MASKING_RULES = "v1";
const HIDDEN = "[hidden]";

const PROBLEM_REPORT_LIMITS = Object.freeze({
  // The time a report looks back over.
  windowMs: 6 * 60 * 60 * 1000,
  // The newest timeline events of a session in the window.
  events: 1000,
  // The newest turns of a session's chat, described (who, which AI, which role), never their words.
  turns: 40,
  // The newest errors a page saw, kept in memory by the page.
  clientErrors: 50,
  crashes: 20,
  outputs: 10,
  // The newest messages of the chat the person was in, only when they include them.
  messages: 50,
  messageCharacters: 8000,
  noteCharacters: 4000,
  // Every other string.
  textCharacters: 2000,
  // A host's sections and each one's fields.
  hostSections: 8,
  hostFields: 24,
  // The serialized bundle, which a host's delivery may bound further.
  bundleBytes: 768 * 1024,
  // An exact secret value shorter than this is too common to look for.
  secretMinCharacters: 8
});

// The chats whose messages a report can include: the session's main chat.
const PROBLEM_REPORT_CHAT_KINDS = Object.freeze(["main"]);

// The same assignments and credentials Vibe64 removes from its logs (vibe64-core/server/logging.js), and the shapes
// of the tokens people paste most: private keys, JSON Web Tokens and the prefixed tokens of common providers.
const SECRET_ASSIGNMENT = /\b((?:DATABASE[_-]?URL|DSN)|(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:PASSWORD|PASS|PASSPHRASE|TOKEN|SECRET|CREDENTIAL|API[_-]?KEY|API[_-]?TOKEN|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|PRIVATE[_-]?KEY|DSN)[A-Za-z0-9_-]*)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const AUTHORIZATION_VALUE = /\b(authorization|proxy-authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;]+|[^\s,;]+)/giu;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gu;
const COOKIE_LINE = /\b(set-cookie|cookie)\b(\s*:\s*)[^\r\n]+/giu;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^/@\s:]+):([^/@\s]+)@/giu;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu;
const JSON_WEB_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu;
const PREFIXED_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36})\b/gu;

const RULES = Object.freeze([
  [PRIVATE_KEY_BLOCK, () => HIDDEN],
  [COOKIE_LINE, (_match, name, separator) => `${name}${separator}${HIDDEN}`],
  [AUTHORIZATION_VALUE, (_match, name, separator) => `${name}${separator}${HIDDEN}`],
  [BEARER, (_match, scheme) => `${scheme} ${HIDDEN}`],
  [SECRET_ASSIGNMENT, (_match, name, separator) => `${name}${separator}${HIDDEN}`],
  [URL_CREDENTIALS, (_match, scheme) => `${scheme}${HIDDEN}@`],
  [JSON_WEB_TOKEN, () => HIDDEN],
  [PREFIXED_TOKEN, () => HIDDEN]
]);

/**
 * The exact values to look for: each given value as text, trimmed, at least secretMinCharacters long, longest first
 * (so a value that contains another is removed whole), each once.
 * @param {Iterable<unknown>} values
 */
function exactSecrets(values = []) {
  const kept = new Set();
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length >= PROBLEM_REPORT_LIMITS.secretMinCharacters) kept.add(text);
  }
  return [...kept].sort((a, b) => b.length - a.length);
}

function cut(text, max) {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/**
 * A masker: `text(value, max)` masks one string and cuts it to `max`; `hidden` counts what it hid.
 * @param {{ secrets?: Iterable<unknown> }} [options] exact values to hide wherever they appear
 */
function createProblemReportMasker({ secrets = [] } = {}) {
  const exact = exactSecrets(secrets);
  let hidden = 0;

  /**
   * @param {unknown} value
   * @param {number} [max]
   */
  function text(value, max = PROBLEM_REPORT_LIMITS.textCharacters) {
    if (value === undefined || value === null) return "";
    let masked = String(value);
    for (const secret of exact) {
      if (!masked.includes(secret)) continue;
      const parts = masked.split(secret);
      hidden += parts.length - 1;
      masked = parts.join(HIDDEN);
    }
    for (const [pattern, replace] of RULES) {
      masked = masked.replace(pattern, (...match) => {
        const replaced = /** @type {(...parts: string[]) => string} */ (replace)(...match);
        if (replaced !== match[0]) hidden += 1;
        return replaced;
      });
    }
    return cut(masked, max);
  }

  return Object.freeze({
    text,
    get hidden() {
      return hidden;
    }
  });
}

/**
 * One string masked with the patterns and the given exact values, cut to `max`.
 * @param {unknown} value
 * @param {{ secrets?: Iterable<unknown>, max?: number }} [options]
 */
function maskProblemText(value, { secrets = [], max = PROBLEM_REPORT_LIMITS.textCharacters } = {}) {
  return createProblemReportMasker({ secrets }).text(value, max);
}

// The longer strings of a bundle, by their place: the person's note and the chat's messages.
function maxFor(path) {
  if (path === "note") return PROBLEM_REPORT_LIMITS.noteCharacters;
  if (/^chat\.messages\.\d+\.text$/u.test(path)) return PROBLEM_REPORT_LIMITS.messageCharacters;
  return PROBLEM_REPORT_LIMITS.textCharacters;
}

/**
 * The bundle with every string masked and cut, and its `masking` filled in: a new object; finite numbers, booleans and
 * null stay, anything else (functions, undefined, NaN) is left out.
 * @param {Record<string, unknown>} bundle
 * @param {{ secrets?: Iterable<unknown> }} [options]
 */
function maskProblemReport(bundle, { secrets = [] } = {}) {
  const masker = createProblemReportMasker({ secrets });
  function walk(value, path) {
    if (typeof value === "string") return masker.text(value, maxFor(path));
    if (typeof value === "boolean" || value === null) return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
      return value.map((entry, index) => walk(entry, `${path}.${index}`)).filter((entry) => entry !== undefined);
    }
    if (value && typeof value === "object") {
      const kept = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key === "masking") continue;
        const masked = walk(entry, path ? `${path}.${key}` : key);
        if (masked !== undefined) kept[key] = masked;
      }
      return kept;
    }
    return undefined;
  }
  const masked = walk(bundle, "");
  return { ...masked, masking: { rules: PROBLEM_REPORT_MASKING_RULES, hidden: masker.hidden } };
}

/**
 * The bundle with the person's note, masked like the rest of it (patterns, and the exact values given) and counted in
 * its masking. The page adds the note this way for Download and Copy; the server, which knows the exact values, when
 * it sends.
 * @param {Record<string, any>} bundle a masked bundle
 * @param {unknown} note
 * @param {{ secrets?: Iterable<unknown> }} [options]
 */
function withProblemReportNote(bundle, note, { secrets = [] } = {}) {
  const masker = createProblemReportMasker({ secrets });
  const text = masker.text(note ?? "", PROBLEM_REPORT_LIMITS.noteCharacters);
  return {
    ...bundle,
    note: text,
    masking: { rules: PROBLEM_REPORT_MASKING_RULES, hidden: Number(bundle?.masking?.hidden || 0) + masker.hidden }
  };
}

/**
 * The bundle as the file Download saves and Copy copies: indented JSON.
 * @param {Record<string, unknown>} bundle
 */
function problemReportText(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/**
 * The file name Download saves the bundle under: vibe64-problem-report-<time>.json.
 * @param {{ createdAt?: string }} bundle
 */
function problemReportFileName(bundle) {
  const time = String(bundle?.createdAt || "").replace(/[^0-9T]/gu, "").slice(0, 15) || "report";
  return `vibe64-problem-report-${time}.json`;
}

export {
  HIDDEN as PROBLEM_REPORT_HIDDEN,
  PROBLEM_REPORT_CHAT_KINDS,
  PROBLEM_REPORT_LIMITS,
  PROBLEM_REPORT_MASKING_RULES,
  PROBLEM_REPORT_SCHEMA,
  createProblemReportMasker,
  maskProblemReport,
  maskProblemText,
  problemReportFileName,
  problemReportText,
  withProblemReportNote
};
