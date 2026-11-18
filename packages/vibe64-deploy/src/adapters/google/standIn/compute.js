import { labelsProblem } from "./platform.js";

// The stand-in's Compute Engine v1: networks, subnetworks, routers, firewall rules, addresses, health checks, serverless
// network endpoint groups, backend services, URL maps, target proxies and forwarding rules (global and regional), and
// regional instance templates and managed instance groups with their machines. Every insert, patch, delete and resize
// answers a RUNNING operation, which `operations/{name}/wait` answers DONE. A part names others by URL or by
// `projects/…` path; one naming a part that isn't there is refused 400 (Compute Engine's `invalid`), and a part another
// still names can't be deleted (400 `resourceInUseByAnotherResource`).
//
// A group's machines move at each advance: made (CREATING), started (VERIFYING), then running with their health, which
// is HEALTHY only when the machine could start its service: its image built into the registry, its account allowed to
// pull it, to read each secret its template names and to write logs. A group handed another template makes its new
// machines first and removes the old once those are healthy.

const NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/u;
const KINDS = Object.freeze({
  networks: "network", subnetworks: "subnetwork", routers: "router", firewalls: "firewall", addresses: "address", healthChecks: "healthCheck",
  networkEndpointGroups: "networkEndpointGroup", backendServices: "backendService", urlMaps: "urlMap", targetHttpsProxies: "targetHttpsProxy",
  targetHttpProxies: "targetHttpProxy", forwardingRules: "forwardingRule", instanceTemplates: "instanceTemplate", instanceGroupManagers: "instanceGroupManager",
  instanceGroups: "instanceGroup"
});
const PREFIX = "https://www.googleapis.com/compute/v1/";

/** A reference's `projects/…` path, from a URL or a path. @param {unknown} value */
const pathOf = (value) => {
  const text = String(value ?? "");
  const at = text.indexOf("projects/");
  return at < 0 ? null : text.slice(at);
};
const last = (value) => String(value ?? "").split("/").pop();

function createStandInCompute(world) {
  const { project, region, answer, legacy } = world;
  /** @type {Map<string, any>} every part, by its `projects/…` path */
  const parts = new Map();
  /** @type {Map<string, any>} operations, by name */
  const operations = new Map();
  /** @type {Map<string, any[]>} each group's machines, by the group's path */
  const machines = new Map();
  let address = 10;

  const invalid = (message) => legacy(400, "invalid", message);
  const notFound = (path) => legacy(404, "notFound", `The resource '${path}' was not found`);
  const zones = [`${region}-a`, `${region}-b`, `${region}-c`];

  /** A RUNNING operation on a part. */
  function operation(type, path, scope) {
    const name = `operation-${Date.parse(world.at())}-${world.nextId()}`;
    const op = {
      kind: "compute#operation", id: world.nextId("7000000000"), name, operationType: type, targetLink: `${PREFIX}${path}`, targetId: parts.get(path)?.id ?? world.nextId("8"),
      status: "RUNNING", user: "deploy@standin", progress: 0, insertTime: world.at(), startTime: world.at(),
      selfLink: `${PREFIX}projects/${project}/${scope}/operations/${name}`, ...(scope.startsWith("regions/") ? { region: `${PREFIX}projects/${project}/${scope}` } : {})
    };
    operations.set(name, op);
    return answer(200, structuredClone(op));
  }

  /** The part a reference names, or null. */
  const resolve = (value) => parts.get(pathOf(value)) ?? null;
  /** The first reference among `values` that names no part, or null. */
  const missing = (...values) => values.flat().find((value) => value && !resolve(value)) ?? null;

  /** Why an insert of this part would be refused, or null. */
  function refusal(collection, body, scope) {
    const refs = [];
    switch (collection) {
      case "networks":
        if (body.autoCreateSubnetworks !== false) return "The stand-in makes custom-mode networks only: autoCreateSubnetworks false.";
        break;
      case "subnetworks":
        if (!body.ipCidrRange) return "Invalid value for field 'resource.ipCidrRange': ''.";
        refs.push(body.network);
        break;
      case "routers":
      case "firewalls":
        refs.push(body.network);
        if (collection === "firewalls" && !(body.allowed?.length || body.denied?.length)) return "Invalid value for field 'resource.allowed': ''. Must specify at least one rule.";
        break;
      case "addresses":
        if (body.purpose === "VPC_PEERING") {
          if (!body.prefixLength) return "Invalid value for field 'resource.prefixLength'.";
          refs.push(body.network);
        }
        break;
      case "healthChecks":
        if (!body.type) return "Invalid value for field 'resource.type'.";
        break;
      case "networkEndpointGroups":
        if (body.networkEndpointType !== "SERVERLESS" || !body.cloudRun?.service) return "Invalid value for field 'resource.cloudRun'.";
        break;
      case "backendServices": {
        refs.push(body.healthChecks ?? [], (body.backends ?? []).map((backend) => backend.group));
        const serverless = (body.backends ?? []).some((backend) => resolve(backend.group)?.networkEndpointType === "SERVERLESS");
        if (serverless && body.healthChecks?.length) return "A backend service cannot have a healthcheck with Serverless network endpoint group backends.";
        if (serverless && body.timeoutSec !== undefined) return "Timeout sec is not supported for a backend service with Serverless network endpoint groups.";
        if (serverless && (body.portName || (body.backends ?? []).some((backend) => backend.balancingMode || backend.capacityScaler !== undefined))) {
          return "Balancing mode, capacity scaler and port name are not supported for Serverless network endpoint group backends.";
        }
        break;
      }
      case "urlMaps":
        if (!body.defaultService && !body.defaultUrlRedirect) return "Invalid value for field 'resource.defaultService'.";
        refs.push(body.defaultService);
        break;
      case "targetHttpsProxies":
        refs.push(body.urlMap);
        if (!body.certificateMap && !body.sslCertificates?.length) return "Invalid value for field 'resource.sslCertificates': ''.";
        if (body.certificateMap && !world.platform.certificateMap(body.certificateMap)) return `Certificate map ${body.certificateMap} not found.`;
        break;
      case "targetHttpProxies":
        refs.push(body.urlMap);
        break;
      case "forwardingRules":
        if (scope === "global") {
          refs.push(body.target);
          const reserved = [...parts.values()].some((part) => part.kind === "compute#address" && part.address === body.IPAddress);
          if (body.IPAddress && !reserved) return `Invalid value for field 'resource.IPAddress': '${body.IPAddress}'. The address isn't reserved in this project.`;
        } else {
          refs.push(body.backendService, body.network, body.subnetwork);
          if (body.loadBalancingScheme !== "INTERNAL") return "Invalid value for field 'resource.loadBalancingScheme'.";
        }
        break;
      case "instanceTemplates": {
        const properties = body.properties ?? {};
        refs.push((properties.networkInterfaces ?? []).flatMap((one) => [one.network, one.subnetwork]));
        const email = properties.serviceAccounts?.[0]?.email;
        if (email && !world.platform.accountExists(email)) return `The resource '${email}' of type 'serviceAccount' was not found.`;
        if (!/^e2-(standard|highcpu|highmem)-\d+$/u.test(properties.machineType ?? "")) return `Invalid value for field 'resource.properties.machineType': '${properties.machineType}'.`;
        const problem = labelsProblem(properties.labels);
        if (problem) return problem;
        break;
      }
      case "instanceGroupManagers":
        refs.push(body.instanceTemplate, (body.versions ?? []).map((version) => version.instanceTemplate), (body.autoHealingPolicies ?? []).map((policy) => policy.healthCheck));
        if (!Number.isInteger(body.targetSize) || body.targetSize < 0) return "Invalid value for field 'resource.targetSize'.";
        for (const field of ["maxSurge", "maxUnavailable"]) {
          const fixed = body.updatePolicy?.[field]?.fixed;
          // A regional group's fixed surge or unavailability is 0 or at least its number of zones.
          if (fixed !== undefined && fixed !== 0 && fixed < zones.length) return `Invalid value for field 'resource.updatePolicy.${field}.fixed': '${fixed}'. Fixed ${field} must be 0 or at least ${zones.length}, the number of zones.`;
        }
        break;
      default:
        return `The stand-in makes no ${collection}.`;
    }
    const gone = missing(...refs);
    return gone ? `The resource '${pathOf(gone) ?? gone}' was not found` : null;
  }

  /** A part made from an insert's body. */
  function make(collection, scope, body) {
    const path = `projects/${project}/${scope}/${collection}/${body.name}`;
    const part = {
      ...structuredClone(body), kind: `compute#${KINDS[collection]}`, id: world.nextId("5000000000"), creationTimestamp: world.at(), selfLink: `${PREFIX}${path}`,
      ...(scope.startsWith("regions/") ? { region: `${PREFIX}projects/${project}/${scope}` } : {})
    };
    if (collection === "addresses" && body.purpose !== "VPC_PEERING") Object.assign(part, { address: `34.120.${Math.floor(address / 250)}.${(address += 1) % 250}`, addressType: "EXTERNAL", status: "RESERVED" });
    if (collection === "addresses" && body.purpose === "VPC_PEERING") Object.assign(part, { address: "10.100.0.0", status: "RESERVED" });
    if (collection === "networks") Object.assign(part, { routingConfig: { routingMode: "REGIONAL" }, subnetworks: [] });
    if (collection === "forwardingRules" && body.serviceLabel) part.serviceName = `${body.serviceLabel}.${body.name}.il4.${region}.lb.${project}.internal`;
    if (collection === "forwardingRules" && scope !== "global") part.IPAddress = `10.64.0.${(address += 1) % 250}`;
    if (collection === "instanceGroupManagers") {
      const group = `projects/${project}/${scope}/instanceGroups/${body.name}`;
      parts.set(group, { kind: "compute#instanceGroup", id: world.nextId("6000000000"), name: body.name, selfLink: `${PREFIX}${group}`, namedPorts: structuredClone(body.namedPorts ?? []) });
      Object.assign(part, {
        instanceGroup: `${PREFIX}${group}`, instanceTemplate: `${PREFIX}${pathOf(body.instanceTemplate)}`,
        versions: [{ instanceTemplate: `${PREFIX}${pathOf(body.instanceTemplate)}`, name: "" }], fingerprint: "AAAA",
        distributionPolicy: { zones: zones.map((zone) => ({ zone: `${PREFIX}projects/${project}/zones/${zone}` })), targetShape: "EVEN" }, listManagedInstancesResults: "PAGELESS"
      });
      machines.set(path, []);
    }
    parts.set(path, part);
    return path;
  }

  /** The parts that name a path, but the part itself. */
  function usersOf(path) {
    const named = (value) => (typeof value === "string" ? pathOf(value) === path : Array.isArray(value) ? value.some(named) : value && typeof value === "object" ? Object.values(value).some(named) : false);
    return [...parts.entries()].filter(([other, part]) => other !== path && named({ ...part, selfLink: null, instanceGroup: null }));
  }

  function request({ method, path: requestPath, query, body }) {
    const match = /^compute\/v1\/projects\/([^/]+)\/(global|regions\/[^/]+|zones\/[^/]+)\/([A-Za-z]+)(?:\/([^/]+)(?:\/([A-Za-z]+))?)?$/u.exec(requestPath);
    if (!match || !world.isProject(match[1])) return null;
    const [, , scope, collection, name, action] = match;
    if (scope !== "global" && !scope.endsWith(`/${region}`) && !scope.startsWith("zones/")) return invalid(`Unknown region ${scope}.`);
    if (collection === "operations") {
      const op = operations.get(name);
      if (!op) return notFound(`projects/${project}/${scope}/operations/${name}`);
      if (action === "wait" && method === "POST") Object.assign(op, { status: "DONE", progress: 100, endTime: world.at() });
      return action === "wait" || (!action && method === "GET") ? answer(200, structuredClone(op)) : null;
    }
    if (!KINDS[collection] || collection === "instanceGroups") return null;
    const base = `projects/${project}/${scope}/${collection}`;
    if (!name) {
      if (method === "GET") {
        const items = [...parts.entries()].filter(([path]) => path.startsWith(`${base}/`) && !path.slice(base.length + 1).includes("/")).map(([, part]) => part);
        const size = Math.min(Number(query.get("maxResults") || 500), 500);
        const start = Number(query.get("pageToken") || 0);
        return answer(200, {
          kind: `compute#${KINDS[collection]}List`, id: base, selfLink: `${PREFIX}${base}`, items: structuredClone(items.slice(start, start + size)),
          ...(start + size < items.length ? { nextPageToken: String(start + size) } : {})
        });
      }
      if (method !== "POST") return null;
      if (!NAME.test(String(body?.name ?? ""))) return invalid(`Invalid value for field 'resource.name': '${body?.name}'. Must be a match of regex '(?:[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?)'`);
      if (parts.has(`${base}/${body.name}`)) return legacy(409, "alreadyExists", `The resource '${base}/${body.name}' already exists`);
      const problem = refusal(collection, body, scope);
      if (problem) return invalid(problem);
      return operation("insert", make(collection, scope, body), scope);
    }
    const path = `${base}/${name}`;
    const part = parts.get(path);
    if (!part) return notFound(path);
    if (!action && method === "GET") return answer(200, structuredClone(part));
    if (!action && method === "DELETE") {
      const [user] = usersOf(path);
      if (user) return legacy(400, "resourceInUseByAnotherResource", `The ${KINDS[collection]} resource '${path}' is already being used by '${user[0]}'`);
      const op = operation("delete", path, scope);
      parts.delete(path);
      if (collection === "instanceGroupManagers") {
        parts.delete(`projects/${project}/${scope}/instanceGroups/${name}`);
        machines.delete(path);
      }
      return op;
    }
    if (!action && method === "PATCH") {
      if (collection === "instanceGroupManagers") {
        const template = body?.versions?.[0]?.instanceTemplate ?? body?.instanceTemplate;
        if (template && !resolve(template)) return invalid(`The resource '${pathOf(template)}' was not found`);
        if (template) Object.assign(part, { instanceTemplate: `${PREFIX}${pathOf(template)}`, versions: [{ instanceTemplate: `${PREFIX}${pathOf(template)}`, name: "" }] });
        return operation("patch", path, scope);
      }
      const merged = { ...part, ...structuredClone(body ?? {}), name: part.name, kind: part.kind, id: part.id, selfLink: part.selfLink };
      const problem = collection === "firewalls" ? refusal(collection, merged, scope) : null;
      if (problem) return invalid(problem);
      parts.set(path, merged);
      return operation("patch", path, scope);
    }
    if (collection === "instanceGroupManagers" && method === "POST" && action === "resize") {
      const size = Number(query.get("size"));
      if (!Number.isInteger(size) || size < 0) return invalid("Invalid value for field 'size'.");
      part.targetSize = size;
      return operation("compute.instanceGroupManagers.resize", path, scope);
    }
    if (collection === "instanceGroupManagers" && method === "POST" && action === "listManagedInstances") {
      return answer(200, { managedInstances: (machines.get(path) ?? []).map((machine) => managedView(part, machine)) });
    }
    return null;
  }

  /** A machine as listManagedInstances answers it. */
  function managedView(group, machine) {
    const health = group.autoHealingPolicies?.[0]?.healthCheck;
    return {
      instance: `${PREFIX}projects/${project}/zones/${machine.zone}/instances/${machine.name}`, id: machine.id, instanceStatus: machine.status, currentAction: machine.action,
      version: { instanceTemplate: `${PREFIX}${machine.template}`, name: "" },
      ...(health && machine.action === "NONE" ? { instanceHealth: [{ healthCheck: health, detailedHealthState: machine.healthy ? "HEALTHY" : "UNHEALTHY" }] } : {}),
      ...(machine.errors.length > 0 ? { lastAttempt: { errors: { errors: structuredClone(machine.errors) } } } : {})
    };
  }

  /** What a template's metadata says, by key. */
  const metadataOf = (template) => Object.fromEntries((template?.properties?.metadata?.items ?? []).map((item) => [item.key, item.value]));

  /** Why a machine of this template couldn't start its service, or []. */
  function machineProblems(template) {
    const items = metadataOf(template);
    const email = template.properties.serviceAccounts?.[0]?.email;
    const member = `serviceAccount:${email}`;
    const image = /docker pull (\S+)/u.exec(items["startup-script"] ?? "")?.[1];
    const problems = [];
    if (world.faults.machinesUnhealthy) problems.push("its health check fails");
    if (!image || !world.platform.imageExists(image)) problems.push(`no image ${image}`);
    else if (!world.allows(`repositories/${world.platform.repositoryOf(image)}`, member, "roles/artifactregistry.reader")) problems.push(`${email} can't pull ${image}`);
    for (const line of String(items["vibe64-secrets"] ?? "").split("\n").filter(Boolean)) {
      const secret = /\/secrets\/([^/]+)\/versions\//u.exec(line)?.[1];
      if (!world.platform.secretExists(secret) || !world.allows(`secrets/${secret}`, member, "roles/secretmanager.secretAccessor")) problems.push(`${email} can't read secret ${secret}`);
    }
    if (!world.allows(`projects/${project}`, member, "roles/logging.logWriter")) problems.push(`${email} can't write logs`);
    return problems;
  }

  /** Each group's machines one step on. */
  function advance() {
    for (const [path, group] of parts) {
      if (group.kind !== "compute#instanceGroupManager") continue;
      const list = machines.get(path);
      const current = pathOf(group.instanceTemplate);
      for (const machine of [...list]) {
        if (machine.action === "CREATING") {
          if (world.faults.stockout) {
            machine.errors = [{ code: "ZONE_RESOURCE_POOL_EXHAUSTED", message: `The zone 'projects/${project}/zones/${machine.zone}' does not have enough resources available to fulfill the request.` }];
          } else Object.assign(machine, { status: "RUNNING", action: "VERIFYING", errors: [] });
        } else if (machine.action === "VERIFYING") {
          const problems = machineProblems(parts.get(machine.template));
          Object.assign(machine, { action: "NONE", healthy: problems.length === 0, problems });
        }
      }
      const fresh = list.filter((machine) => machine.template === current);
      const old = list.filter((machine) => machine.template !== current);
      for (let count = fresh.length; count < group.targetSize; count += 1) {
        const machine = { name: `${group.baseInstanceName}-${world.nextId().slice(-4)}`, id: world.nextId("9000000000"), zone: zones[count % zones.length], template: current, status: "PROVISIONING", action: "CREATING", healthy: false, problems: [], errors: [] };
        list.push(machine);
        fresh.push(machine);
      }
      const ready = fresh.filter((machine) => machine.action === "NONE" && machine.healthy).length;
      const keep = new Set([...fresh.slice(0, group.targetSize), ...(ready >= group.targetSize ? [] : old)]);
      machines.set(path, list.filter((machine) => keep.has(machine)));
      const now = machines.get(path);
      const settled = now.every((machine) => machine.action === "NONE") && now.length === group.targetSize && now.every((machine) => machine.template === current);
      group.status = { isStable: settled, versionTarget: { isReached: now.every((machine) => machine.template === current) }, allInstancesConfig: { effective: true }, stateful: { hasStatefulConfig: false } };
    }
  }

  const tagsOfTemplate = (template) => template?.properties?.tags?.items ?? [];
  const groupNamed = (name) => [...parts.entries()].find(([, part]) => part.kind === "compute#instanceGroupManager" && part.name === name) ?? null;

  return {
    request,
    advance,
    has: (path) => parts.has(path),
    get: (path) => parts.get(path) ?? null,
    controls: Object.freeze({
      /** Every part whose path has this collection, such as firewalls or forwardingRules. */
      parts: (collection) => [...parts.entries()].filter(([path]) => path.split("/").at(-2) === collection).map(([, part]) => structuredClone(part)),
      part: (path) => structuredClone(parts.get(path) ?? null),
      group: (name) => structuredClone(groupNamed(name)?.[1] ?? null),
      /** A group's machines, with why each is unhealthy. */
      machines: (name) => {
        const found = groupNamed(name);
        return found ? machines.get(found[0]).map((machine) => ({ ...structuredClone(machine), template: last(machine.template) })) : [];
      },
      /** A group's current template's metadata, by key. */
      metadataOf: (name) => {
        const found = groupNamed(name);
        return found ? metadataOf(parts.get(pathOf(found[1].instanceTemplate))) : null;
      },
      /** A group's network tags, its current template's. */
      tagsOf: (name) => {
        const found = groupNamed(name);
        return found ? tagsOfTemplate(parts.get(pathOf(found[1].instanceTemplate))) : null;
      },
      /** What a group's machines run with: each setting's value, a secret one read from Secret Manager. */
      environmentOf: (name) => {
        const found = groupNamed(name);
        if (!found) return null;
        const items = metadataOf(parts.get(pathOf(found[1].instanceTemplate)));
        const values = {};
        for (const line of String(items["vibe64-env"] ?? "").split("\n").filter(Boolean)) {
          values[line.slice(0, line.indexOf("="))] = Buffer.from(line.slice(line.indexOf("=") + 1), "base64").toString("utf8");
        }
        for (const line of String(items["vibe64-secrets"] ?? "").split("\n").filter(Boolean)) {
          const [, secret, version] = /\/secrets\/([^/]+)\/versions\/([^/]+)$/u.exec(line) ?? [];
          values[line.slice(0, line.indexOf("="))] = world.platform.secretValue(secret, version);
        }
        return values;
      },
      /** Whether a firewall rule lets traffic from these ranges or tags reach machines tagged `to` on a TCP port. */
      firewallAllows: (from, to, port) => [...parts.values()].some((part) => part.kind === "compute#firewall" && part.direction === "INGRESS"
        && ((part.sourceTags ?? []).some((tag) => from.tags.includes(tag)) || (part.sourceRanges ?? []).some((range) => from.ranges.includes(range)))
        && (part.targetTags ?? []).some((tag) => to.includes(tag))
        && (part.allowed ?? []).some((rule) => rule.IPProtocol === "tcp" && (rule.ports ?? []).includes(String(port))))
    })
  };
}

export { createStandInCompute };
