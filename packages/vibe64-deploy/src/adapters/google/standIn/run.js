import { createHash, randomUUID } from "node:crypto";

import { labelsProblem } from "./platform.js";

// The stand-in's Cloud Run Admin API v2 services: made, read, listed, patched (the whole service, a new revision each
// time) and deleted, each answering a long-running operation. A revision starts at the next advance and, at the one
// after, as Cloud Run takes a while to start one, gets ready when it could start: its image built into the registry, its service account there and allowed to read every secret its settings
// name, its Direct VPC egress network and subnet there; otherwise it fails, the revision before it still serving.

const SERVICE_ID = /^[a-z]([-a-z0-9]{0,47}[a-z0-9])?$/u;
const INGRESS = new Set(["INGRESS_TRAFFIC_ALL", "INGRESS_TRAFFIC_INTERNAL_ONLY", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER", "INGRESS_TRAFFIC_NONE"]);
// Each CPU count's largest memory, in GiB.
const MEMORY_MAX = Object.freeze({ 1: 4, 2: 8, 4: 16, 8: 32 });
const OUTPUT_ONLY = Object.freeze(["uid", "generation", "createTime", "updateTime", "creator", "lastModifier", "observedGeneration", "terminalCondition", "conditions",
  "latestReadyRevision", "latestCreatedRevision", "trafficStatuses", "uri", "urls", "reconciling", "etag"]);

function createStandInRun(world) {
  const { project, region, answer, error } = world;
  /** @type {Map<string, any>} by name */
  const services = new Map();

  const invalid = (message) => error(400, "INVALID_ARGUMENT", message);
  const pathOfService = (name) => `projects/${project}/locations/${region}/services/${name}`;
  const networkPath = (value) => (String(value).includes("/") ? String(value).slice(String(value).indexOf("projects/")) : `projects/${project}/global/networks/${value}`);
  const subnetPath = (value) => (String(value).includes("/") ? String(value).slice(String(value).indexOf("projects/")) : `projects/${project}/regions/${region}/subnetworks/${value}`);

  /** Why Cloud Run refuses a service's body, or null. */
  function refusal(body) {
    if (body.ingress && !INGRESS.has(body.ingress)) return `Invalid value for ingress: ${body.ingress}.`;
    const problem = labelsProblem(body.labels) ?? labelsProblem(body.template?.labels);
    if (problem) return problem;
    const containers = body.template?.containers ?? [];
    if (containers.length !== 1) return "template.containers must hold one container.";
    const [container] = containers;
    if (!container.image) return "template.containers[0].image is required.";
    const { cpu, memory } = container.resources?.limits ?? {};
    if (cpu !== undefined) {
      const gib = Number(/^(\d+)Gi$/u.exec(String(memory ?? ""))?.[1]);
      if (!MEMORY_MAX[cpu] || !gib || gib > MEMORY_MAX[cpu]) return `Invalid resources: ${cpu} CPU with ${memory} memory.`;
      if (Number(cpu) >= 4 && gib < 2) return "4 CPU or more needs at least 2Gi of memory.";
    }
    const scaling = body.template?.scaling;
    if (scaling && scaling.maxInstanceCount !== undefined && scaling.minInstanceCount > scaling.maxInstanceCount) return "min instances can't be above max instances.";
    if (body.template?.serviceAccount && !world.platform.accountExists(body.template.serviceAccount)) {
      return `Service account ${body.template.serviceAccount} does not exist.`;
    }
    for (const network of body.template?.vpcAccess?.networkInterfaces ?? []) {
      if (network.network && !world.compute.has(networkPath(network.network))) return `Network ${network.network} not found.`;
      if (network.subnetwork && !world.compute.has(subnetPath(network.subnetwork))) return `Subnetwork ${network.subnetwork} not found.`;
    }
    return null;
  }

  /** A secret a setting names, as `{ id, version }`. */
  const secretOf = (ref) => ({ id: String(ref.secret).split("/").pop(), version: ref.version ?? "latest" });

  /** Why the service's latest revision can't start, or []. */
  function revisionProblems(service) {
    const { template } = service;
    const container = template.containers[0];
    const member = `serviceAccount:${template.serviceAccount}`;
    const problems = [];
    if (world.faults.revisionFails) problems.push("The user-provided container failed the configured startup probe checks.");
    if (!world.platform.imageExists(container.image)) problems.push(`Image '${container.image}' not found.`);
    for (const entry of container.env ?? []) {
      if (!entry.valueSource) continue;
      const { id } = secretOf(entry.valueSource.secretKeyRef);
      if (!world.platform.secretExists(id)) problems.push(`Secret projects/${world.projectNumber}/secrets/${id} was not found.`);
      else if (!world.allows(`secrets/${id}`, member, "roles/secretmanager.secretAccessor")) {
        problems.push(`Permission denied on secret: projects/${world.projectNumber}/secrets/${id} for Revision service account ${template.serviceAccount}.`);
      }
    }
    return problems;
  }

  /** The service as Cloud Run answers it. */
  const view = (service) => {
    const shown = structuredClone(service);
    delete shown.problems;
    delete shown.starting;
    return shown;
  };

  /** The next revision of a service: its generation up, reconciling for two advances. */
  function newRevision(service) {
    const generation = Number(service.generation ?? 0) + 1;
    Object.assign(service, {
      generation: String(generation), observedGeneration: String(generation), reconciling: true, starting: true, updateTime: world.at(), etag: `"${randomUUID()}"`,
      latestCreatedRevision: `${service.name.split("/").pop()}-${String(generation).padStart(5, "0")}-${randomUUID().slice(0, 3)}`,
      terminalCondition: { type: "Ready", state: "CONDITION_RECONCILING", lastTransitionTime: world.at() }
    });
  }

  function request({ method, path, query, body }) {
    const list = /^v2\/projects\/([^/]+)\/locations\/([^/]+)\/services$/u.exec(path);
    if (list && world.isProject(list[1]) && list[2] === region) {
      if (method === "GET") {
        const size = Math.min(Number(query.get("pageSize") || 100), 1000);
        const start = Number(query.get("pageToken") || 0);
        const all = [...services.values()];
        return answer(200, { ...(all.length > start ? { services: all.slice(start, start + size).map(view) } : {}), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
      }
      if (method !== "POST") return null;
      const id = query.get("serviceId") ?? "";
      if (!SERVICE_ID.test(id)) return invalid("serviceId must be 1 to 49 lowercase letters, digits or hyphens, starting with a letter.");
      if (services.has(id)) return error(409, "ALREADY_EXISTS", `Resource '${id}' already exists.`);
      const problem = refusal(body ?? {});
      if (problem) return invalid(problem);
      const service = {
        ...structuredClone(body), name: pathOfService(id), uid: randomUUID(), createTime: world.at(), creator: "deploy@standin", lastModifier: "deploy@standin",
        launchStage: "GA", traffic: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }],
        uri: `https://${id}-${createHash("sha256").update(id).digest("hex").slice(0, 10)}-uc.a.run.app`
      };
      newRevision(service);
      services.set(id, service);
      return answer(200, world.operation(`projects/${project}/locations/${region}/operations/${randomUUID()}`, () => view(service)));
    }
    const one = /^v2\/projects\/([^/]+)\/locations\/([^/]+)\/services\/([^/:]+)$/u.exec(path);
    if (!one || !world.isProject(one[1]) || one[2] !== region) return null;
    const service = services.get(one[3]);
    if (!service) return error(404, "NOT_FOUND", `Resource '${one[3]}' of kind 'SERVICE' in region '${region}' in project '${project}' does not exist.`);
    if (method === "GET") return answer(200, view(service));
    if (method === "DELETE") {
      services.delete(one[3]);
      return answer(200, world.operation(`projects/${project}/locations/${region}/operations/${randomUUID()}`, () => view(service)));
    }
    if (method === "PATCH") {
      const problem = refusal(body ?? {});
      if (problem) return invalid(problem);
      const kept = Object.fromEntries(OUTPUT_ONLY.filter((field) => service[field] !== undefined).map((field) => [field, service[field]]));
      const replaced = { ...structuredClone(body), ...kept, name: service.name, launchStage: service.launchStage ?? "GA", traffic: service.traffic };
      services.set(one[3], replaced);
      newRevision(replaced);
      return answer(200, world.operation(`projects/${project}/locations/${region}/operations/${randomUUID()}`, () => view(replaced)));
    }
    return null;
  }

  /** Each reconciling service's revision: started, then ready, or failed with the reason. */
  function advance() {
    for (const service of services.values()) {
      if (!service.reconciling) continue;
      if (service.starting) {
        service.starting = false;
        continue;
      }
      const problems = revisionProblems(service);
      service.reconciling = false;
      if (problems.length === 0) {
        Object.assign(service, {
          latestReadyRevision: service.latestCreatedRevision, terminalCondition: { type: "Ready", state: "CONDITION_SUCCEEDED", lastTransitionTime: world.at() },
          trafficStatuses: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }]
        });
      } else {
        service.terminalCondition = {
          type: "Ready", state: "CONDITION_FAILED", lastTransitionTime: world.at(),
          message: `Revision '${service.latestCreatedRevision}' is not ready and cannot serve traffic. ${problems.join(" ")}`
        };
      }
    }
  }

  return {
    request,
    advance,
    controls: Object.freeze({
      services: () => [...services.values()].map(view),
      service: (name) => (services.has(name) ? view(services.get(name)) : null),
      /** The subnet a service's Direct VPC egress leaves from, as a path, or null. */
      egressSubnetOf: (name) => {
        const subnetwork = services.get(name)?.template?.vpcAccess?.networkInterfaces?.[0]?.subnetwork;
        return subnetwork ? subnetPath(subnetwork) : null;
      },
      /** What a service runs with: each setting's value, a secret one read from Secret Manager. */
      environmentOf: (name) => {
        const service = services.get(name);
        if (!service) return null;
        return Object.fromEntries((service.template.containers[0].env ?? []).map((entry) => {
          if (!entry.valueSource) return [entry.name, entry.value ?? ""];
          const { id, version } = secretOf(entry.valueSource.secretKeyRef);
          return [entry.name, world.platform.secretValue(id, version)];
        }));
      }
    })
  };
}

export { createStandInRun };
