import { randomInt } from "node:crypto";

// What the mobilynet stand-in's parts share (standIn.js): mobilynet's sizes, labels' rules, its listings' pages, the
// interfaces its hosted services provide and its apps need, and the catalogue of apps that run as hosted services, as
// mobilynet main c6af5ca3 has them (its machines package's shared/sizes.js and validation.js, its apps package's
// shared/interfaces, catalogue/packages/*.mobilynet.json; their summaries shortened).
// STAND-IN ONLY: the registry holds the four interfaces of the catalogue's four apps; a need of another of mobilynet's
// interfaces is refused as unknown.

/** mobilynet machine sizes: a hosted service's machine is one. */
const MACHINE_SIZES = Object.freeze({
  "m-1": Object.freeze({ vcpus: 1, memoryGib: 2 }),
  "m-2": Object.freeze({ vcpus: 2, memoryGib: 4 }),
  "m-4": Object.freeze({ vcpus: 4, memoryGib: 8 }),
  "m-8": Object.freeze({ vcpus: 8, memoryGib: 16 })
});
/** App Service instance sizes (machines' shared/services.js INSTANCE_SIZES). */
const INSTANCE_SIZES = Object.freeze({
  "a-1": Object.freeze({ vcpus: 1, memoryGib: 1 }),
  "a-2": Object.freeze({ vcpus: 2, memoryGib: 2 }),
  "a-4": Object.freeze({ vcpus: 4, memoryGib: 8 }),
  "a-8": Object.freeze({ vcpus: 8, memoryGib: 16 })
});
/**
 * mobilynet's regions (`us`, United States; `eu`, Europe), the first the default; only `us` has a host, so `eu` places
 * no machine (`503 no_capacity`) and lists no edge addresses.
 */
const REGIONS = Object.freeze(["us", "eu"]);
const REGION_NAMES = Object.freeze({ us: "United States", eu: "Europe" });
const HOST_REGIONS = Object.freeze(["us"]);
/**
 * How many settings and secrets an App Service of a region holds, its links' among them, as mobilynet's regions list
 * says (`serviceSettingsMax`, its regions.js): one fewer than the entries the region's hosts take for an instance's app,
 * 199 where every one runs agent 2.9.0 or later, 49 while one runs an earlier agent (the `olderHost` fault). A region
 * with no host takes the protocol's most.
 */
const SERVICE_SETTINGS = Object.freeze({ current: 199, earlier: 49 });
/** The addresses a region's edge answers from. */
const EDGE_ADDRESSES = Object.freeze(["203.0.113.40", "203.0.113.41"]);
/** The stand-in's apps domain, which every thing's own name is under. */
const APPS_DOMAIN = "mobilynet.standin";

// Labels, as a mobilynet machine's (validation.js labels), App Services' and hosted services' (engine-support M2).
const LABEL_KEY = /^[a-z0-9](?:[a-z0-9._/-]{0,61}[a-z0-9])?$/u;
const MAX_LABELS = 20;
const MAX_LABEL_VALUE = 256;
const RESERVED_LABEL_PREFIX = "mobilynet";

/** A plain object (not null, not an array). @param {unknown} value */
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A thing's own name, as mobilynet's publicNames.js makes it: its id with the `_` made a `-`, in its region's names
 * zone, `svc-…` for an App Service.
 * @param {{ id: string, region: string }} thing
 */
const thingName = (thing) => `${thing.id.replace("_", "-")}.${thing.region}.${APPS_DOMAIN}`;

/**
 * A route's own name, region-free, in the routes zone (`rte-…`): its CNAME target, which stays while the route does,
 * whatever it sends to. @param {{ id: string }} route
 */
const routeName = (route) => `${route.id.replace("_", "-")}.routes.${APPS_DOMAIN}`;

/** A project's label in internal names: its id with a hyphen. @param {string} projectId */
const projectLabel = (projectId) => projectId.replace("_", "-");

/** One page of a listing, as mobilynet pages its lists. @param {any[]} items @param {URLSearchParams} query */
function pageOf(items, query) {
  const after = Number(query.get("after") || 0);
  const limit = Math.min(Number(query.get("limit") || 100), 100);
  return { items: items.slice(after, after + limit), next: after + limit < items.length ? String(after + limit) : null };
}

/**
 * A thing's labels as given, or the field errors mobilynet refuses them with (validation.js labels): at most 20, each
 * key up to 63 lowercase letters, digits, dots, slashes and hyphens, none starting with `mobilynet`, each value text of
 * up to 256 characters without control characters.
 * @param {unknown} value
 * @returns {{ errors: Record<string, string> } | { labels: Record<string, string> }}
 */
function labelsOf(value) {
  if (!isRecord(value)) return { errors: { labels: "An object of label names to values." } };
  const entries = Object.entries(value);
  if (entries.length > MAX_LABELS) return { errors: { labels: `At most ${MAX_LABELS} labels.` } };
  for (const [key, text] of entries) {
    if (!LABEL_KEY.test(key)) return { errors: { [`labels.${key}`]: "Up to 63 lowercase letters, digits, dots, slashes and hyphens." } };
    if (key.startsWith(RESERVED_LABEL_PREFIX)) return { errors: { [`labels.${key}`]: "Labels starting with mobilynet are MobilyNet's." } };
    const control = typeof text === "string" && [...text].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f);
    if (typeof text !== "string" || text.length > MAX_LABEL_VALUE || control) {
      return { errors: { [`labels.${key}`]: `A value of up to ${MAX_LABEL_VALUE} characters, without control characters.` } };
    }
  }
  return { labels: Object.fromEntries(entries) };
}

/**
 * Whether a thing's labels hold every `key:value` a list's `label` filter asks for (repeatable, each matched).
 * @param {Record<string, string>} labels @param {URLSearchParams} query
 */
function labelsMatch(labels, query) {
  return query.getAll("label").every((asked) => {
    const at = asked.indexOf(":");
    return at > 0 && labels[asked.slice(0, at)] === asked.slice(at + 1);
  });
}

const field = (name, title, type, secret, from, more = {}) => Object.freeze({ name, title, type, secret, from, ...more });
const PASSWORD = Object.freeze({ alphabet: "base64url", length: 43 });

const INTERFACES = Object.freeze([
  Object.freeze({
    id: "postgresql",
    title: "PostgreSQL",
    like: "Amazon RDS for PostgreSQL",
    icon: "database",
    fields: Object.freeze([
      field("host", "Host", "string", false, "mobilynet", { value: "host" }),
      field("port", "Port", "integer", false, "mobilynet", { value: "port" }),
      field("database", "Database name", "string", false, "provider"),
      field("user", "User", "string", false, "credential", { make: "link" }),
      field("password", "Password", "string", true, "credential", { make: PASSWORD }),
      field("sslmode", "SSL mode", "string", false, "provider")
    ])
  }),
  Object.freeze({
    id: "mysql",
    title: "MySQL",
    like: "Amazon RDS for MariaDB",
    icon: "database",
    fields: Object.freeze([
      field("host", "Host", "string", false, "mobilynet", { value: "host" }),
      field("port", "Port", "integer", false, "mobilynet", { value: "port" }),
      field("database", "Database name", "string", false, "provider"),
      field("user", "User", "string", false, "credential", { make: "link" }),
      field("password", "Password", "string", true, "credential", { make: PASSWORD }),
      field("sslmode", "SSL mode", "string", false, "provider")
    ])
  }),
  Object.freeze({
    id: "redis",
    title: "Redis",
    like: "Amazon ElastiCache",
    icon: "memory",
    fields: Object.freeze([
      field("host", "Host", "string", false, "mobilynet", { value: "host" }),
      field("port", "Port", "integer", false, "mobilynet", { value: "port" }),
      field("username", "Username", "string", false, "credential", { make: "link" }),
      field("password", "Password", "string", true, "credential", { make: PASSWORD }),
      field("db", "Database number", "integer", false, "provider")
    ])
  }),
  Object.freeze({
    id: "s3",
    title: "S3 object storage",
    like: "Amazon S3",
    icon: "storage",
    fields: Object.freeze([
      field("endpoint", "Endpoint", "string", false, "mobilynet", { value: "url" }),
      field("region", "Region", "string", false, "provider"),
      field("bucket", "Bucket", "string", false, "provider"),
      field("accessKeyId", "Access key ID", "string", false, "credential", { make: Object.freeze({ prefix: "GK", alphabet: "hex", length: 24 }) }),
      field("secretAccessKey", "Secret access key", "string", true, "credential", { make: Object.freeze({ alphabet: "hex", length: 64 }) })
    ])
  })
]);

const SIZES_OF = (disks) => Object.freeze(Object.fromEntries(["small", "medium", "large", "xlarge"].map((name, index) => [
  name, Object.freeze({ size: ["m-1", "m-2", "m-4", "m-8"][index], dataDisk: disks[index] })
])));

/** The catalogue's apps that run as hosted services (catalogue/packages/*.mobilynet.json, provides normalised). */
const CATALOGUE = Object.freeze([
  {
    app: "postgresql-18",
    title: "PostgreSQL 18",
    summary: "The PostgreSQL 18 server, run as an app: one cluster, a role and a database from its settings.",
    settings: {
      role: { type: "string", required: true, description: "The role that owns the database and signs in with the password." },
      password: { type: "string", secret: true, required: true, description: "The role's password." },
      database: { type: "string", required: true, description: "The database made for the role, if it isn't there yet." }
    },
    provides: {
      interface: "postgresql",
      version: "18",
      port: 5432,
      defaultSize: "small",
      sizes: SIZES_OF([10, 40, 100, 250]),
      settings: { role: { literal: "owner" }, password: { generate: "ownerPassword", alphabet: "base64url", length: 43 }, database: { ask: "optional", default: "app" } },
      connection: { database: { setting: "database" }, sslmode: { literal: "disable" } },
      metrics: {
        connections: { label: "Connections", unit: "count", limit: "maxConnections", warn: 0.8, fail: 0.95 },
        maxConnections: { label: "Connection limit", unit: "count" },
        databaseBytes: { label: "Database size", unit: "bytes", limit: "dataDiskBytes", warn: 0.8, fail: 0.95 }
      }
    }
  },
  {
    app: "mariadb-11-4",
    title: "MariaDB 11.4",
    summary: "The MariaDB 11.4 server, run as an app: a user and a database from its settings.",
    settings: {
      user: { type: "string", required: true, description: "The user that owns the database and signs in with the password." },
      password: { type: "string", secret: true, required: true, description: "The user's password." },
      database: { type: "string", required: true, description: "The database made for the user, if it isn't there yet." }
    },
    provides: {
      interface: "mysql",
      version: "11.4",
      port: 3306,
      defaultSize: "small",
      sizes: SIZES_OF([10, 40, 100, 250]),
      settings: { user: { literal: "owner" }, password: { generate: "ownerPassword", alphabet: "base64url", length: 43 }, database: { ask: "optional", default: "app" } },
      connection: { database: { setting: "database" }, sslmode: { literal: "DISABLED" } },
      metrics: {
        connections: { label: "Connections", unit: "count", limit: "maxConnections", warn: 0.8, fail: 0.95 },
        maxConnections: { label: "Connection limit", unit: "count" },
        refusedConnections: { label: "Connections refused at the limit", unit: "count", warn: 1, fail: 50 }
      }
    }
  },
  {
    app: "valkey-9",
    title: "Valkey 9",
    summary: "The Valkey 9 server, run as an app: a key-value store that clients sign in to with its password.",
    settings: {
      password: { type: "string", secret: true, required: true, description: "The default user's password, which a client signs in with by the password alone." },
      mode: { type: "string", description: "Store (keeps every key, refusing writes when full) or cache (drops the least recently used keys)" }
    },
    provides: {
      interface: "redis",
      version: "9",
      port: 6379,
      defaultSize: "small",
      sizes: SIZES_OF([10, 20, 30, 50]),
      settings: { password: { generate: "adminPassword", alphabet: "base64url", length: 43 }, mode: { ask: "optional", default: "store" } },
      connection: { db: { literal: 0 } },
      metrics: {
        storeMemoryBytes: { label: "Memory used (writes are refused when full)", unit: "bytes", limit: "maxMemoryBytes", warn: 0.8, fail: 0.95 },
        cacheMemoryBytes: { label: "Memory used (old keys make room when full)", unit: "bytes", limit: "maxMemoryBytes" },
        maxMemoryBytes: { label: "Memory limit", unit: "bytes" }
      }
    }
  },
  {
    app: "garage-2",
    title: "Garage 2",
    summary: "Garage 2, S3-compatible object storage, run as an app: one node with one bucket, which each link reads and writes with an access key of its own, behind an HAProxy front.",
    settings: {
      region: { type: "string", required: true, description: "The S3 region clients sign their requests for." },
      bucket: { type: "string", required: true, description: "The one bucket made for the service's files, which every link reads and writes." },
      rpcSecret: { type: "string", secret: true, required: true, description: "Garage's RPC secret, 32 bytes as 64 hex digits." }
    },
    provides: {
      interface: "s3",
      version: "2",
      port: 3900,
      defaultSize: "small",
      sizes: SIZES_OF([50, 250, 1000, 2000]),
      settings: { region: { mobilynet: "region" }, bucket: { ask: "optional", default: "files" }, rpcSecret: { generate: "rpcSecret", alphabet: "hex", length: 64 } },
      connection: { region: { setting: "region" }, bucket: { setting: "bucket" } },
      metrics: {
        dataBytes: { label: "Data disk used", unit: "bytes", limit: "dataDiskBytes", warn: 0.8, fail: 0.95 },
        bucketBytes: { label: "Files stored", unit: "bytes", limit: "bucketQuotaBytes", warn: 0.85, fail: 0.97 },
        bucketQuotaBytes: { label: "Bucket quota", unit: "bytes" }
      }
    }
  }
].map((entry) => Object.freeze(entry)));

const ALPHABETS = Object.freeze({
  base32: "abcdefghijklmnopqrstuvwxyz234567",
  hex: "0123456789abcdef",
  base64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
});

/** A need's name (`as`), as mobilynet's NEED_NAME takes it. */
const NEED_NAME = /^[A-Z][A-Z0-9_]{0,23}$/u;
/** At most this many needs a declaration. */
const MAX_NEEDS = 10;

/** @param {unknown} id */
const interfaceNamed = (id) => INTERFACES.find((entry) => entry.id === id) ?? null;
/** @param {unknown} app */
const catalogueApp = (app) => CATALOGUE.find((entry) => entry.app === app) ?? null;

/**
 * The setting a need's field is given as: `<as>_<FIELD>`, the field in capitals with an underscore between its words.
 * @param {string} as @param {string} name
 */
const needSettingName = (as, name) => `${as}_${name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toUpperCase()}`;

/** The settings a need's link gives it, in its interface's order: `{ name, field, type, secret }`. @param {{ interface: string, as: string }} need */
function needSettings(need) {
  return (interfaceNamed(need.interface)?.fields ?? []).map((one) => ({
    name: needSettingName(need.as, one.name), field: one.name, type: one.type, secret: one.secret
  }));
}

/** Random text of a rule's alphabet and length after its prefix. @param {{ prefix?: string, alphabet: string, length: number }} rule */
function randomText({ prefix = "", alphabet, length }) {
  const characters = ALPHABETS[alphabet];
  let text = prefix;
  for (let at = 0; at < length; at += 1) text += characters[randomInt(characters.length)];
  return text;
}

/**
 * A link's new credential: each credential field made by its `make`, split into those that aren't secret and those that
 * are (hostedValues.js newCredential).
 * @param {string} interfaceId @param {string} linkId
 */
function newCredential(interfaceId, linkId) {
  const plain = {};
  const secret = {};
  for (const one of interfaceNamed(interfaceId)?.fields ?? []) {
    if (one.from !== "credential") continue;
    const value = one.make === "link" ? linkId : randomText(one.make);
    if (one.secret) secret[one.name] = value;
    else plain[one.name] = value;
  }
  return { plain, secret };
}

/**
 * The settings a need is given by its link: each field as `<AS>_<FIELD>`, from the connection and the credential, the
 * secret ones apart (hostedValues.js needValues).
 * @param {{ as: string, interface: string }} need
 * @param {Record<string, unknown>} connection
 * @param {{ plain: Record<string, string>, secret: Record<string, string> }} credential
 */
function needValues(need, connection, credential) {
  const settings = {};
  const secrets = {};
  for (const one of interfaceNamed(need.interface)?.fields ?? []) {
    const name = needSettingName(need.as, one.name);
    if (one.from !== "credential") settings[name] = connection[one.name];
    else if (one.secret) secrets[name] = credential.secret[one.name];
    else settings[name] = credential.plain[one.name];
  }
  return { settings, secrets };
}

export {
  CATALOGUE,
  EDGE_ADDRESSES,
  HOST_REGIONS,
  INSTANCE_SIZES,
  INTERFACES,
  MACHINE_SIZES,
  MAX_NEEDS,
  NEED_NAME,
  REGIONS,
  REGION_NAMES,
  SERVICE_SETTINGS,
  catalogueApp,
  interfaceNamed,
  isRecord,
  labelsMatch,
  labelsOf,
  needSettings,
  needValues,
  newCredential,
  pageOf,
  projectLabel,
  randomText,
  routeName,
  thingName
};
