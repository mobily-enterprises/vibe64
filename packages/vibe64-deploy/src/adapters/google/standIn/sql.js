import { randomUUID } from "node:crypto";

import { labelsProblem } from "./platform.js";

// The stand-in's Cloud SQL Admin API v1: instances (made on a private address of a peered network, read, listed,
// patched, deleted once their deletion protection is off), their logins and databases, and the operations each write
// answers, which end at the next advance. An instance runs one operation at a time: a write while one runs answers 409.
// An instance's name stays taken for a week after it is deleted, as Google keeps it.

const INSTANCE_NAME = /^[a-z][a-z0-9-]{0,96}[a-z0-9]$/u;
const VERSIONS = new Set(["POSTGRES_16", "POSTGRES_17", "POSTGRES_18", "MYSQL_8_0", "MYSQL_8_4"]);
const CUSTOM_TIER = /^db-custom-(\d+)-(\d+)$/u;

function createStandInSql(world) {
  const { project, region, answer, legacy } = world;
  /** @type {Map<string, { instance: any, users: Map<string, string>, databases: Set<string> }>} */
  const instances = new Map();
  /** @type {Map<string, any>} by name */
  const operations = new Map();
  /** @type {Set<string>} names of instances deleted */
  const deleted = new Set();
  let address = 2;

  const selfLink = (path) => `https://sqladmin.googleapis.com/v1/projects/${project}/${path}`;
  const invalid = (message) => legacy(400, "invalid", message);

  /** A PENDING operation on an instance, done at the next advance (then `finish` runs). */
  function operation(type, name, finish = () => {}) {
    const id = randomUUID();
    const op = {
      kind: "sql#operation", name: id, operationType: type, status: "PENDING", targetId: name, targetProject: project, targetLink: selfLink(`instances/${name}`),
      insertTime: world.at(), user: "deploy@standin", selfLink: selfLink(`operations/${id}`), finish
    };
    operations.set(id, op);
    return answer(200, view(op));
  }
  const view = (op) => {
    const shown = { ...op };
    delete shown.finish;
    return structuredClone(shown);
  };
  const busy = (name) => [...operations.values()].some((op) => op.targetId === name && op.status !== "DONE");
  const inProgress = () => legacy(409, "operationInProgress", "Operation failed because another operation was already in progress. Try your request after the current operation is complete.");

  /** Why Cloud SQL refuses an insert, or null. */
  function refusal(body) {
    const settings = body.settings ?? {};
    if (!INSTANCE_NAME.test(String(body.name ?? ""))) return "Invalid instance name.";
    if (!VERSIONS.has(body.databaseVersion)) return `Invalid database version ${body.databaseVersion}.`;
    if (body.region !== region) return `Invalid region ${body.region}.`;
    // PostgreSQL 16 and later default to Enterprise Plus, which takes no custom tier.
    const edition = settings.edition ?? (/^POSTGRES_(1[6-9])$/u.test(body.databaseVersion) ? "ENTERPRISE_PLUS" : "ENTERPRISE");
    if (CUSTOM_TIER.test(settings.tier ?? "") && edition !== "ENTERPRISE") return `Invalid Tier (${settings.tier}) for (${edition}) Edition.`;
    const [, vcpus, memory] = CUSTOM_TIER.exec(settings.tier ?? "") ?? [];
    if (!vcpus || Number(memory) % 256 !== 0 || Number(memory) < 3840) return `Invalid tier ${settings.tier}.`;
    const problem = labelsProblem(settings.userLabels);
    if (problem) return problem;
    const network = settings.ipConfiguration?.privateNetwork;
    if (network && !world.platform.peered(network)) {
      return `Failed to create subnetwork. Please create Service Networking connection with service 'servicenetworking.googleapis.com' from consumer project '${project}' network '${network.split("/").pop()}' again.`;
    }
    return null;
  }

  function request({ method, path, query, body }) {
    const match = /^v1\/projects\/([^/]+)\/(instances|operations)(?:\/([^/]+)(?:\/(users|databases))?)?$/u.exec(path);
    if (!match || match[1] !== project) return null;
    const [, , collection, name, sub] = match;
    if (collection === "operations") {
      const op = operations.get(name);
      return op && method === "GET" ? answer(200, view(op)) : legacy(404, "operationDoesNotExist", "The Cloud SQL operation does not exist.");
    }
    if (!name) {
      if (method === "GET") {
        const all = [...instances.values()].map(({ instance }) => instance);
        const size = Math.min(Number(query.get("maxResults") || 500), 500);
        const start = Number(query.get("pageToken") || 0);
        return answer(200, { kind: "sql#instancesList", ...(all.length > start ? { items: structuredClone(all.slice(start, start + size)) } : {}), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
      }
      if (method !== "POST") return null;
      if (instances.has(body?.name) || deleted.has(body?.name)) {
        return invalid("The Cloud SQL instance already exists. When you delete an instance, you can't reuse the name of the deleted instance until one week from the deletion date.");
      }
      const problem = refusal(body ?? {});
      if (problem) return invalid(problem);
      const instance = {
        ...structuredClone(body), kind: "sql#instance", project, state: "PENDING_CREATE", gceZone: `${region}-a`, backendType: "SECOND_GEN", instanceType: "CLOUD_SQL_INSTANCE",
        connectionName: `${project}:${region}:${body.name}`, selfLink: selfLink(`instances/${body.name}`), ipAddresses: [], etag: randomUUID(),
        serviceAccountEmailAddress: `p${world.projectNumber}-abcdef@gcp-sa-cloud-sql.iam.gserviceaccount.com`,
        settings: { ...structuredClone(body.settings), kind: "sql#settings", settingsVersion: "1", dataDiskSizeGb: String(body.settings.dataDiskSizeGb ?? "10") }
      };
      instances.set(body.name, { instance, users: new Map(), databases: new Set(["postgres"].filter(() => body.databaseVersion.startsWith("POSTGRES"))) });
      return operation("CREATE", body.name, () => {
        Object.assign(instance, { state: "RUNNABLE", ipAddresses: [{ type: "PRIVATE", ipAddress: `10.100.0.${(address += 1)}` }] });
      });
    }
    const found = instances.get(name);
    if (!found) return legacy(404, "instanceDoesNotExist", "The Cloud SQL instance does not exist.");
    const { instance } = found;
    if (!sub && method === "GET") return answer(200, structuredClone(instance));
    if (method !== "GET" && busy(name)) return inProgress();
    if (!sub && method === "PATCH") {
      const settings = body?.settings ?? {};
      const problem = labelsProblem(settings.userLabels) ?? (settings.tier && !CUSTOM_TIER.test(settings.tier) ? `Invalid tier ${settings.tier}.` : null);
      if (problem) return invalid(problem);
      const { tier, ...rest } = settings;
      Object.assign(instance.settings, rest);
      if (tier && tier !== instance.settings.tier) {
        instance.state = "MAINTENANCE";
        return operation("UPDATE", name, () => Object.assign(instance, { state: "RUNNABLE", settings: { ...instance.settings, tier } }));
      }
      return operation("UPDATE", name);
    }
    if (!sub && method === "DELETE") {
      if (instance.settings.deletionProtectionEnabled) return invalid("The instance is protected from deletion. Disable deletion protection to delete it.");
      instances.delete(name);
      deleted.add(name);
      return operation("DELETE", name);
    }
    if (sub && instance.state !== "RUNNABLE") return invalid("The instance or operation is not in an appropriate state to handle the request.");
    if (sub === "users") {
      if (method === "GET") return answer(200, { kind: "sql#usersList", items: [...found.users.keys()].map((user) => ({ kind: "sql#user", name: user, instance: name, project })) });
      if (method !== "POST") return null;
      if (!body?.name || !body.password) return invalid("A user needs a name and a password.");
      if (found.users.has(body.name)) return invalid(`User ${body.name} already exists.`);
      return operation("CREATE_USER", name, () => found.users.set(body.name, body.password));
    }
    if (method === "GET") return answer(200, { kind: "sql#databasesList", items: [...found.databases].map((database) => ({ kind: "sql#database", name: database, instance: name, project })) });
    if (method !== "POST") return null;
    if (!body?.name) return invalid("A database needs a name.");
    if (found.databases.has(body.name)) return invalid(`Database ${body.name} already exists.`);
    return operation("CREATE_DATABASE", name, () => found.databases.add(body.name));
  }

  function advance() {
    for (const op of operations.values()) {
      if (op.status === "DONE") continue;
      op.status = "DONE";
      op.endTime = world.at();
      op.finish();
    }
  }

  return {
    request,
    advance,
    controls: Object.freeze({
      instances: () => [...instances.values()].map(({ instance }) => structuredClone(instance)),
      instance: (name) => structuredClone(instances.get(name)?.instance ?? null),
      /** An instance's logins with their passwords, and its databases. */
      users: (name) => Object.fromEntries(instances.get(name)?.users ?? []),
      databases: (name) => [...(instances.get(name)?.databases ?? [])],
      deleted: () => [...deleted]
    })
  };
}

export { createStandInSql };
