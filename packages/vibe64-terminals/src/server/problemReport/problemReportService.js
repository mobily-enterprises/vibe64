import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { readVibe64CrashRecords } from "@local/vibe64-core/server/crashRecords";
import { readEnvUserValues } from "@local/vibe64-core/server/envUserValues";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import {
  PROBLEM_REPORT_CHAT_KINDS,
  PROBLEM_REPORT_LIMITS,
  PROBLEM_REPORT_SCHEMA,
  maskProblemReport,
  withProblemReportNote
} from "@local/vibe64-core/shared/problemReport";

// Report a problem (vibe64-core/shared/problemReport.js holds the bundle's definition and masking): `collect` reads
// what the editor saw around the person's problem into one masked bundle, kept as a draft for that person alone while
// they review it; `send` hands exactly that draft, with their note, to the host's delivery. Download and Copy need
// nothing from here: the page has the reviewed bundle. A draft lives in this server's memory only, for DRAFT_MS.

const DRAFT_MS = 30 * 60 * 1000;
const DRAFTS_PER_PERSON = 5;
const DRAFTS_LIMIT = 50;
// The page's own errors, as the page sends them: bounded here whatever it sends.
const CLIENT_ERROR_FIELDS = Object.freeze(["at", "source", "code", "message"]);
// An Env value is looked for, wherever it might appear, when it is marked secret, its name says it is one, or it is
// long enough to be a key or a password.
const SECRET_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|PASS|PASSPHRASE|KEY|CREDENTIAL|DSN|DATABASE_URL|PRIVATE|AUTH|COOKIE|SESSION|SALT|SIGNING|WEBHOOK)/iu;
const LONG_ENV_VALUE = 20;
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function refusal(status, code, message) {
  return new AppError(status, message, { code });
}

// A person as the action context names them (uid and username); a draft is theirs alone.
function personKey(actor) {
  return `${actor.uid ?? actor.id ?? ""}:${actor.username}`;
}

/** @param {any} actor */
function requirePerson(actor) {
  if (!actor || typeof actor.username !== "string" || !actor.username) {
    throw refusal(401, "vibe64_problem_report_person_required", "Sign in to report a problem.");
  }
  return actor;
}

/** A package's installed version, found from this file up through node_modules, or null. */
const versions = new Map();
function installedVersion(name) {
  if (versions.has(name)) return versions.get(name);
  let version = null;
  for (let directory = MODULE_DIRECTORY; ; directory = path.dirname(directory)) {
    const file = path.join(directory, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(file)) {
      try {
        version = String(JSON.parse(readFileSync(file, "utf8")).version || "") || null;
      } catch {
        version = null;
      }
      break;
    }
    if (path.dirname(directory) === directory) break;
  }
  versions.set(name, version);
  return version;
}

/** The app's own version: the package.json at the root of the app these packages run in, as turnInterruptions reads it. */
function appVersion() {
  if (versions.has("app")) return versions.get("app");
  let version = null;
  try {
    version = String(JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8")).version || "") || null;
  } catch {
    version = null;
  }
  versions.set("app", version);
  return version;
}

/** @param {any} errors what the page sent */
function clientErrors(errors) {
  return (Array.isArray(errors) ? errors : []).slice(-PROBLEM_REPORT_LIMITS.clientErrors).map((entry) => (
    Object.fromEntries(CLIENT_ERROR_FIELDS.map((field) => [field, typeof entry?.[field] === "string" ? entry[field] : ""]))
  ));
}

/** @param {any} section what the host said of one of its pages */
function hostSection(section) {
  const fields = section?.fields && typeof section.fields === "object" ? section.fields : {};
  return {
    id: String(section?.id || ""),
    title: String(section?.title || ""),
    state: typeof section?.state === "string" ? section.state : "",
    lastError: section?.lastError && typeof section.lastError === "object"
      ? { code: String(section.lastError.code || ""), message: String(section.lastError.message || ""), at: String(section.lastError.at || "") }
      : null,
    fields: Object.fromEntries(Object.entries(fields).slice(0, PROBLEM_REPORT_LIMITS.hostFields)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null))
  };
}

/** The exact values the masking hides: the project's Env values that are, or may be, secrets. */
async function projectSecrets(projectRuntimeRoot) {
  if (!projectRuntimeRoot) return [];
  const { records } = await readEnvUserValues({ projectRuntimeRoot });
  return records
    .filter((record) => typeof record.value === "string" && record.value.trim())
    .filter((record) => record.secret === true || SECRET_ENV_NAME.test(record.key) || record.value.trim().length >= LONG_ENV_VALUE)
    .map((record) => record.value);
}

/**
 * Keeps the bundle within its size by leaving out the oldest of what is longest: timeline events, then turns, then
 * chat messages, halving each until it fits.
 * @param {any} bundle
 */
function withinSize(bundle) {
  const size = () => Buffer.byteLength(JSON.stringify(bundle));
  const lists = [["session", "events"], ["session", "turns"], ["chat", "messages"]];
  for (const [part, list] of lists) {
    while (size() > PROBLEM_REPORT_LIMITS.bundleBytes && Array.isArray(bundle[part]?.[list]) && bundle[part][list].length) {
      bundle[part][list] = bundle[part][list].slice(Math.ceil(bundle[part][list].length / 2));
      bundle.trimmed = true;
    }
  }
  return bundle;
}

/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./problemReportSession.js").createProblemReportSessionReader>} dependencies.sessions
 * @param {import("./problemReportHost.js").ProblemReportHost} dependencies.host
 * @param {(user: object | null | undefined) => object | null} dependencies.reporter who reports: the signed-in person
 *   an action's input names (`vibe64User`), or whom the host's absence lets stand for this computer's person; null
 *   refuses
 * @param {string} [dependencies.systemRoot] the editor's system root, where its crash records are
 * @param {() => number} [dependencies.now]
 */
function createProblemReportService({ sessions, host, reporter, systemRoot = "", now = Date.now }) {
  /** @type {Map<string, { person: string, bundle: any, secrets: string[], place: any, expiresAt: number }>} */
  const drafts = new Map();

  function forget(at) {
    for (const [id, draft] of drafts) if (draft.expiresAt <= at) drafts.delete(id);
  }

  function keep(draft) {
    const mine = [...drafts].filter(([, entry]) => entry.person === draft.person);
    for (const [id] of mine.slice(0, Math.max(0, mine.length - DRAFTS_PER_PERSON + 1))) drafts.delete(id);
    while (drafts.size >= DRAFTS_LIMIT) drafts.delete(drafts.keys().next().value);
    const id = randomUUID();
    drafts.set(id, draft);
    return id;
  }

  // The editor's crashes in the window: when, what kind and the error's name and code. Never its message, which is the
  // whole server's and may hold any project's values, not only the ones this report knows to hide: the Crashes page
  // keeps it.
  async function crashes(since) {
    if (!systemRoot) return [];
    const { records = [] } = await readVibe64CrashRecords({ systemRoot }).catch(() => ({}));
    return records.filter((record) => Date.parse(record.at) >= since).slice(0, PROBLEM_REPORT_LIMITS.crashes).map((record) => ({
      id: String(record.id || ""),
      at: String(record.at || ""),
      kind: String(record.kind || ""),
      name: String(record.error?.name || ""),
      code: String(record.error?.code || "")
    }));
  }

  /**
   * Collects a report of what the editor saw around the person's problem, for them to review: of the workspace's
   * editor, or with `project`, of that project and the session it names.
   * @param {any} input `{ page, route, sessionId?, chat?, includeChat?, client?, vibe64User }`
   * @param {{ projectSlug?: string, projectRuntimeRoot?: string }} [project]
   */
  async function collect(input, { projectSlug = "", projectRuntimeRoot = "" } = {}) {
    const person = requirePerson(reporter(input.vibe64User));
    const at = now();
    forget(at);
    const since = at - PROBLEM_REPORT_LIMITS.windowMs;
    const sessionId = projectSlug ? String(input.sessionId || "") : "";
    const chatKind = PROBLEM_REPORT_CHAT_KINDS.includes(input.chat?.kind) ? input.chat.kind : "";
    const includeChat = Boolean(sessionId && chatKind && input.includeChat === true);
    const place = {
      page: String(input.page || ""),
      route: String(input.route || ""),
      projectSlug,
      sessionId,
      chat: sessionId && chatKind ? { kind: chatKind, id: String(input.chat?.id || "") } : null
    };
    const [session, serverCrashes, contribution, envSecrets] = await Promise.all([
      // A session this project can't read (gone, or never its own) is named as unreadable; the report still comes.
      sessionId
        ? sessions.read(sessionId, { since, until: at + 1, includeChat })
          .catch((error) => ({ sessionId, unreadable: String(error?.code || "vibe64_problem_report_session_unreadable") }))
        : null,
      crashes(since),
      host.contribute({ actor: person, place }).catch((error) => ({ unreadable: String(error?.code || "vibe64_problem_report_host_unreadable") })),
      projectSecrets(projectRuntimeRoot)
    ]);
    const chat = session?.chat || null;
    if (session) delete session.chat;
    const bundle = withinSize({
      schema: PROBLEM_REPORT_SCHEMA,
      reportId: randomUUID(),
      createdAt: new Date(at).toISOString(),
      window: { from: new Date(since).toISOString(), to: new Date(at).toISOString() },
      reporter: { username: String(person.username || ""), role: String(person.role || "") },
      place,
      note: "",
      versions: {
        app: appVersion(),
        jskit: installedVersion("@jskit-ai/kernel"),
        genesis: installedVersion("genesis-compiler"),
        node: process.version,
        engine: session?.engine && !session.engine.unreadable ? session.engine : null,
        host: contribution?.versions && typeof contribution.versions === "object"
          ? Object.fromEntries(Object.entries(contribution.versions).filter(([, value]) => typeof value === "string"))
          : {}
      },
      client: {
        userAgent: String(input.client?.userAgent || ""),
        viewport: String(input.client?.viewport || ""),
        language: String(input.client?.language || ""),
        timeZone: String(input.client?.timeZone || ""),
        errors: clientErrors(input.client?.errors)
      },
      server: { crashes: serverCrashes },
      session,
      host: contribution?.unreadable
        ? [{ id: "host", title: "", state: "", lastError: { code: contribution.unreadable, message: "", at: "" }, fields: {} }]
        : (Array.isArray(contribution?.sections) ? contribution.sections : [])
            .slice(0, PROBLEM_REPORT_LIMITS.hostSections).map(hostSection),
      chat: includeChat ? { kind: chatKind, id: place.chat.id, messages: chat?.messages ?? [] } : null
    });
    const secrets = [...envSecrets, ...(Array.isArray(contribution?.secrets) ? contribution.secrets : [])];
    const masked = maskProblemReport(bundle, { secrets });
    const draftId = keep({ person: personKey(person), bundle: masked, secrets, place, expiresAt: at + DRAFT_MS });
    const delivery = await host.delivery({ actor: person }).catch(() => null);
    return { ok: true, draftId, bundle: masked, delivery };
  }

  /**
   * Collects a report in the project the request is for (its route's).
   * @param {any} input as collect's
   */
  function collectInProject(input) {
    const project = currentProjectRequestContext();
    return collect(input, { projectSlug: String(project?.slug || ""), projectRuntimeRoot: String(project?.projectRuntimeRoot || "") });
  }

  /**
   * Sends the draft the person reviewed, with their note, through the host's delivery.
   * @param {any} input `{ draftId, note?, consents?, vibe64User }`
   */
  async function send(input) {
    const person = requirePerson(reporter(input.vibe64User));
    forget(now());
    const draft = drafts.get(String(input.draftId || ""));
    if (!draft || draft.person !== personKey(person)) {
      throw refusal(404, "vibe64_problem_report_draft_missing", "This report's review has expired. Open Report a problem again.");
    }
    const delivery = await host.delivery({ actor: person });
    if (!delivery) {
      throw refusal(409, "vibe64_problem_report_no_delivery", "This editor sends problem reports nowhere: download or copy the report instead.");
    }
    const declared = new Set((Array.isArray(delivery.consents) ? delivery.consents : []).map((consent) => consent.id));
    const consents = Object.fromEntries([...declared].map((id) => [id, input.consents?.[id] === true]));
    const bundle = withProblemReportNote(draft.bundle, input.note || "", { secrets: draft.secrets });
    const result = await host.deliver({ bundle, consents, actor: person, place: draft.place });
    drafts.delete(String(input.draftId));
    return { ok: true, reference: String(result?.reference || ""), message: String(result?.message || "") };
  }

  return Object.freeze({
    collect,
    collectInProject,
    send
  });
}

export { DRAFT_MS, createProblemReportService };
