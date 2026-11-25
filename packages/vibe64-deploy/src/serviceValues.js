// What a Deploy gives each App Service besides its release (steps.js): its settings, with each Reaches setting the
// address of the service it reaches, what the record keeps of them, and its connections to the services it reaches.
import { SERVICE_SETTING, sharesBuild } from "./builds.js";
import { settingValues } from "./package.js";

/** A service the given one reaches that the provider doesn't run yet (none made, or gone). */
const unmadeReach = (service, record, byId) => service.reaches.find((reach) => !byId.get(record.items[`service.${reach.service}`]?.id));

/**
 * The values a service is given, with each of its Reaches settings the reached service's private address: its own
 * (`internalUrl`) where the provider reports one, else `http://<internalName>:<port>`; null while one has no address.
 * A service that shares its build (builds.js) is given its id as V64_SERVICE, which its release's service script reads.
 * @param {any} service the need's service @param {any} context the run's context (`needs` its needs)
 * @param {Map<string, any>} byId
 */
function valuesOf(service, { record, release, needs }, byId) {
  const reached = {};
  for (const reach of service.reaches) {
    const thing = byId.get(record.items[`service.${reach.service}`]?.id);
    const address = thing?.internalUrl ?? (thing?.internalName ? `http://${thing.internalName}:${release.port}` : null);
    if (!address) return null;
    reached[reach.setting] = address;
  }
  return settingValues({
    declared: release.settings[service.id], env: release.env, domain: release.domain, aliases: service.exposure === "public" ? release.aliases ?? [] : [],
    trustedProxies: release.trustedProxies, port: release.port, reached,
    ...(needs && sharesBuild(needs, service.id) ? { own: { [SERVICE_SETTING]: service.id } } : {})
  });
}

/** What the record keeps of the settings a service was given: their hash and names. @param {any} values settingValues' */
const givenOf = (values) => ({ settingsHash: values.hash, settingNames: Object.keys({ ...values.settings, ...values.secrets }).sort() });

/**
 * What a release brings of a service's settings (steps.js's header, 4): `remove`, the names it was given before and no
 * longer, and `given`, what the record keeps once its refresh succeeded. A record that never kept the names it gave
 * (one from before them) keeps no hash then, so 6 replaces them once, dropping the names no longer given.
 * @param {any} values settingValues' @param {any} item the service's record
 */
function broughtOf(values, item) {
  const given = givenOf(values);
  const before = item?.settingNames ?? null;
  return {
    remove: before ? before.filter((name) => !given.settingNames.includes(name)) : [],
    given: before ? given : { ...given, settingsHash: null }
  };
}

/** The connections a service opens: one to each service it reaches, on the port services listen on, in Stack order. */
function connectionsOf(service, record, port) {
  return service.reaches.map((reach) => ({ to: record.items[`service.${reach.service}`]?.id ?? null, port }));
}

/**
 * The connections a service holds with those of connectionsOf it lacks added, never one taken away, or null when it
 * lacks none: what it needs before a release or settings that reach a service it doesn't reach yet (a service made
 * again in another's place, or new). The steps' 6 then leaves it exactly connectionsOf.
 * @param {any} service a need's service @param {{ connections?: any[] }} thing its App Service @param {any} record @param {number} port
 */
function connectionsAhead(service, thing, record, port) {
  const held = thing.connections ?? [];
  const lacking = connectionsOf(service, record, port).filter((one) => one.to && !held.some((other) => other.to === one.to && other.port === one.port));
  return lacking.length > 0 ? [...held, ...lacking] : null;
}

export { broughtOf, connectionsAhead, connectionsOf, givenOf, unmadeReach, valuesOf };
