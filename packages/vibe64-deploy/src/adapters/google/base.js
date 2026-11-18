import { LABEL } from "../../record.js";
import { GoogleError } from "./client.js";
import { accountIdOf, hashOf, NETWORK, runSubnetOf, SERVICE_TAG, SHARED_LABEL, subnetOf } from "./names.js";

// What the Google Cloud adapter's parts share: the calls of each API for one project and region, waiting on Google's
// operations within a step, the ids of what it makes, the parts every deployment of the project shares (the network,
// the private services connection, the registry, the build bucket), made once, and service accounts, secrets and the
// roles they are given.

const SERVICE_PORT = 3000;
const REPOSITORY = "vibe64";
// Google's front ends: the load balancer's requests and health checks come from these.
const HEALTH_RANGES = Object.freeze(["35.191.0.0/16", "130.211.0.0/22"]);
const SUBNET_RANGE = "10.64.0.0/20";
const RUN_RANGE = "10.64.16.0/20";
const PEERING_RANGE = "vibe64-services";
const PEERING = "services/servicenetworking.googleapis.com/connections";
const HEALTH_FIREWALL = "vibe64-health-checks";
// The label of a bucket key's secret naming the service whose account holds the key.
const CONSUMER_LABEL = "vibe64-consumer";
const DESCRIPTION = "Made by Vibe64's deploy engine.";
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const last = (path) => String(path ?? "").split("/").pop();

/**
 * @param {{ client: any, project: string, region: string, buildServiceAccount?: string, pause?: (ms: number) => Promise<void>, waitTries?: number }} options
 */
function createGoogleBase({ client, project, region, buildServiceAccount, pause = sleep, waitTries = 90 }) {
  const { call, listAll, orNull, orExisting } = client;
  const P = `projects/${project}`;
  const networkUrl = `${P}/global/networks/${NETWORK}`;
  const subnet = subnetOf(region);
  const subnetUrl = `${P}/regions/${region}/subnetworks/${subnet}`;
  const runSubnet = runSubnetOf(region);
  const buildBucketName = `vibe64-builds-${hashOf(project, 12)}`;
  const compute = (method, path, request) => call("compute", method, `compute/v1/${P}/${path}`, request);
  const run = (method, path, request) => call("run", method, `v2/${path}`, request);
  // Cloud SQL answers 409 while another operation of the instance runs: tried again at the next step.
  const sql = (method, path, request) => call("sqladmin", method, `v1/${P}/${path}`, request).catch((error) => {
    if (error instanceof GoogleError && error.status === 409) error.retryable = true;
    throw error;
  });
  const secrets = (method, path, request) => call("secretmanager", method, `v1/${P}/secrets${path}`, request);
  const certificates = (method, path, request) => call("certificatemanager", method, `v1/${P}/locations/global/${path}`, request);
  const ids = {
    run: (name) => `${P}/locations/${region}/services/${name}`,
    group: (name) => `${P}/regions/${region}/instanceGroupManagers/${name}`,
    database: (name) => `${P}/instances/${name}`,
    bucket: (name) => `projects/_/buckets/${name}`
  };
  /** Which kind of thing an id names. @param {string} id */
  const kindOf = (id) => {
    if (id.startsWith(`${P}/locations/`)) return "run";
    if (id.startsWith(`${P}/regions/`)) return "group";
    if (id.startsWith(`${P}/instances/`)) return "database";
    if (id.startsWith("projects/_/buckets/")) return "bucket";
    throw new TypeError(`${id} isn't a thing this adapter makes.`);
  };

  // --- Waiting on Google's operations, within one step -----------------------------------------------------------

  /** A Google operation still running past the step's patience: the next step tries again. */
  const slow = (what) => new GoogleError({ status: null, code: "operation_slow", message: `Google is still at ${what}; the next step goes on.`, retryable: true });
  /** An operation that ended with an error: a refusal, its message Google's. */
  const failed = (message, code = "operation_failed") => new GoogleError({ status: 400, code, message, retryable: false });

  /** A Compute Engine operation, waited for until done (operations.wait blocks up to 2 minutes a call). */
  async function computeDone(operation) {
    let current = operation;
    for (let tries = 0; current && current.status !== "DONE"; tries += 1) {
      if (tries >= waitTries) throw slow(`${current.operationType ?? "an operation"} on ${last(current.targetLink)}`);
      const scope = current.zone ? `zones/${last(current.zone)}` : current.region ? `regions/${last(current.region)}` : "global";
      current = await compute("POST", `${scope}/operations/${current.name}/wait`);
    }
    if (current?.error?.errors?.length) throw failed(current.error.errors.map((one) => one.message).join(" "), current.error.errors[0].code);
    return current;
  }

  /** A long-running operation of the newer APIs (`{ name, done, error }`), read until done. */
  async function operationDone(api, version, operation) {
    let current = operation;
    for (let tries = 0; current && !current.done; tries += 1) {
      if (tries >= waitTries) throw slow(`${current.name}`);
      await pause(2000);
      current = await call(api, "GET", `${version}/${current.name}`);
    }
    if (current?.error) throw failed(current.error.message ?? "Google's operation failed.");
    return current;
  }

  /** A Cloud SQL operation, read until done. */
  async function sqlDone(operation) {
    let current = operation;
    for (let tries = 0; current && current.status !== "DONE"; tries += 1) {
      if (tries >= waitTries) throw slow(`${current.operationType ?? "an operation"} on ${current.targetId ?? "a database"}`);
      await pause(2000);
      current = await sql("GET", `operations/${current.name}`);
    }
    if (current?.error?.errors?.length) throw failed(current.error.errors.map((one) => one.message).join(" "), current.error.errors[0].code);
    return current;
  }

  /** A Compute Engine part: read, else made and waited for. */
  async function ensureCompute(path, collection, body) {
    const found = await orNull(() => compute("GET", path));
    if (found) return found;
    const operation = await orExisting(() => compute("POST", collection, { body }));
    if (operation) await computeDone(operation);
    return compute("GET", path);
  }

  /** A Compute Engine part deleted, and waited for; one already gone is fine. */
  async function deleteCompute(path) {
    const operation = await orNull(() => compute("DELETE", path));
    if (operation) await computeDone(operation);
  }

  // --- What every deployment of the project shares, made once -----------------------------------------------------

  const once = (make) => {
    let made = null;
    return () => {
      made ??= make().catch((error) => {
        made = null;
        throw error;
      });
      return made;
    };
  };

  /**
   * The network, its subnets in the region (the machines', Cloud Run's egress; Private Google Access on both, which an
   * internal Cloud Run service is reached through), its NAT for the internet, and the health checks' way in.
   */
  const network = once(async () => {
    await ensureCompute(`global/networks/${NETWORK}`, "global/networks", { name: NETWORK, autoCreateSubnetworks: false, description: DESCRIPTION });
    for (const [name, ipCidrRange] of [[subnet, SUBNET_RANGE], [runSubnet, RUN_RANGE]]) {
      await ensureCompute(`regions/${region}/subnetworks/${name}`, `regions/${region}/subnetworks`, {
        name, network: networkUrl, ipCidrRange, privateIpGoogleAccess: true, description: DESCRIPTION
      });
    }
    await ensureCompute(`regions/${region}/routers/${subnet}`, `regions/${region}/routers`, {
      name: subnet, network: networkUrl, description: DESCRIPTION,
      nats: [{ name: subnet, natIpAllocateOption: "AUTO_ONLY", sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES" }]
    });
    await ensureCompute(`global/firewalls/${HEALTH_FIREWALL}`, "global/firewalls", {
      name: HEALTH_FIREWALL, network: networkUrl, direction: "INGRESS", sourceRanges: [...HEALTH_RANGES], targetTags: [SERVICE_TAG],
      allowed: [{ IPProtocol: "tcp", ports: [String(SERVICE_PORT)] }], description: DESCRIPTION
    });
  });

  /** The private services range and the peering Cloud SQL's private addresses are on. */
  const peering = once(async () => {
    await network();
    await ensureCompute(`global/addresses/${PEERING_RANGE}`, "global/addresses", {
      name: PEERING_RANGE, purpose: "VPC_PEERING", addressType: "INTERNAL", prefixLength: 16, network: networkUrl, description: DESCRIPTION
    });
    const { projectNumber } = await call("cloudresourcemanager", "GET", `v1/projects/${project}`);
    const peered = `projects/${projectNumber}/global/networks/${NETWORK}`;
    const { connections = [] } = await call("servicenetworking", "GET", `v1/${PEERING}`, { query: { network: peered } });
    if (connections.some((one) => (one.reservedPeeringRanges ?? []).includes(PEERING_RANGE))) return;
    const operation = await orExisting(() => call("servicenetworking", "POST", `v1/${PEERING}`, { body: { network: peered, reservedPeeringRanges: [PEERING_RANGE] } }));
    if (operation) await operationDone("servicenetworking", "v1", operation);
  });

  /** The Docker repository images are pushed to. */
  const registry = once(async () => {
    const at = `v1/${P}/locations/${region}/repositories`;
    if (await orNull(() => call("artifactregistry", "GET", `${at}/${REPOSITORY}`))) return;
    const operation = await orExisting(() => call("artifactregistry", "POST", at, {
      query: { repositoryId: REPOSITORY }, body: { format: "DOCKER", description: DESCRIPTION, labels: { [SHARED_LABEL]: "registry" } }
    }));
    if (operation) await operationDone("artifactregistry", "v1", operation);
  });

  /** The bucket each release's source and declaration are kept in, private, its objects gone after 90 days. */
  const buildBucket = once(async () => {
    if (!(await orNull(() => call("storage", "GET", `storage/v1/b/${buildBucketName}`)))) {
      await orExisting(() => call("storage", "POST", "storage/v1/b", {
        query: { project },
        body: {
          name: buildBucketName, location: region, storageClass: "STANDARD", labels: { [SHARED_LABEL]: "builds" },
          iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" },
          lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 90 } }] }
        }
      }));
    }
    return buildBucketName;
  });

  // --- Accounts, secrets, IAM ---------------------------------------------------------------------------------------

  const emailOf = (name) => `${accountIdOf(name)}@${project}.iam.gserviceaccount.com`;

  /** A service's runtime service account, made once; its description names the item, as accounts take no labels. */
  async function account(name, labels) {
    const email = emailOf(name);
    if (!(await orNull(() => call("iam", "GET", `v1/${P}/serviceAccounts/${email}`)))) {
      await orExisting(() => call("iam", "POST", `v1/${P}/serviceAccounts`, {
        body: { accountId: accountIdOf(name), serviceAccount: { displayName: `Vibe64 ${name}`.slice(0, 100), description: `${DESCRIPTION} ${labels[LABEL.item]} of ${labels[LABEL.deployment]}` } }
      }));
    }
    return email;
  }

  /** A secret's policy with `email` added to (or, `grant` false, taken from) those who read it. */
  async function shareSecret(id, email, grant = true) {
    const policy = await secrets("GET", `/${id}:getIamPolicy`);
    const role = "roles/secretmanager.secretAccessor";
    const member = `serviceAccount:${email}`;
    const others = (policy.bindings ?? []).filter((binding) => binding.role !== role);
    const readers = new Set((policy.bindings ?? []).find((binding) => binding.role === role)?.members ?? []);
    if (grant === readers.has(member)) return;
    if (grant) readers.add(member);
    else readers.delete(member);
    const bindings = [...others, ...(readers.size > 0 ? [{ role, members: [...readers].sort() }] : [])];
    await secrets("POST", `/${id}:setIamPolicy`, { body: { policy: { bindings, ...(policy.etag ? { etag: policy.etag } : {}) } } });
  }

  /** A secret made if new (labelled, read by `email`) and given a new version: answers its version's number. */
  async function putSecret(id, value, labels, email, annotations) {
    await orExisting(() => secrets("POST", "", { query: { secretId: id }, body: { replication: { automatic: {} }, labels, ...(annotations ? { annotations } : {}) } }));
    if (email) await shareSecret(id, email);
    const version = await secrets("POST", `/${id}:addVersion`, { body: { payload: { data: Buffer.from(value, "utf8").toString("base64") } } });
    return last(version.name);
  }

  /** A secret's latest value, or null when there is none. */
  async function secretValue(id) {
    const version = await orNull(() => secrets("GET", `/${id}/versions/latest:access`));
    return version ? Buffer.from(version.payload.data, "base64").toString("utf8") : null;
  }

  /** The secrets labelled as an item of a deployment. */
  const secretsOf = (labels) => listAll("secretmanager", `v1/${P}/secrets`, "secrets", {
    filter: `labels.${LABEL.deployment}=${labels[LABEL.deployment]} AND labels.${LABEL.item}=${labels[LABEL.item]}`
  });

  /** A project role given to (or taken from) a machine's account: what writing its logs needs. */
  async function projectRole(role, email, grant) {
    const policy = await call("cloudresourcemanager", "POST", `v1/projects/${project}:getIamPolicy`, { body: {} });
    const member = `serviceAccount:${email}`;
    const bindings = (policy.bindings ?? []).map((binding) => ({ ...binding, members: [...(binding.members ?? [])] }));
    let binding = bindings.find((one) => one.role === role && !one.condition);
    if (grant === Boolean(binding?.members.includes(member))) return;
    if (!binding) bindings.push((binding = { role, members: [] }));
    binding.members = grant ? [...binding.members, member].sort() : binding.members.filter((one) => one !== member);
    await call("cloudresourcemanager", "POST", `v1/projects/${project}:setIamPolicy`, { body: { policy: { ...policy, bindings: bindings.filter((one) => one.members.length > 0) } } });
  }

  /** The registry's images readable by a machine's account, which pulls its service's image. */
  async function shareRegistry(email) {
    const at = `v1/${P}/locations/${region}/repositories/${REPOSITORY}`;
    const policy = await call("artifactregistry", "GET", `${at}:getIamPolicy`);
    const role = "roles/artifactregistry.reader";
    const member = `serviceAccount:${email}`;
    const binding = (policy.bindings ?? []).find((one) => one.role === role);
    if (binding?.members?.includes(member)) return;
    const bindings = [...(policy.bindings ?? []).filter((one) => one.role !== role), { role, members: [...(binding?.members ?? []), member].sort() }];
    await call("artifactregistry", "POST", `${at}:setIamPolicy`, { body: { policy: { bindings, ...(policy.etag ? { etag: policy.etag } : {}) } } });
  }

  return {
    call, listAll, orNull, orExisting, project, region, buildServiceAccount, P, networkUrl, subnet, subnetUrl,
    runSubnet, compute, run, sql, secrets, certificates, ids, kindOf, slow, failed, computeDone, operationDone, sqlDone,
    ensureCompute, deleteCompute, network, peering, registry, buildBucket, emailOf, account, shareSecret, putSecret,
    secretValue, secretsOf, projectRole, shareRegistry
  };
}

export { CONSUMER_LABEL, DESCRIPTION, HEALTH_RANGES, REPOSITORY, RUN_RANGE, SERVICE_PORT, createGoogleBase, last };
