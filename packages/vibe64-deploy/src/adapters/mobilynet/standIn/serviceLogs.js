// An App Service's logs as mobilynet's stand-in answers them (openApiServices.js readServiceLogs, its machines package's
// serviceLogs.js, main 17340a6a): one page of its instances' lines merged in time order, of every instance live or
// removed in the last 2 days (a release task's among them), `only` those named or all `except` those (by name or id;
// one it has no logs of is `422` naming it), at most 20 of them. A page is the newest `lines` (200 when absent, 1 to
// 1000) before `until` or a `before` cursor, or the oldest after an `after` cursor, `unit` one of the app's services
// alone (its start and checks left out), `since` and `text` (any case) narrowing it. Read from the instances' hosts
// by operations: the first ask answers `202` with them running; once the stand-in moved on (`advance()`) the same ask
// answers `200` with the page, a first page for 30 seconds. Each line is `{ at, instance, name, unit, text, error }`,
// `unit` its service or `start` (a release task's, which runs as its machine's start), `error` whether it reads as
// one, each of the service's secrets masked as `[secret]`. What an instance printed is a test's (`set`), else one line
// naming its start.
// STAND-IN ONLY: a line's time is when the stand-in first read or was given it, one microsecond after the last, and a
// line is an error by its words alone (no journald priority); a cursor carries that time only; every instance's host
// reads it (no `error` on an instance).

const PAGE_LINES = 200;
const MAX_LINES = 1000;
const MAX_INSTANCES = 20;
const MAX_NAMES = 20;
const MAX_TEXT = 200;
const FRESH_MS = 30_000;
// What one ask of a page is, to tell one read from another.
const LOGS_ASKED = Object.freeze(["only", "except", "unit", "since", "until", "text", "lines", "before", "after"]);
const ERROR_WORDS = /\b(?:error|fatal|panic|exception|traceback|critical|uncaught|failed)\b/iu;

/** An ISO time to the microsecond, from microseconds since the epoch. @param {number} micros */
function isoOf(micros) {
  const seconds = Math.floor(micros / 1_000_000);
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}.${String(micros % 1_000_000).padStart(6, "0")}Z`;
}

/**
 * @param {{ failure: Function, answer: Function, nextId: (prefix: string) => string, at: () => string, now: () => Date }} world
 * @param {Map<string, any>} instances each instance of the stand-in's App Services, by id
 * @param {(instance: any) => any} declarationOf the declaration of the release an instance runs
 */
function createStandInServiceLogs({ failure, answer, nextId, at, now }, instances, declarationOf) {
  /** @type {Map<string, Array<{ micros: number, unit: string, text: string }>>} each instance's lines, oldest first */
  const kept = new Map();
  /** @type {Map<string, any>} each instance's read of an ask: its operation, running until the stand-in moves on */
  const reads = new Map();
  let lastMicros = 0;
  const invalid = (field, message) => failure(422, "validation_failed", `Check ${field}.`, { fieldErrors: { [field]: message } });

  /** The unit an instance's lines are of: a release task's instance's start, else its declaration's first service. */
  const unitOf = (instance) => (instance.task ? "start" : declarationOf(instance)?.services?.[0]?.name ?? "app");

  /** An instance's lines, made once from what it printed. @param {any} instance @param {string} [text] */
  function linesOf(instance, text) {
    if (kept.has(instance.id) && text === undefined) return kept.get(instance.id);
    const printed = text ?? `${instance.name}: started ${instance.version}\n`;
    const base = Math.max(lastMicros + 1, Date.parse(at()) * 1000);
    const lines = (printed.endsWith("\n") ? printed.slice(0, -1) : printed).split("\n")
      .map((line, index) => ({ micros: base + index, unit: unitOf(instance), text: line }));
    lastMicros = base + lines.length;
    kept.set(instance.id, lines);
    return lines;
  }

  /** A list query value (`a,b`) as names. */
  const namesOf = (value) => [...new Set(String(value ?? "").split(",").map((name) => name.trim()).filter(Boolean))];

  /** A page's cursor: opaque to its reader. */
  const cursorOf = (serviceId, forward, micros) => Buffer.from(JSON.stringify({ s: serviceId, d: forward ? "f" : "b", t: isoOf(micros) })).toString("base64url");
  function decoded(value, serviceId, forward) {
    try {
      const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
      if (cursor?.s === serviceId && cursor.d === (forward ? "f" : "b") && !Number.isNaN(Date.parse(cursor.t))) {
        const fraction = Number(/\.([0-9]{6})Z$/u.exec(cursor.t)?.[1] ?? 0);
        return Math.floor(Date.parse(cursor.t) / 1000) * 1_000_000 + fraction;
      }
    } catch {
      // Refused below.
    }
    return null;
  }

  /** `GET /v1/services/{id}/logs`. @param {any} service @param {URLSearchParams} params */
  function read(service, params) {
    const lines = params.has("lines") ? Number(params.get("lines")) : PAGE_LINES;
    if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LINES) return invalid("lines", `A whole number from 1 to ${MAX_LINES}.`);
    const text = params.get("text") || null;
    if (text !== null && text.length > MAX_TEXT) return invalid("text", `At most ${MAX_TEXT} characters.`);
    const times = {};
    for (const field of ["since", "until"]) {
      const value = params.get(field);
      if (value && Number.isNaN(Date.parse(value))) return invalid(field, "A time, such as 2026-11-15T09:00:00Z.");
      times[field] = value ? Date.parse(value) * 1000 : null;
    }
    if (params.get("before") && params.get("after")) return invalid("after", "A page goes before one cursor or after another, not both.");
    const forward = Boolean(params.get("after"));
    const cursorField = forward ? "after" : "before";
    const cursor = params.get(cursorField) ? decoded(params.get(cursorField), service.id, forward) : null;
    if (params.get(cursorField) && cursor === null) return invalid(cursorField, `A cursor this service's logs gave as ${cursorField}.`);

    const candidates = [...instances.values()].filter((one) => one.serviceId === service.id
      && (one.rotation !== "gone" || Date.parse(one.logsUntil) > now().getTime())).reverse();
    const named = (name) => candidates.find((one) => one.name === name || one.id === name);
    const only = namesOf(params.get("only"));
    const except = namesOf(params.get("except"));
    for (const [field, names] of [["only", only], ["except", except]]) {
      if (names.length > MAX_NAMES) return invalid(field, `At most ${MAX_NAMES} instances.`);
      const missing = names.filter((name) => !named(name));
      if (missing.length > 0) return invalid(field, `This service has no instance ${missing.join(", ")} with logs kept (live, or removed within 2 days).`);
    }
    const left = new Set(except.map((name) => named(name).id));
    const chosen = (only.length > 0 ? only.map(named) : candidates).filter((one) => !left.has(one.id));
    const units = [...new Set(chosen.flatMap((one) => (declarationOf(one)?.services ?? []).map((entry) => entry.name)))].sort();
    const unit = params.get("unit") || null;
    if (unit !== null && !units.includes(unit)) return invalid("unit", `One of the app's services: ${units.join(", ") || "none"}.`);
    const running = chosen.filter((one) => one.rotation !== "gone");
    if (running.length > MAX_INSTANCES) {
      return invalid("only", `${running.length} of the chosen instances ran at ${at()}; a page reads at most ${MAX_INSTANCES}: name them with only, or leave some out with except.`);
    }
    const read = chosen.slice(0, MAX_INSTANCES);

    const asked = LOGS_ASKED.map((name) => params.get(name) ?? "").join("\n");
    const operations = read.map((instance) => {
      const key = `${instance.id}\n${asked}`;
      let operation = reads.get(key);
      const stale = operation?.state === "succeeded" && !cursor && now().getTime() - Date.parse(operation.finishedAt) >= FRESH_MS;
      if (!operation || stale) {
        operation = { id: nextId("op"), kind: "app_logs", state: "running", error: null, createdAt: at(), finishedAt: null };
        reads.set(key, operation);
      }
      return operation;
    });
    const instancesView = read.map((one) => ({ id: one.id, name: one.name, live: one.rotation !== "gone", removedAt: one.removedAt ?? null, error: null }));
    if (operations.some((operation) => operation.state === "running")) {
      return answer(202, { instances: instancesView, units, lines: null, before: null, after: null, more: false, readAt: null, operations: operations.map((one) => ({ ...one })) });
    }

    const secrets = Object.values(service.secrets ?? {}).filter(Boolean).map(String);
    const masked = (line) => secrets.reduce((done, secret) => done.split(secret).join("[secret]"), line);
    const all = read.flatMap((instance) => linesOf(instance).map((line, index) => ({ ...line, instance, index })))
      .filter((line) => (unit === null || line.unit === unit)
        && (times.since === null || line.micros >= times.since) && (times.until === null || line.micros <= times.until)
        && (cursor === null || (forward ? line.micros > cursor : line.micros < cursor))
        && (text === null || masked(line.text).toLowerCase().includes(text.toLowerCase())))
      .sort((one, other) => one.micros - other.micros || (one.instance.id < other.instance.id ? -1 : 1) || one.index - other.index);
    const page = forward ? all.slice(0, lines) : all.slice(-lines);
    const newest = page.at(-1)?.micros ?? Date.parse(at()) * 1000;
    return answer(200, {
      instances: instancesView,
      units,
      lines: page.map((line) => {
        const shown = masked(line.text);
        return { at: isoOf(line.micros), instance: line.instance.id, name: line.instance.name, unit: line.unit, text: shown, error: ERROR_WORDS.test(shown) };
      }),
      before: !forward && all.length > page.length ? cursorOf(service.id, false, page[0].micros) : null,
      after: forward ? cursorOf(service.id, true, page.at(-1)?.micros ?? cursor) : cursor === null ? cursorOf(service.id, true, newest) : null,
      more: forward && all.length > page.length,
      readAt: operations.map((operation) => operation.finishedAt).sort().at(-1) ?? null,
      operations: operations.map((one) => ({ ...one }))
    });
  }

  /** Every read asked so far ends: its next ask answers the page. */
  function advance() {
    for (const operation of reads.values()) {
      if (operation.state === "running") Object.assign(operation, { state: "succeeded", finishedAt: at() });
    }
  }

  return Object.freeze({
    read,
    advance,
    /** What an instance printed, its lines from now. @param {string} instanceId @param {string} text */
    set: (instanceId, text) => {
      const instance = instances.get(instanceId);
      if (instance) linesOf(instance, String(text));
    }
  });
}

export { createStandInServiceLogs };
