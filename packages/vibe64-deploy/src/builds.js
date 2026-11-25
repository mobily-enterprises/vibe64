// Which services of a Deployment share one build. Every service builds from the one archive (the saved commit with the
// shared build script and one serve script per service), so services that would run the same release need one build
// between them, not one each. Services are built together when nothing of what a provider keeps per release differs
// between them: their health path (a provider checks one per release: mobilynet's declaration, its `check`) and their
// sandbox allowances (a machine's kernel features, mobilynet's `machineFeatures`, are the release's). Everything else
// stays each service's own, as its App Service's: its exposure, how it is reached, its size, its count, its settings
// and its serve command, which the release's one service script picks by the service's V64_SERVICE setting.
//
// A shared build's app is named after its lead: the group's public service, else its first in the Stack's order, so
// a public service keeps its App Service, its routes and its domain when a Deployment of one app per service moves to
// one app per build. A service alone in its build is its own lead, and its app keeps the name it always had.

// mobilynet's app names (logins too) have at most 32 characters, which every provider's names keep to.
const APP_NAME_MAX = 32;
// The setting naming the service an instance runs, given to each service of a shared build (package.js settingValues).
const SERVICE_SETTING = "V64_SERVICE";

/**
 * The name of a service's app (its build's, for a service in a shared build: the lead's): the app's name and the
 * service's id, the app's part shortened so the whole fits APP_NAME_MAX.
 * @param {string} app the deployment's app name @param {string} service
 */
function serviceAppName(app, service) {
  return `${app.slice(0, APP_NAME_MAX - service.length - 1).replace(/-+$/u, "")}-${service}`;
}

/** What a provider keeps per release of a Deployment's service: its health path and its sandbox allowances. */
function buildKeyOf(service) {
  return JSON.stringify([service.readyWhen?.path ?? null, [...(service.sandboxAllowances ?? [])].sort()]);
}

/**
 * Each service's lead, by its id: the service whose build it shares, the group's public service, else its first in
 * the Stack's order; a service alone in its build leads itself.
 * @param {ReadonlyArray<{ id: string, exposure?: string, readyWhen?: { path?: string }, sandboxAllowances?: string[] }>} services
 *   the Deployment's services as public Vibe64 inspected them (v2)
 * @returns {Record<string, string>}
 */
function buildLeadsOf(services) {
  const groups = new Map();
  for (const service of services) {
    const key = buildKeyOf(service);
    groups.set(key, [...(groups.get(key) ?? []), service]);
  }
  const leads = {};
  for (const members of groups.values()) {
    const lead = members.find((one) => one.exposure === "public") ?? members[0];
    for (const member of members) leads[member.id] = lead.id;
  }
  return leads;
}

/**
 * The needs' builds: each lead's id with the ids of the services built with it, in the Stack's order. A service needs
 * that don't say (`builtWith`, from before shared builds) are each their own build.
 * @param {{ services: Array<{ id: string, builtWith?: string }> }} needs
 * @returns {Array<{ lead: string, services: string[] }>}
 */
function buildsOf(needs) {
  const builds = new Map();
  for (const service of needs.services) {
    const lead = service.builtWith ?? service.id;
    builds.set(lead, [...(builds.get(lead) ?? []), service.id]);
  }
  return [...builds].map(([lead, services]) => ({ lead, services }));
}

/** Whether a service shares its build with another. @param {any} needs @param {string} id */
function sharesBuild(needs, id) {
  return buildsOf(needs).some((build) => build.services.length > 1 && build.services.includes(id));
}

/**
 * The app a service runs at a provider that names apps as the engine does (mobilynet): its lead's.
 * @param {string} app the deployment's app name @param {{ id: string, builtWith?: string }} service a need's service
 */
function buildAppName(app, service) {
  return serviceAppName(app, service.builtWith ?? service.id);
}

/**
 * The version this Deploy already has of a service's release from another service of its build (the same app and the
 * same release digest: one upload, built once), which it is handed in place of an upload of its own; or null.
 * @param {{ id: string }} service @param {{ needs: any, release: any, run: any }} context
 * @returns {{ service: string, version: string } | null}
 */
function sharedVersionOf(service, { needs, release, run }) {
  const app = release.declarations[service.id].name;
  const from = needs.services.find((other) => other.id !== service.id && release.declarations[other.id]?.name === app
    && release.digests?.[other.id] === release.digests?.[service.id] && run.services[other.id]?.version);
  return from ? { service: from.id, version: run.services[from.id].version } : null;
}

/**
 * The name of a service's App Service as a Deploy makes it: the app's and the service's, the name it always had; one
 * made in place of an App Service that holds that name (an App Service whose app is not its build's) takes
 * `<name>-2`, so the two never meet, and the one after it the name again.
 * @param {{ id: string }} service @param {{ record: any, release: any }} context @param {{ name?: string } | null} replacing
 */
function replacementName(service, { record, release }, replacing) {
  const base = record.app ? serviceAppName(record.app, service.id) : release.declarations[service.id].name;
  return replacing?.name === base ? `${base.slice(0, APP_NAME_MAX - 2).replace(/-+$/u, "")}-2` : base;
}

export { APP_NAME_MAX, SERVICE_SETTING, buildAppName, buildLeadsOf, buildsOf, replacementName, serviceAppName, sharedVersionOf, sharesBuild };
