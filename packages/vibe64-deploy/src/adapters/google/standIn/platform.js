import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

// The stand-in's service accounts (IAM v1), the project and its policy (Resource Manager v1), Secret Manager v1,
// Certificate Manager v1, Artifact Registry v1 (Docker repositories, the images builds push, their policies), Cloud
// Build v1 (regional builds from a Cloud Storage source) and Service Networking v1 (the private services connection
// Cloud SQL's private addresses need). Secret Manager names a secret by the project's number, as Google does.

const ACCOUNT_ID = /^[a-z]([-a-z0-9]{4,28}[a-z0-9])$/u;
const RESOURCE_ID = /^[a-zA-Z0-9_-]{1,255}$/u;
const LABEL_KEY = /^[a-z][a-z0-9_-]{0,62}$/u;
const LABEL_VALUE = /^[a-z0-9_-]{0,63}$/u;
const PEERING = "servicenetworking.googleapis.com";

/** A gzip tarball's entry names. @param {Buffer} archive */
function tarNames(archive) {
  const tar = gunzipSync(archive);
  const names = [];
  for (let at = 0; at + 512 <= tar.length && tar.subarray(at, at + 512).some((byte) => byte !== 0);) {
    names.push(tar.subarray(at, at + 100).toString("latin1").replace(/\0.*$/su, ""));
    const size = Number.parseInt(tar.subarray(at + 124, at + 136).toString("latin1").replace(/\0.*$/su, "").trim() || "0", 8);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

/** Labels Google keeps, or the reason it refuses them. @param {any} labels */
function labelsProblem(labels) {
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (!LABEL_KEY.test(key) || !LABEL_VALUE.test(String(value))) return `Label ${key}=${value} isn't valid: keys and values take lowercase letters, digits, _ and - (at most 63).`;
  }
  return null;
}

/** Secret Manager's filter, `labels.<key>=<value>` terms joined by AND. @param {string | null} filter */
function labelFilter(filter) {
  if (!filter) return () => true;
  const terms = filter.split(/\s+AND\s+/u).map((term) => /^labels\.([a-z0-9_-]+)=(\S+)$/u.exec(term.trim()));
  if (terms.some((term) => !term)) return null;
  return (labels) => terms.every(([, key, value]) => labels?.[key] === value);
}

function createStandInPlatform(world) {
  const { project, projectNumber, region, answer, error } = world;
  /** @type {Map<string, any>} by email */
  const accounts = new Map();
  /** @type {Map<string, { secret: any, versions: any[] }>} by secret id */
  const secrets = new Map();
  /** @type {Map<string, any>} Certificate Manager's things, by name */
  const certificates = new Map();
  /** @type {Map<string, any>} by repository id */
  const repositories = new Map();
  /** @type {Set<string>} each image pushed, `<host>/<project>/<repository>/<name>:<tag>` */
  const images = new Set();
  /** @type {any[]} newest first */
  const builds = [];
  /** @type {any[]} */
  const connections = [];

  const notFound = (what) => error(404, "NOT_FOUND", `${what} not found.`);
  const exists = (what) => error(409, "ALREADY_EXISTS", `${what} already exists.`);
  const invalid = (message) => error(400, "INVALID_ARGUMENT", message);
  const policyAnswer = (resource) => {
    const { etag, bindings } = world.policy(resource);
    return answer(200, { version: 1, etag, ...(bindings.length > 0 ? { bindings: structuredClone(bindings) } : {}) });
  };
  const setPolicyAnswer = (resource, body) => {
    const written = world.setPolicy(resource, body?.policy);
    if (!written) return error(409, "ABORTED", "There were concurrent policy changes. Please retry the whole read-modify-write with exponential backoff.");
    return answer(200, { version: 1, ...structuredClone(written) });
  };
  const page = (items, query, field) => {
    const size = Math.min(Number(query.get("pageSize") || 100), 1000);
    const start = Number(query.get("pageToken") || 0);
    const slice = items.slice(start, start + size);
    return answer(200, { ...(slice.length > 0 ? { [field]: structuredClone(slice) } : {}), ...(start + size < items.length ? { nextPageToken: String(start + size) } : {}) });
  };

  // --- IAM: service accounts --------------------------------------------------------------------------------------

  function iam({ method, path, body }) {
    const listPath = /^v1\/projects\/([^/]+)\/serviceAccounts$/u.exec(path);
    if (listPath && method === "POST" && world.isProject(listPath[1])) {
      const accountId = String(body?.accountId ?? "");
      if (!ACCOUNT_ID.test(accountId)) return invalid("accountId must be 6 to 30 lowercase letters, digits or hyphens, starting with a letter.");
      const email = `${accountId}@${project}.iam.gserviceaccount.com`;
      if (accounts.has(email)) return exists(`Service account ${accountId}`);
      const account = {
        name: `projects/${project}/serviceAccounts/${email}`, projectId: project, uniqueId: world.nextId("1000000000"), email,
        displayName: body?.serviceAccount?.displayName ?? "", description: body?.serviceAccount?.description ?? "", etag: "MDEwMjE5MjA=", oauth2ClientId: world.nextId("2000000000")
      };
      accounts.set(email, account);
      return answer(200, structuredClone(account));
    }
    const one = /^v1\/projects\/([^/]+)\/serviceAccounts\/([^/]+)$/u.exec(path);
    if (one && world.isProject(one[1])) {
      const account = accounts.get(decodeURIComponent(one[2]));
      if (!account) return notFound(`Service account projects/${project}/serviceAccounts/${one[2]}`);
      if (method === "GET") return answer(200, structuredClone(account));
      if (method === "DELETE") {
        accounts.delete(account.email);
        world.forget(`serviceAccount:${account.email}`);
        return answer(200, {});
      }
    }
    return null;
  }

  // --- Resource Manager: the project and its policy ---------------------------------------------------------------

  function resourceManager({ method, path, body }) {
    const match = /^v1\/projects\/([^/:]+)(:getIamPolicy|:setIamPolicy)?$/u.exec(path);
    if (!match || match[1] !== project) return null;
    if (!match[2] && method === "GET") {
      return answer(200, { projectNumber, projectId: project, lifecycleState: "ACTIVE", name: project, createTime: "2026-01-05T10:00:00.000Z", parent: { type: "organization", id: "100000000001" } });
    }
    if (match[2] === ":getIamPolicy" && method === "POST") return policyAnswer(`projects/${project}`);
    if (match[2] === ":setIamPolicy" && method === "POST") return setPolicyAnswer(`projects/${project}`, body);
    return null;
  }

  // --- Secret Manager -----------------------------------------------------------------------------------------------

  const secretView = (id) => structuredClone(secrets.get(id).secret);
  function secretManager({ method, path, query, body }) {
    const list = /^v1\/projects\/([^/]+)\/secrets$/u.exec(path);
    if (list && world.isProject(list[1])) {
      if (method === "GET") {
        const matches = labelFilter(query.get("filter"));
        if (!matches) return invalid(`Invalid filter: ${query.get("filter")}`);
        return page([...secrets.keys()].filter((id) => matches(secrets.get(id).secret.labels)).map(secretView), query, "secrets");
      }
      if (method === "POST") {
        const id = query.get("secretId") ?? "";
        if (!RESOURCE_ID.test(id)) return invalid("secretId must be 1 to 255 letters, digits, - or _.");
        if (secrets.has(id)) return exists(`Secret [projects/${projectNumber}/secrets/${id}]`);
        if (!body?.replication) return invalid("Secret.replication is required.");
        const problem = labelsProblem(body.labels);
        if (problem) return invalid(problem);
        const secret = {
          name: `projects/${projectNumber}/secrets/${id}`, replication: structuredClone(body.replication), createTime: world.at(),
          ...(body.labels ? { labels: { ...body.labels } } : {}), ...(body.annotations ? { annotations: { ...body.annotations } } : {}), etag: `"${world.nextId()}"`
        };
        secrets.set(id, { secret, versions: [] });
        return answer(200, secretView(id));
      }
    }
    const one = /^v1\/projects\/([^/]+)\/secrets\/([^/:]+)(:addVersion|:getIamPolicy|:setIamPolicy|\/versions\/([^/:]+):access)?$/u.exec(path);
    if (!one || !world.isProject(one[1])) return null;
    const [, , id, action, version] = one;
    const found = secrets.get(id);
    if (!found) return notFound(`Secret [projects/${projectNumber}/secrets/${id}]`);
    if (!action && method === "GET") return answer(200, secretView(id));
    if (!action && method === "DELETE") {
      secrets.delete(id);
      world.setPolicy(`secrets/${id}`, { bindings: [] });
      return answer(200, {});
    }
    if (action === ":addVersion" && method === "POST") {
      const data = body?.payload?.data;
      if (typeof data !== "string") return invalid("payload.data is required.");
      const made = { name: `projects/${projectNumber}/secrets/${id}/versions/${found.versions.length + 1}`, createTime: world.at(), state: "ENABLED", data };
      found.versions.push(made);
      return answer(200, { name: made.name, createTime: made.createTime, state: made.state });
    }
    if (action === ":getIamPolicy" && method === "GET") return policyAnswer(`secrets/${id}`);
    if (action === ":setIamPolicy" && method === "POST") return setPolicyAnswer(`secrets/${id}`, body);
    if (version !== undefined && method === "GET") {
      const made = version === "latest" ? found.versions.at(-1) : found.versions[Number(version) - 1];
      if (!made) return notFound(`Secret Version [projects/${projectNumber}/secrets/${id}/versions/${version}]`);
      return answer(200, { name: made.name, payload: { data: made.data, dataCrc32c: String(createHash("sha256").update(made.data).digest().readUInt32BE(0)) } });
    }
    return null;
  }

  /** A secret version's value, or null: `version` a number or latest. */
  function secretValue(id, version = "latest") {
    const found = secrets.get(id);
    const made = found && (version === "latest" ? found.versions.at(-1) : found.versions[Number(version) - 1]);
    return made ? Buffer.from(made.data, "base64").toString("utf8") : null;
  }

  // --- Certificate Manager ------------------------------------------------------------------------------------------

  const KINDS = { dnsAuthorizations: "dnsAuthorizationId", certificates: "certificateId", certificateMaps: "certificateMapId", certificateMapEntries: "certificateMapEntryId" };
  function certificateManager({ method, path, query, body }) {
    const match = /^v1\/projects\/([^/]+)\/locations\/global\/((?:certificateMaps\/[^/]+\/)?)(dnsAuthorizations|certificates|certificateMaps|certificateMapEntries)(?:\/([^/]+))?$/u.exec(path);
    if (!match || !world.isProject(match[1])) return null;
    const [, , parent, kind, id] = match;
    const prefix = `projects/${project}/locations/global/${parent}${kind}`;
    if (id && method === "GET") {
      const found = certificates.get(`${prefix}/${id}`);
      return found ? answer(200, structuredClone(found)) : notFound(`Resource '${prefix}/${id}'`);
    }
    if (id || method !== "POST") return null;
    const newId = query.get(KINDS[kind]) ?? "";
    const name = `${prefix}/${newId}`;
    if (!/^[a-z][a-z0-9-]{0,62}$/u.test(newId)) return invalid(`${KINDS[kind]} must be lowercase letters, digits and hyphens, starting with a letter.`);
    if (certificates.has(name)) return exists(`Resource '${name}'`);
    if (parent && !certificates.has(`projects/${project}/locations/global/${parent.slice(0, -1)}`)) return notFound(`Resource '${parent.slice(0, -1)}'`);
    const problem = labelsProblem(body?.labels);
    if (problem) return invalid(problem);
    let made;
    if (kind === "dnsAuthorizations") {
      if (!body?.domain) return invalid("domain is required.");
      made = { name, domain: body.domain, type: "FIXED_RECORD", dnsResourceRecord: { name: `_acme-challenge.${body.domain}.`, type: "CNAME", data: `${randomUUID()}.9.authorize.certificatemanager.goog.` } };
    } else if (kind === "certificates") {
      const managed = body?.managed;
      if (!managed?.domains?.length) return invalid("managed.domains is required.");
      for (const authorization of managed.dnsAuthorizations ?? []) if (!certificates.has(authorization)) return invalid(`DNS authorization ${authorization} not found.`);
      made = { name, scope: "DEFAULT", sanDnsnames: [...managed.domains], managed: { domains: [...managed.domains], dnsAuthorizations: [...(managed.dnsAuthorizations ?? [])], state: "PROVISIONING", authorizationAttemptInfo: managed.domains.map((domain) => ({ domain, state: "AUTHORIZING" })) } };
    } else if (kind === "certificateMaps") {
      made = { name, gclbTargets: [] };
    } else {
      for (const certificate of body?.certificates ?? []) if (!certificates.has(certificate)) return invalid(`Certificate ${certificate} not found.`);
      if (!body?.hostname) return invalid("hostname or matcher is required.");
      made = { name, hostname: body.hostname, certificates: [...body.certificates], state: "ACTIVE" };
    }
    Object.assign(made, { createTime: world.at(), updateTime: world.at(), ...(body?.labels ? { labels: { ...body.labels } } : {}) });
    return answer(200, world.operation(`projects/${project}/locations/global/operations/operation-${world.nextId()}`, () => {
      certificates.set(name, made);
      return { "@type": "type.googleapis.com/google.cloud.certificatemanager.v1.Certificate", ...structuredClone(made) };
    }));
  }

  // --- Artifact Registry --------------------------------------------------------------------------------------------

  function artifactRegistry({ method, path, query, body }) {
    const match = /^v1\/projects\/([^/]+)\/locations\/([^/]+)\/repositories(?:\/([^/:]+)(:getIamPolicy|:setIamPolicy)?)?$/u.exec(path);
    if (!match || !world.isProject(match[1]) || match[2] !== region) return null;
    const [, , , id, action] = match;
    if (!id && method === "POST") {
      const newId = query.get("repositoryId") ?? "";
      if (repositories.has(newId)) return exists(`Repository ${newId}`);
      if (body?.format !== "DOCKER") return invalid("format must be given.");
      const made = { name: `projects/${project}/locations/${region}/repositories/${newId}`, format: "DOCKER", description: body.description ?? "", labels: { ...(body.labels ?? {}) }, createTime: world.at(), updateTime: world.at(), mode: "STANDARD_REPOSITORY" };
      return answer(200, world.operation(`projects/${project}/locations/${region}/operations/${randomUUID()}`, () => {
        repositories.set(newId, made);
        return structuredClone(made);
      }));
    }
    if (!id) return null;
    if (!repositories.has(id)) return notFound(`Requested entity was not found: repository ${id}`);
    if (!action && method === "GET") return answer(200, structuredClone(repositories.get(id)));
    if (action === ":getIamPolicy" && method === "GET") return policyAnswer(`repositories/${id}`);
    if (action === ":setIamPolicy" && method === "POST") return setPolicyAnswer(`repositories/${id}`, body);
    return null;
  }

  // --- Cloud Build --------------------------------------------------------------------------------------------------

  function cloudBuild({ method, path, query, body }) {
    const match = /^v1\/projects\/([^/]+)\/locations\/([^/]+)\/builds$/u.exec(path);
    if (!match || !world.isProject(match[1]) || match[2] !== region) return null;
    if (method === "GET") {
      const filter = query.get("filter");
      const tag = filter ? /^tags="([^"]+)"$/u.exec(filter)?.[1] : null;
      if (filter && !tag) return invalid(`Invalid filter: ${filter}`);
      return page(builds.filter((build) => !tag || build.tags.includes(tag)), query, "builds");
    }
    if (method !== "POST") return null;
    const source = body?.source?.storageSource;
    if (!source?.bucket || !source?.object) return invalid("source.storageSource bucket and object are required.");
    if (!body.steps?.length) return invalid("A build needs at least one step.");
    if (body.serviceAccount && !(body.options?.logging === "CLOUD_LOGGING_ONLY" || body.logsBucket)) {
      return invalid("if 'build.service_account' is specified, the build must either (a) specify 'build.logs_bucket', (b) use the REGIONAL_USER_OWNED_BUCKET build.options.default_logs_bucket_behavior option, or (c) use either CLOUD_LOGGING_ONLY / NONE logging options");
    }
    const id = randomUUID();
    const build = {
      id, projectId: project, status: "QUEUED", source: structuredClone(body.source), steps: structuredClone(body.steps), images: [...(body.images ?? [])],
      tags: [...(body.tags ?? [])], createTime: world.at(), timeout: body.timeout ?? "600s", options: structuredClone(body.options ?? {}),
      logUrl: `https://console.cloud.google.com/cloud-build/builds;region=${region}/${id}?project=${projectNumber}`,
      name: `projects/${projectNumber}/locations/${region}/builds/${id}`, ...(body.serviceAccount ? { serviceAccount: body.serviceAccount } : {})
    };
    builds.unshift(build);
    return answer(200, {
      name: `projects/${projectNumber}/locations/${region}/operations/${randomUUID()}`,
      metadata: { "@type": "type.googleapis.com/google.devtools.cloudbuild.v1.BuildOperationMetadata", build: structuredClone(build) }
    });
  }

  /** A build's next state: queued, working, then pushed (or failed, with Cloud Build's reason). */
  function stepBuild(build) {
    if (build.status === "QUEUED") {
      build.status = "WORKING";
      build.startTime = world.at();
      return;
    }
    if (build.status !== "WORKING") return;
    const fail = (detail) => Object.assign(build, { status: "FAILURE", statusDetail: detail, finishTime: world.at() });
    const archive = world.storage.objectBytes(build.source.storageSource.bucket, build.source.storageSource.object);
    if (!archive) return fail(`failed to fetch source: gs://${build.source.storageSource.bucket}/${build.source.storageSource.object} not found`);
    const file = build.steps[0].args[build.steps[0].args.indexOf("--file") + 1];
    if (file && !tarNames(archive).includes(file)) return fail(`unable to prepare context: unable to evaluate symlinks in Dockerfile path: lstat /workspace/${file}: no such file or directory`);
    if (world.faults.buildFails) return fail("Build step 0 \"gcr.io/cloud-builders/docker\" failed: step exited with non-zero status: 1");
    for (const image of build.images) {
      const [, repository] = new RegExp(`^${region}-docker\\.pkg\\.dev/${project}/([^/]+)/[^:]+:[^:]+$`, "u").exec(image) ?? [];
      if (!repository || !repositories.has(repository)) return fail(`failed to push ${image}: name unknown: Repository "${repository}" not found`);
      images.add(image);
    }
    Object.assign(build, { status: "SUCCESS", finishTime: world.at(), results: { images: build.images.map((name) => ({ name, digest: `sha256:${createHash("sha256").update(name).digest("hex")}` })) } });
    return undefined;
  }

  // --- Service Networking ---------------------------------------------------------------------------------------------

  function serviceNetworking({ method, path, query, body }) {
    if (path !== `v1/services/${PEERING}/connections`) return null;
    const network = method === "GET" ? query.get("network") : body?.network;
    const [, number, name] = /^projects\/([^/]+)\/global\/networks\/([^/]+)$/u.exec(network ?? "") ?? [];
    if (number !== projectNumber) return invalid("network must be projects/{project number}/global/networks/{network}.");
    if (method === "GET") return answer(200, { connections: structuredClone(connections.filter((one) => one.network === network)) });
    if (method !== "POST") return null;
    if (!world.compute.has(`projects/${project}/global/networks/${name}`)) return invalid(`Network ${network} not found.`);
    for (const range of body.reservedPeeringRanges ?? []) {
      const address = world.compute.get(`projects/${project}/global/addresses/${range}`);
      if (address?.purpose !== "VPC_PEERING") return invalid(`Allocated IP range '${range}' not found in network.`);
    }
    return answer(200, world.operation(`operations/pssn.${world.nextId()}`, () => {
      connections.push({ network, reservedPeeringRanges: [...body.reservedPeeringRanges], peering: "servicenetworking-googleapis-com", service: `services/${PEERING}` });
      return { "@type": "type.googleapis.com/google.cloud.servicenetworking.v1.Connection" };
    }));
  }

  const handlers = { iam, cloudresourcemanager: resourceManager, secretmanager: secretManager, certificatemanager: certificateManager, artifactregistry: artifactRegistry, cloudbuild: cloudBuild, servicenetworking: serviceNetworking };

  return {
    request: (request) => handlers[request.api]?.(request) ?? null,
    advance: () => builds.forEach(stepBuild),
    accountExists: (email) => accounts.has(email),
    secretExists: (id) => secrets.has(id),
    secretValue,
    imageExists: (image) => images.has(image),
    /** The repository an image is in, or null. */
    repositoryOf: (image) => new RegExp(`^${region}-docker\\.pkg\\.dev/${project}/([^/]+)/`, "u").exec(image)?.[1] ?? null,
    certificateMap: (name) => certificates.get(name.replace(/^\/\/certificatemanager\.googleapis\.com\//u, "")) ?? null,
    peered: (network) => connections.some((one) => one.network === network.replace(`projects/${project}/`, `projects/${projectNumber}/`)),
    controls: Object.freeze({
      accounts: () => [...accounts.values()].map((one) => structuredClone(one)),
      secrets: () => [...secrets.values()].map(({ secret, versions }) => ({ ...structuredClone(secret), versions: versions.length })),
      secretValue,
      builds: () => structuredClone(builds),
      images: () => [...images],
      repositories: () => [...repositories.values()].map((one) => structuredClone(one)),
      certificates: () => [...certificates.values()].map((one) => structuredClone(one)),
      connections: () => structuredClone(connections),
      /** The owner's DNS records are in place: each certificate of the domain turns ACTIVE. @param {string} domain */
      verifyDomain: (domain) => {
        for (const thing of certificates.values()) if (thing.managed?.domains?.includes(domain)) Object.assign(thing.managed, { state: "ACTIVE", authorizationAttemptInfo: [{ domain, state: "AUTHORIZED" }] });
      }
    })
  };
}

export { createStandInPlatform, labelsProblem };
