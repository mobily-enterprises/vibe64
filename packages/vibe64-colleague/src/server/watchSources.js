// What Colleague can watch besides a project's own coding conversations,
// which are built in (a watch without a source). Owners register the rest by
// composition, through the Colleague service:
// - a conversation source reads another conversation (Online's System
//   repair), observed exactly like a coding one;
// - a state source reads something that is not a conversation (a hosted
//   deployment; local or hosted publication; app usage once something records
//   it) and answers { fingerprint, summary, conditionsMet }.
// A source only reads, under the watcher's own authority. Polling, debounce,
// wakes and Learn scoping stay in the service, the same for every source.

const SOURCE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const NAME = /^[a-z][A-Za-z0-9-]{0,63}$/u;
const MAX_INPUT = 512;

function failure(message, statusCode = 422) {
  return Object.assign(new Error(message), { code: "vibe64_colleague_watch_source", statusCode });
}
function descriptions(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.entries(value).some(([name, text]) => !NAME.test(name) || typeof text !== "string" || !text.trim())) {
    throw new TypeError(`A watch source describes each ${what} by name.`);
  }
  return Object.freeze({ ...value });
}

function createWatchSources() {
  const sources = new Map();
  function add(id, source) {
    if (!SOURCE_ID.test(id) || sources.has(id)) throw new TypeError("A watch source needs a unique name.");
    sources.set(id, Object.freeze({ id, ...source }));
  }
  return Object.freeze({
    registerConversation(id, read) {
      if (typeof read !== "function") throw new TypeError("A conversation source needs an authorized reader.");
      add(id, { kind: "conversation", read });
    },
    // scope "project": the watch names one project (input.projectSlug), whose
    // ordinary access and Learn/Develop rule apply to every read. "studio":
    // nothing project-specific. `entity`: the realtime entity whose change
    // events (entityId = the project) make a watch read again soon.
    register({ id, label, description, scope = "project", input = {}, conditions, read, entity = "" } = {}) {
      if (typeof read !== "function" || typeof label !== "string" || !label.trim() ||
          typeof description !== "string" || !description.trim() || !["project", "studio"].includes(scope) ||
          typeof entity !== "string") {
        throw new TypeError("A watch source needs a label, a description, its scope and an authorized reader.");
      }
      const fields = descriptions(input, "input");
      if (scope === "project" && !fields.projectSlug) throw new TypeError("A project watch source takes projectSlug.");
      const named = descriptions(conditions, "condition");
      if (!Object.keys(named).length) throw new TypeError("A watch source offers at least one condition.");
      add(id, { kind: "state", label: label.trim(), description: description.trim(), scope, input: fields,
        conditions: named, read, ...(entity ? { entity } : {}) });
    },
    get: id => sources.get(id) || null,
    readsEntity: entity => Boolean(entity) && [...sources.values()].some(source => source.entity === entity),
    // What the assistant may watch through watch.source.create.
    list: () => [...sources.values()].filter(source => source.kind === "state")
      .map(({ id, label, description, scope, input, conditions }) => ({ source: id, label, description, scope,
        input: { ...input }, conditions: { ...conditions } }))
  });
}

// A state watch's input: exactly the source's declared fields, each a short
// non-empty string.
function stateWatchInput(source, input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  const declared = Object.keys(source.input);
  const expected = declared.length ? declared.join(", ") : "no input";
  if (!value || Object.keys(value).some(key => !declared.includes(key))) throw failure(`A ${source.label} watch takes ${expected}.`);
  const normalized = {};
  for (const key of declared) {
    const text = typeof value[key] === "string" ? value[key].trim() : "";
    if (!text || text.length > MAX_INPUT) throw failure(`A ${source.label} watch takes ${expected}.`);
    normalized[key] = text;
  }
  return normalized;
}

function stateObservation(source, value) {
  if (value?.ok === false) throw failure(String(value.error || `The ${source.label} could not be read.`).slice(0, 512), value.statusCode || 409);
  const fingerprint = typeof value?.fingerprint === "string" ? value.fingerprint : "";
  if (!fingerprint || fingerprint.length > 4096) throw failure(`The ${source.label} reader gave no usable answer.`, 502);
  const met = Array.isArray(value.conditionsMet) ? value.conditionsMet : [];
  return { fingerprint, summary: String(value.summary || "").slice(0, 1000),
    conditionsMet: Object.keys(source.conditions).filter(name => met.includes(name)) };
}

// "changed" reports any change after the first reading; any other condition
// reports when it becomes true, including on the first reading (asking "tell
// me when my app is live" about a live app answers at once).
function stateWatchUpdate(watch, observation) {
  const previous = watch.cursor;
  const cursor = { fingerprint: observation.fingerprint, conditionsMet: observation.conditionsMet };
  if (watch.condition === "changed") return { cursor, reason: previous && previous.fingerprint !== cursor.fingerprint ? "changed" : "" };
  const met = cursor.conditionsMet.includes(watch.condition);
  const wasMet = previous?.conditionsMet?.includes(watch.condition) === true;
  return { cursor, reason: met && !wasMet ? watch.condition : "" };
}

export { createWatchSources, stateObservation, stateWatchInput, stateWatchUpdate };
