import { randomBytes } from "node:crypto";

import { LABEL } from "../../record.js";
import { needSetting } from "../mobilynet/declaration.js";
import { CONSUMER_LABEL, last } from "./base.js";
import { GoogleError } from "./client.js";
import { bucketNameOf, engineLabels, googleLabels, SHARED_LABEL } from "./names.js";
import { DATA_DISK_GIB } from "./prices.js";

// The Google Cloud adapter's resources: a database as a Cloud SQL instance on a private address of the shared network,
// a bucket as Cloud Storage, and the credentials each gives a service: the database's one login (its password in
// Secret Manager), a bucket's HMAC key of the service's own account.

const DATABASE_VERSIONS = Object.freeze({ postgresql: "POSTGRES_16", mysql: "MYSQL_8_4" });
const DATABASE_PORTS = Object.freeze({ postgresql: "5432", mysql: "3306" });
// The objects a step deletes from a bucket it is deleting, at most, before it asks to be tried again.
const OBJECTS_PER_DELETE = 1000;

function createGoogleResources(g) {
  const {
    call, listAll, orNull, orExisting, project, region, P, networkUrl, sql, secrets, ids, kindOf, failed, sqlDone, peering, emailOf,
    shareSecret, putSecret, secretValue, secretsOf
  } = g;

  // --- Resources and their credentials ------------------------------------------------------------------------------

  /** The project's Cloud SQL instances and buckets, as the inventory reads them, the build bucket left out. */
  async function resourcesNow() {
    const [databases, buckets] = await Promise.all([
      listAll("sqladmin", `v1/${P}/instances`, "items", {}, { pageSize: "maxResults" }),
      listAll("storage", "storage/v1/b", "items", { project }, { pageSize: "maxResults" })
    ]);
    const state = { RUNNABLE: "running", PENDING_CREATE: "creating", MAINTENANCE: "updating", FAILED: "failed", SUSPENDED: "failed" };
    return [
      ...databases.map((one) => ({
        id: ids.database(one.name), name: one.name, kind: "resource", labels: engineLabels(one.settings?.userLabels), size: one.settings?.tier ?? null,
        resourceKind: String(one.databaseVersion ?? "").startsWith("POSTGRES") ? "postgresql" : String(one.databaseVersion ?? "").startsWith("MYSQL") ? "mysql" : null,
        state: state[one.state] ?? "updating", lastError: one.state === "FAILED" ? { message: `Cloud SQL reports ${one.name} failed.` } : null,
        privateAddress: (one.ipAddresses ?? []).find((address) => address.type === "PRIVATE")?.ipAddress ?? null
      })),
      ...buckets.filter((one) => !one.labels?.[SHARED_LABEL]).map((one) => ({
        id: ids.bucket(one.name), name: one.name, kind: "resource", labels: engineLabels(one.labels), size: "standard", resourceKind: "bucket",
        state: "running", lastError: null
      }))
    ];
  }

  /** The resource of a deployment labelled as an item, as resourcesNow reads it. */
  async function resourceLabelled(deploymentId, resource) {
    const found = (await resourcesNow()).find((one) => one.labels[LABEL.deployment] === deploymentId && one.labels[LABEL.item] === `resource.${resource}`);
    if (!found) throw failed(`${resource} isn't at Google Cloud yet, so a service can't be given its settings.`, "resource_missing");
    return found;
  }

  const databaseLogin = (labels) => String(labels[LABEL.app] ?? "app").replace(/[^a-z0-9_]/gu, "_").slice(0, 32);

  /**
   * The settings a resource gives a service (each `V64_<RESOURCE>_<FIELD>`, a secret one as Secret Manager's), its
   * credential made when it has none: a database's one login (shared by every service, so each can use the tables
   * another migrated) with its password in Secret Manager; a bucket's HMAC key of the service's own account, which may
   * use the bucket's objects.
   * @param {{ resource: string, as: string }} need @param {any} thing the resource @param {string} name the service @param {string} email its account
   */
  async function credentialEnv(need, thing, name, email) {
    const field = (key) => needSetting(need.as, key);
    const resourceLabels = googleLabels(thing.labels);
    if (thing.resourceKind === "bucket") {
      const id = `${thing.name}-${name}-key`.slice(0, 255);
      let secret = await orNull(() => secrets("GET", `/${id}`));
      if (!secret) {
        const policy = await call("storage", "GET", `storage/v1/b/${thing.name}/iam`);
        const role = "roles/storage.objectAdmin";
        const member = `serviceAccount:${email}`;
        const bindings = (policy.bindings ?? []).filter((binding) => binding.role !== role);
        const members = new Set((policy.bindings ?? []).find((binding) => binding.role === role)?.members ?? []);
        if (!members.has(member)) {
          await call("storage", "PUT", `storage/v1/b/${thing.name}/iam`, { body: { ...policy, bindings: [...bindings, { role, members: [...members, member].sort() }] } });
        }
        const key = await call("storage", "POST", `storage/v1/projects/${project}/hmacKeys`, { query: { serviceAccountEmail: email } });
        await putSecret(id, key.secret, { ...resourceLabels, [CONSUMER_LABEL]: name }, email, { "vibe64-access-id": key.metadata.accessId });
        secret = { annotations: { "vibe64-access-id": key.metadata.accessId } };
      }
      return [
        { name: field("bucket"), value: thing.name },
        { name: field("endpoint"), value: "https://storage.googleapis.com" },
        // Cloud Storage takes any region in a request's signature; S3 clients are given auto, as its guides do.
        { name: field("region"), value: "auto" },
        { name: field("accessKeyId"), value: secret.annotations?.["vibe64-access-id"] ?? "" },
        { name: field("secretAccessKey"), valueSource: { secretKeyRef: { secret: id, version: "latest" } } }
      ];
    }
    const id = `${thing.name}-password`;
    const login = databaseLogin(thing.labels);
    let password = await secretValue(id);
    if (password === null) {
      password = randomBytes(24).toString("base64url");
      await putSecret(id, password, resourceLabels);
    }
    // The login is made with the password its secret holds, which is made first: a step cut short makes it next time.
    const { items: users = [] } = await sql("GET", `instances/${thing.name}/users`);
    if (!users.some((user) => user.name === login)) await sqlDone(await sql("POST", `instances/${thing.name}/users`, { body: { name: login, password } }));
    const { items: databases = [] } = await sql("GET", `instances/${thing.name}/databases`);
    if (!databases.some((database) => database.name === login)) await sqlDone(await sql("POST", `instances/${thing.name}/databases`, { body: { name: login } }));
    await shareSecret(id, email);
    return [
      { name: field("host"), value: thing.privateAddress ?? "" },
      { name: field("port"), value: DATABASE_PORTS[thing.resourceKind] },
      { name: field("database"), value: login },
      { name: field("user"), value: login },
      { name: field("password"), valueSource: { secretKeyRef: { secret: id, version: "latest" } } }
    ];
  }

  /** A bucket key's secret deleted, the HMAC key it names first made inactive (Google deletes only an inactive key). */
  async function deleteBucketKey(secret) {
    const accessId = secret?.annotations?.["vibe64-access-id"];
    if (accessId) {
      await orNull(() => call("storage", "PUT", `storage/v1/projects/${project}/hmacKeys/${accessId}`, { body: { state: "INACTIVE" } }));
      await orNull(() => call("storage", "DELETE", `storage/v1/projects/${project}/hmacKeys/${accessId}`));
    }
    await orNull(() => secrets("DELETE", `/${last(secret.name)}`));
  }

  /** The settings every resource a release needs gives a service. */
  async function linksEnv(needs, labels, name, email) {
    const env = [];
    for (const need of needs) env.push(...await credentialEnv(need, await resourceLabelled(labels[LABEL.deployment], need.resource), name, email));
    return env;
  }

  // --- Resources ------------------------------------------------------------------------------------------------------

  /**
   * A resource made, labelled: a database as Cloud SQL on the shared network's private range, kept from deletion; a
   * bucket private, its objects reached through the S3-compatible API. One already there under that name is adopted
   * only when it carries this deployment's labels.
   */
  async function createResource({ name, kind, size, labels }) {
    const written = googleLabels(labels);
    const taken = () => failed(`${name} is taken at Google Cloud by something that isn't this deployment's: rename the resource in genesis/stack.md.`, "name_taken");
    if (kind === "bucket") {
      const bucket = bucketNameOf(name, project);
      const made = await orExisting(() => call("storage", "POST", "storage/v1/b", {
        query: { project },
        body: {
          name: bucket, location: region, storageClass: "STANDARD", labels: written,
          iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" }
        }
      }));
      if (!made) {
        // Taken: by this deployment (made by a step cut short), or by another, whose bucket this account can't read (403).
        const found = await orNull(() => call("storage", "GET", `storage/v1/b/${bucket}`)).catch((error) => {
          if (error?.status === 403) return null;
          throw error;
        });
        if (found?.labels?.[LABEL.deployment] !== written[LABEL.deployment]) throw taken();
      }
      return { id: ids.bucket(bucket), name: bucket, size: "standard" };
    }
    const found = (await listAll("sqladmin", `v1/${P}/instances`, "items", {}, { pageSize: "maxResults" })).find((one) => one.name === name);
    if (found && found.settings?.userLabels?.[LABEL.deployment] !== written[LABEL.deployment]) throw taken();
    if (!found) {
      await peering();
      // Refused 409 for a name a database deleted in the last week had: Google's message says so.
      await sql("POST", "instances", {
        body: {
          name, region, databaseVersion: DATABASE_VERSIONS[kind],
          settings: {
            tier: size, edition: "ENTERPRISE", availabilityType: "ZONAL", userLabels: written,
            ipConfiguration: { ipv4Enabled: false, privateNetwork: networkUrl },
            backupConfiguration: { enabled: true, ...(kind === "postgresql" ? { pointInTimeRecoveryEnabled: true } : { binaryLogEnabled: true }) },
            dataDiskSizeGb: String(DATA_DISK_GIB), storageAutoResize: true, deletionProtectionEnabled: true
          }
        }
      });
    }
    return { id: ids.database(name), name, size };
  }

  /** Deletes a resource and its data (the engine's deleteResource, never a Deploy): its credentials and keys with it. */
  async function deleteResource(id) {
    const thing = (await resourcesNow()).find((one) => one.id === id);
    if (!thing) return { removed: true };
    const keys = thing.labels[LABEL.deployment] ? await secretsOf(googleLabels(thing.labels)) : [];
    if (thing.resourceKind === "bucket") {
      const objects = await call("storage", "GET", `storage/v1/b/${thing.name}/o`, { query: { maxResults: OBJECTS_PER_DELETE } });
      for (const object of objects.items ?? []) await orNull(() => call("storage", "DELETE", `storage/v1/b/${thing.name}/o/${encodeURIComponent(object.name)}`));
      if (objects.nextPageToken) {
        throw new GoogleError({ status: 409, code: "bucket_emptying", message: `${thing.name} still holds files after ${OBJECTS_PER_DELETE} were deleted: delete it again to go on.`, retryable: true });
      }
      await orNull(() => call("storage", "DELETE", `storage/v1/b/${thing.name}`));
    } else {
      await sqlDone(await sql("PATCH", `instances/${thing.name}`, { body: { settings: { deletionProtectionEnabled: false } } }));
      await orNull(() => sql("DELETE", `instances/${thing.name}`));
    }
    for (const key of keys) await deleteBucketKey(key);
    return { removed: true };
  }

  /** A link's id: the resource's and the service's names. */
  const linkIdOf = (resource, service) => `${resource}~${service}`;

  /** A database's tier changed (a bucket has one size). */
  const resizeResource = async (id, size) => (kindOf(id) === "database" ? sql("PATCH", `instances/${last(id)}`, { body: { settings: { tier: size } } }) : null);

  /** Links a resource to a service: its credential, made when the service was made or released, answered. */
  async function linkResource(id, serviceId, need) {
    const thing = (await resourcesNow()).find((one) => one.id === id);
    if (!thing) throw failed(`${last(id)} is gone at Google Cloud.`, "resource_missing");
    const service = last(serviceId);
    await credentialEnv({ resource: thing.labels[LABEL.item]?.slice("resource.".length) ?? last(id), as: need }, thing, service, emailOf(service));
    return { id: linkIdOf(thing.name, service) };
  }

  /** Ends a link: the service's account no longer reads the credential; a bucket's key of that service is deleted. */
  async function unlinkResource(id, linkId) {
    const service = String(linkId).split("~")[1];
    const thing = (await resourcesNow()).find((one) => one.id === id);
    if (!thing || !service) return { removed: true };
    const email = emailOf(service);
    if (thing.resourceKind === "bucket") {
      const key = await orNull(() => secrets("GET", `/${thing.name}-${service}-key`));
      if (key) await deleteBucketKey(key);
      const policy = await call("storage", "GET", `storage/v1/b/${thing.name}/iam`);
      const bindings = (policy.bindings ?? []).map((binding) => ({ ...binding, members: (binding.members ?? []).filter((member) => member !== `serviceAccount:${email}`) }))
        .filter((binding) => binding.members.length > 0);
      await call("storage", "PUT", `storage/v1/b/${thing.name}/iam`, { body: { ...policy, bindings } });
    } else {
      await orNull(() => shareSecret(`${thing.name}-password`, email, false));
    }
    return { removed: true };
  }

  return { resourcesNow, credentialEnv, deleteBucketKey, linksEnv, createResource, deleteResource, resizeResource, linkResource, unlinkResource };
}

export { createGoogleResources };
