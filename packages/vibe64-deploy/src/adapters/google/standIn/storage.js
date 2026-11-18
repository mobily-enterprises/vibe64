import { createHash, randomBytes } from "node:crypto";

import { labelsProblem } from "./platform.js";

// The stand-in's Cloud Storage JSON API: buckets (made, read, listed by project, deleted only when empty), their
// policies (uniform bucket-level access), objects (media uploads with ifGenerationMatch, reads with alt=media, listings,
// deletes) and HMAC keys of service accounts (deleted only once inactive). `takeName(name)` makes a bucket name another
// Google Cloud customer's: making it answers 409 conflict, reading it 403.

const BUCKET_NAME = /^[a-z0-9][a-z0-9_.-]{1,61}[a-z0-9]$/u;

function createStandInStorage(world) {
  const { project, projectNumber, answer, legacy } = world;
  /** @type {Map<string, { bucket: any, objects: Map<string, { meta: any, bytes: Buffer }> }>} */
  const buckets = new Map();
  /** @type {Set<string>} names another customer holds */
  const taken = new Set();
  /** @type {Map<string, any>} HMAC keys' metadata, by access id */
  const keys = new Map();

  const bucketView = (name) => structuredClone(buckets.get(name).bucket);
  const noBucket = () => legacy(404, "notFound", "The specified bucket does not exist.");
  const page = (items, query, field, kind) => {
    const size = Math.min(Number(query.get("maxResults") || 1000), 1000);
    const start = Number(query.get("pageToken") || 0);
    const slice = items.slice(start, start + size);
    return answer(200, { kind, ...(slice.length > 0 ? { [field]: structuredClone(slice) } : {}), ...(start + size < items.length ? { nextPageToken: String(start + size) } : {}) });
  };

  function bucketsRequest({ method, path, query, body }) {
    if (path === "storage/v1/b" && method === "POST") {
      if (query.get("project") !== project && query.get("project") !== projectNumber) return legacy(400, "invalid", "Invalid project.");
      const name = String(body?.name ?? "");
      if (!BUCKET_NAME.test(name)) return legacy(400, "invalid", "Invalid bucket name");
      if (taken.has(name)) return legacy(409, "conflict", "The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.");
      if (buckets.has(name)) return legacy(409, "conflict", "Your previous request to create the named bucket succeeded and you already own it.");
      const problem = labelsProblem(body.labels);
      if (problem) return legacy(400, "invalid", problem);
      const bucket = {
        kind: "storage#bucket", id: name, name, projectNumber, selfLink: `https://www.googleapis.com/storage/v1/b/${name}`, metageneration: "1",
        location: String(body.location ?? "US").toUpperCase(), locationType: "region", storageClass: body.storageClass ?? "STANDARD", etag: "CAE=",
        timeCreated: world.at(), updated: world.at(), ...(body.labels ? { labels: { ...body.labels } } : {}),
        iamConfiguration: structuredClone(body.iamConfiguration ?? { uniformBucketLevelAccess: { enabled: false } }),
        ...(body.lifecycle ? { lifecycle: structuredClone(body.lifecycle) } : {})
      };
      buckets.set(name, { bucket, objects: new Map() });
      world.setPolicy(`buckets/${name}`, { bindings: [{ role: "roles/storage.legacyBucketOwner", members: [`projectOwner:${project}`] }] });
      return answer(200, bucketView(name));
    }
    if (path === "storage/v1/b" && method === "GET") {
      if (query.get("project") !== project && query.get("project") !== projectNumber) return legacy(400, "invalid", "Invalid project.");
      return page([...buckets.values()].map(({ bucket }) => bucket), query, "items", "storage#buckets");
    }
    const one = /^storage\/v1\/b\/([^/]+)(\/iam)?$/u.exec(path);
    if (!one) return null;
    const name = decodeURIComponent(one[1]);
    if (taken.has(name)) return legacy(403, "forbidden", `The caller does not have storage.buckets.get access to the Google Cloud Storage bucket. Permission 'storage.buckets.get' denied on resource (or it may not exist).`);
    const found = buckets.get(name);
    if (!found) return noBucket();
    if (one[2]) {
      if (method === "GET") {
        const { etag, bindings } = world.policy(`buckets/${name}`);
        return answer(200, { kind: "storage#policy", resourceId: `projects/_/buckets/${name}`, version: 1, etag, bindings: structuredClone(bindings) });
      }
      if (method === "PUT") {
        if (!found.bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled) return legacy(400, "invalid", "Uniform bucket-level access is required.");
        const written = world.setPolicy(`buckets/${name}`, body);
        if (!written) return legacy(412, "conditionNotMet", "Precondition Failed");
        return answer(200, { kind: "storage#policy", resourceId: `projects/_/buckets/${name}`, version: 1, ...structuredClone(written) });
      }
      return null;
    }
    if (method === "GET") return answer(200, bucketView(name));
    if (method === "DELETE") {
      if (found.objects.size > 0) return legacy(409, "conflict", "The bucket you tried to delete is not empty.");
      buckets.delete(name);
      return answer(204, null);
    }
    return null;
  }

  function objectsRequest({ method, path, query, bytes, contentType }) {
    const upload = /^upload\/storage\/v1\/b\/([^/]+)\/o$/u.exec(path);
    if (upload && method === "POST") {
      const found = buckets.get(decodeURIComponent(upload[1]));
      if (!found) return noBucket();
      if (query.get("uploadType") !== "media") return legacy(400, "invalid", "Upload requests must include an uploadType URL parameter and a URL path beginning with /upload/");
      const name = query.get("name");
      if (!name) return legacy(400, "required", "Required parameter: name");
      const known = found.objects.get(name);
      const match = query.get("ifGenerationMatch");
      if (match !== null && String(known?.meta.generation ?? "0") !== match) {
        return legacy(412, "conditionNotMet", "At least one of the pre-conditions you specified did not hold.");
      }
      const meta = {
        kind: "storage#object", id: `${upload[1]}/${name}`, name, bucket: decodeURIComponent(upload[1]), generation: String(Date.parse(world.at()) * 1000 + found.objects.size + 1),
        metageneration: "1", contentType: contentType ?? "application/octet-stream", size: String(bytes.length), md5Hash: createHash("md5").update(bytes).digest("base64"),
        timeCreated: world.at(), updated: world.at(), storageClass: "STANDARD"
      };
      found.objects.set(name, { meta, bytes: Buffer.from(bytes) });
      return answer(200, structuredClone(meta));
    }
    const list = /^storage\/v1\/b\/([^/]+)\/o$/u.exec(path);
    if (list && method === "GET") {
      const found = buckets.get(decodeURIComponent(list[1]));
      if (!found) return noBucket();
      const prefix = query.get("prefix") ?? "";
      return page([...found.objects.values()].filter(({ meta }) => meta.name.startsWith(prefix)).map(({ meta }) => meta), query, "items", "storage#objects");
    }
    const one = /^storage\/v1\/b\/([^/]+)\/o\/([^/]+)$/u.exec(path);
    if (!one) return null;
    const found = buckets.get(decodeURIComponent(one[1]));
    if (!found) return noBucket();
    const object = found.objects.get(decodeURIComponent(one[2]));
    if (!object) return legacy(404, "notFound", `No such object: ${decodeURIComponent(one[1])}/${decodeURIComponent(one[2])}`);
    if (method === "GET") return query.get("alt") === "media" ? { status: 200, bytes: object.bytes } : answer(200, structuredClone(object.meta));
    if (method === "DELETE") {
      found.objects.delete(object.meta.name);
      return answer(204, null);
    }
    return null;
  }

  function hmacRequest({ method, path, query, body }) {
    const match = /^storage\/v1\/projects\/([^/]+)\/hmacKeys(?:\/([^/]+))?$/u.exec(path);
    if (!match || !world.isProject(match[1])) return null;
    if (!match[2] && method === "POST") {
      const email = query.get("serviceAccountEmail");
      if (!email || !world.platform.accountExists(email)) return legacy(400, "invalid", `Service Account '${email}' not found.`);
      if ([...keys.values()].filter((key) => key.serviceAccountEmail === email && key.state !== "DELETED").length >= 10) {
        return legacy(400, "invalid", "The service account has reached its limit of 10 HMAC keys.");
      }
      const accessId = `GOOG1E${randomBytes(30).toString("hex").toUpperCase().slice(0, 55)}`;
      const metadata = {
        kind: "storage#hmacKeyMetadata", id: `${project}/${accessId}`, accessId, projectId: project, serviceAccountEmail: email, state: "ACTIVE",
        timeCreated: world.at(), updated: world.at(), etag: "CAE="
      };
      keys.set(accessId, metadata);
      return answer(200, { kind: "storage#hmacKey", metadata: structuredClone(metadata), secret: randomBytes(30).toString("base64") });
    }
    const key = keys.get(match[2]);
    if (!key || key.state === "DELETED") return legacy(404, "notFound", "Access ID not found.");
    if (method === "PUT") {
      if (!["ACTIVE", "INACTIVE"].includes(body?.state)) return legacy(400, "invalid", "state must be ACTIVE or INACTIVE.");
      Object.assign(key, { state: body.state, updated: world.at() });
      return answer(200, structuredClone(key));
    }
    if (method === "DELETE") {
      if (key.state !== "INACTIVE") return legacy(400, "invalid", "Cannot delete keys in 'ACTIVE' state.");
      key.state = "DELETED";
      return answer(204, null);
    }
    return null;
  }

  return {
    request: (request) => bucketsRequest(request) ?? objectsRequest(request) ?? hmacRequest(request),
    objectBytes: (bucket, name) => buckets.get(bucket)?.objects.get(name)?.bytes ?? null,
    controls: Object.freeze({
      buckets: () => [...buckets.values()].map(({ bucket, objects }) => ({ ...structuredClone(bucket), objects: [...objects.keys()] })),
      bucket: (name) => (buckets.has(name) ? bucketView(name) : null),
      /** Puts an object in a bucket, as the app would through the S3 API. */
      putObject: (bucket, name, text) => buckets.get(bucket).objects.set(name, { meta: { name, generation: "1" }, bytes: Buffer.from(text) }),
      keys: () => [...keys.values()].map((one) => structuredClone(one)),
      takeName: (name) => taken.add(name)
    })
  };
}

export { createStandInStorage };
