import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// The record: what the engine made for one project's environment, keyed by (environment, kind, name), each item with
// the provider's id and name for it, how it came to be, and the size and count it was made or left at; beside them the
// deployment's id, the provider and its project, the environment's choices, approvals and the last plan. The provider
// is its source: everything the engine makes carries Vibe64's labels (`labelsFor`: `vibe64-deployment`, `vibe64-app`,
// `vibe64-environment` and `vibe64-item=<kind>.<name>`), so `rebuildFromLabels` makes it again on another machine or
// after a reinstall, and every Plan refreshes from the provider first. The file is its cache, in the editor's private
// state: one per project and environment (`<root>/<project>/<environment>.json`), written only over the revision the
// writer read (`expectedRevision`), so a writer that read an older one is refused `deployment_record_stale` rather than
// putting back what another wrote since. What labels cannot carry (approvals, the last plan, values kept write-only at
// the provider, the release each service was last handed) is the file's alone: a record made again from labels hands
// each service its release again at the next Deploy.

const FORMAT = "vibe64.deploy-record.v1";
const KINDS = Object.freeze(["service", "resource"]);
const ORIGINS = Object.freeze(["made", "adopted", "referenced"]);
// A Stack item's name (a service's or a resource's id) and an environment's.
const ITEM_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/u;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,39}$/u;
const LABEL = Object.freeze({
  deployment: "vibe64-deployment",
  app: "vibe64-app",
  environment: "vibe64-environment",
  item: "vibe64-item"
});
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** An error the record refuses with: `code` and `details` say why. */
class RecordError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RecordError";
    this.code = code;
    this.details = details;
  }
}

/** The key of an item in its environment's record. @param {string} kind @param {string} name */
const itemKey = (kind, name) => `${kind}.${name}`;

/** A new deployment's id: `dep_` and 16 base32 characters. */
function newDeploymentId() {
  return `dep_${[...randomBytes(16)].map((byte) => BASE32[byte % 32]).join("")}`;
}

/**
 * An empty record for a project's environment at a provider, with a new deployment id.
 * @param {{ app: string, environment: string, provider: { id: string, project: string, organisation?: string | null } }} start
 */
function newRecord({ app, environment, provider }) {
  return {
    format: FORMAT,
    revision: 0,
    app,
    environment,
    deploymentId: newDeploymentId(),
    provider: { id: provider.id, organisation: provider.organisation ?? null, project: provider.project },
    items: {},
    choices: { services: {}, resources: {} },
    approvals: {},
    lastPlan: null,
    updatedAt: null
  };
}

/**
 * The labels an item of the record carries at its provider.
 * @param {{ deploymentId: string, app: string, environment: string }} record @param {{ kind: string, name: string }} item
 */
function labelsFor(record, { kind, name }) {
  return {
    [LABEL.deployment]: record.deploymentId,
    [LABEL.app]: record.app,
    [LABEL.environment]: record.environment,
    [LABEL.item]: itemKey(kind, name)
  };
}

/** Why a record can't be kept, or null: its shape, each item under its own key, a provider id recorded once. @param {any} record */
function recordProblem(record) {
  if (!record || typeof record !== "object" || record.format !== FORMAT) return `A record is ${FORMAT}.`;
  if (!ENVIRONMENT.test(String(record.environment))) return "record.environment is a lowercase name such as production.";
  if (typeof record.deploymentId !== "string" || !record.deploymentId) return "record.deploymentId is the deployment's id.";
  if (!record.items || typeof record.items !== "object" || Array.isArray(record.items)) return "record.items is an object of items by <kind>.<name>.";
  const ids = new Map();
  for (const [key, item] of Object.entries(record.items)) {
    if (!KINDS.includes(item?.kind) || !ITEM_NAME.test(String(item?.name)) || key !== itemKey(item.kind, item.name)) {
      return `record.items.${key} is a service or resource under its own <kind>.<name>.`;
    }
    if (!ORIGINS.includes(item.origin)) return `record.items.${key}.origin is one of ${ORIGINS.join(", ")}.`;
    if (item.id) {
      if (ids.has(item.id)) return `record.items.${key} and record.items.${ids.get(item.id)} record the same thing, ${item.id}.`;
      ids.set(item.id, key);
    }
  }
  return null;
}

/**
 * The record file store: each project's environments' records under `root`, the editor's private state.
 * @param {{ root: string, now?: () => Date }} options
 */
function createRecordStore({ root, now = () => new Date() }) {
  if (!path.isAbsolute(String(root ?? ""))) throw new TypeError("The record store's root is an absolute folder.");

  /** The file of a project's environment's record. @param {string} project @param {string} environment */
  function fileOf(project, environment) {
    if (typeof project !== "string" || !project) throw new TypeError("A record belongs to a project.");
    if (!ENVIRONMENT.test(String(environment))) throw new TypeError("An environment is a lowercase name such as production.");
    return path.join(root, encodeURIComponent(project), `${environment}.json`);
  }

  /** The record as the file holds it, or null when there is none. */
  function readFile(file) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    return JSON.parse(text);
  }

  /**
   * A project's environment's record, or null when there is none.
   * @param {{ project: string, environment: string }} where
   */
  async function read({ project, environment }) {
    return readFile(fileOf(project, environment));
  }

  /**
   * Keeps a project's environment's record over the revision the writer read (`expectedRevision`, 0 when there was
   * none): refused `deployment_record_stale` when the file holds another, else written whole as the next revision.
   * The check and the write run with nothing between them, and the file is replaced at once, never half written.
   * @param {{ project: string, environment: string, record: any, expectedRevision: number }} write
   * @returns {Promise<any>} the record as kept, with its new revision
   */
  async function write({ project, environment, record, expectedRevision }) {
    const file = fileOf(project, environment);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("expectedRevision is the revision read, 0 when there was none.");
    const problem = recordProblem(record);
    if (problem) throw new RecordError("deployment_record_invalid", problem);
    if (record.environment !== environment) throw new RecordError("deployment_record_invalid", `The record is ${record.environment}'s, not ${environment}'s.`);
    const current = readFile(file)?.revision ?? 0;
    if (current !== expectedRevision) {
      throw new RecordError(
        "deployment_record_stale",
        `The ${environment} record changed since it was read (revision ${current}, not ${expectedRevision}): read it again, then decide again.`,
        { expected: expectedRevision, current }
      );
    }
    const kept = { ...structuredClone(record), revision: current + 1, updatedAt: now().toISOString() };
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    return kept;
  }

  return Object.freeze({ read, write, fileOf });
}

/**
 * The records of a provider project made again from the labels Vibe64 wrote on what it made: one per deployment id,
 * each item from the thing labelled with it (its id, name, size and, for a service, its count), the choices from those
 * sizes and counts. Things without Vibe64's labels are not Vibe64's and are left out. Two things labelled as the same
 * item of one deployment, or one deployment's things naming two apps or environments, are refused
 * `deployment_labels_conflict`: the labels were changed outside Vibe64.
 * @param {{ provider: string, inventory: (where: { project: string }) => Promise<Array<{ id: string, name: string, labels: Record<string, string>, size?: string | null, instances?: number | null }>> }} adapter
 *   `inventory` answers every thing of the provider project with its labels
 * @param {string} project the provider's project
 * @param {{ app?: string, environment?: string, organisation?: string | null }} [only] keeps the records of this app or environment alone
 * @returns {Promise<any[]>} the records, by deployment id, each at revision 0
 */
async function rebuildFromLabels(adapter, project, { app, environment, organisation = null } = {}) {
  const records = new Map();
  for (const thing of await adapter.inventory({ project })) {
    const labels = thing.labels ?? {};
    const deploymentId = labels[LABEL.deployment];
    const item = /^(service|resource)\.(.+)$/u.exec(labels[LABEL.item] ?? "");
    if (!deploymentId || !item || !ITEM_NAME.test(item[2])) continue;
    if ((app && labels[LABEL.app] !== app) || (environment && labels[LABEL.environment] !== environment)) continue;
    const record = records.get(deploymentId) ?? {
      ...newRecord({ app: labels[LABEL.app], environment: labels[LABEL.environment], provider: { id: adapter.provider, organisation, project } }),
      deploymentId
    };
    records.set(deploymentId, record);
    if (record.app !== labels[LABEL.app] || record.environment !== labels[LABEL.environment]) {
      throw new RecordError("deployment_labels_conflict", `${thing.id} is labelled ${labels[LABEL.app]} ${labels[LABEL.environment]} in ${deploymentId}, which is ${record.app} ${record.environment}.`, { deploymentId, id: thing.id });
    }
    const [, kind, name] = item;
    const key = itemKey(kind, name);
    if (record.items[key]) {
      throw new RecordError("deployment_labels_conflict", `${record.items[key].id} and ${thing.id} are both labelled ${key} of ${deploymentId}.`, { deploymentId, item: key, ids: [record.items[key].id, thing.id] });
    }
    const size = thing.size ?? null;
    if (kind === "service") {
      const instances = thing.instances ?? null;
      record.items[key] = { kind, name, id: thing.id, providerName: thing.name, origin: "made", size, instances };
      record.choices.services[name] = { size, instances };
    } else {
      record.items[key] = { kind, name, id: thing.id, providerName: thing.name, origin: "made", size };
      record.choices.resources[name] = { size };
    }
  }
  return [...records.values()].sort((one, other) => (one.deploymentId < other.deploymentId ? -1 : 1));
}

export { FORMAT, LABEL, RecordError, createRecordStore, itemKey, labelsFor, newDeploymentId, newRecord, rebuildFromLabels, recordProblem };
