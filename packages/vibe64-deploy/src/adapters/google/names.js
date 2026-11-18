import { createHash } from "node:crypto";

import { LABEL } from "../../record.js";

// How the Google Cloud adapter names what it makes, and how Vibe64's labels are written there. Google's label values
// take only lowercase letters, digits, `_` and `-` (at most 63), so the item label `<kind>.<name>` is written
// `<kind>_<name>` with the name escaped (`-` as `--`, a capital as `-` and its lowercase letter) and read back the same
// way; the other labels' values (a deployment id, an app and an environment) are Google's form already.

// The shared network every service and database of a Google Cloud project is on, its subnet in a region, and the tag
// every Vibe64 machine carries (the health checks' firewall rule opens its port).
const NETWORK = "vibe64";
const subnetOf = (region) => `vibe64-${region}`;
// The subnet Cloud Run services' Direct VPC egress leaves from: apart from the machines', so a firewall rule can tell
// them apart by range (Cloud Run's egress carries no network tag an ingress rule matches).
const runSubnetOf = (region) => `vibe64-${region}-run`;
const SERVICE_TAG = "vibe64-service";
// The label the adapter adds to say a thing is Vibe64's own shared part (the build bucket), never a deployment's item.
const SHARED_LABEL = "vibe64-shared";
const LABEL_VALUE = /^[a-z0-9_-]{0,63}$/u;

/** A hex digest's first `length` characters. @param {string} text @param {number} length */
function hashOf(text, length) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, length);
}

/** An item label's value in Google's form. @param {string} item `<kind>.<name>` */
function itemLabel(item) {
  const [, kind, name] = /^(service|resource)\.(.+)$/u.exec(item) ?? [];
  if (!kind) throw new TypeError(`${item} isn't an item, <kind>.<name>.`);
  const value = `${kind}_${name.replace(/-/gu, "--").replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
  if (!LABEL_VALUE.test(value)) throw new TypeError(`${item} is too long for a Google Cloud label (63 characters): give it a shorter name in genesis/stack.md.`);
  return value;
}

/** An item label's value as the engine reads it, or null when it isn't one. @param {string} value */
function itemOfLabel(value) {
  const [, kind, name] = /^(service|resource)_(.+)$/u.exec(String(value ?? "")) ?? [];
  if (!kind) return null;
  return `${kind}.${name.replace(/-(-|[a-z])/gu, (_, next) => (next === "-" ? "-" : next.toUpperCase()))}`;
}

/** Vibe64's labels as Google keeps them. @param {Record<string, string>} labels */
function googleLabels(labels) {
  const written = {};
  for (const [key, value] of Object.entries(labels)) {
    written[key] = key === LABEL.item ? itemLabel(value) : String(value);
    if (!LABEL_VALUE.test(written[key])) throw new TypeError(`The label ${key}=${value} isn't one Google Cloud takes.`);
  }
  return written;
}

/** Google's labels as the engine reads them: the item label read back, others as they are. @param {Record<string, string> | undefined} labels */
function engineLabels(labels) {
  const read = { ...(labels ?? {}) };
  if (read[LABEL.item] !== undefined) {
    const item = itemOfLabel(read[LABEL.item]);
    if (item) read[LABEL.item] = item;
    else delete read[LABEL.item];
  }
  return read;
}

/** The network tag of a service's machines and Cloud Run instances, which firewall rules name. @param {string} name */
const tagOf = (name) => `v64-${name}`;

/** A service's runtime service account's id: 6 to 30 characters, from its name. @param {string} name */
const accountIdOf = (name) => `v64-${name.slice(0, 19).replace(/-+$/u, "")}-${hashOf(name, 6)}`;

/** A bucket's name, unique across Google Cloud: the resource's name and a digest of the project. @param {string} name @param {string} project */
const bucketNameOf = (name, project) => `${name}-${hashOf(project, 8)}`;

/** The names of what a domain is at Google Cloud: its DNS authorisation, certificate, map and address. @param {string} domain */
const domainNameOf = (domain) => `v64-${domain.toLowerCase().replace(/[^a-z0-9]+/gu, "-").slice(0, 40).replace(/-+$/u, "")}-${hashOf(domain, 6)}`;

export {
  NETWORK, SERVICE_TAG, SHARED_LABEL, accountIdOf, bucketNameOf, domainNameOf, engineLabels, googleLabels, hashOf, itemLabel, itemOfLabel, runSubnetOf,
  subnetOf, tagOf
};
