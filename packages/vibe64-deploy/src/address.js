// A Deploy's address, its domain (steps.js 3, 4, 7 and 9): the public App Service it is routed to, and the DNS target
// its owner adds once. Where the adapter lists the names each App Service's routes send it (`hosts`: mobilynet's
// inventory), a public service made while another App Service the record holds has the domain (a renamed public
// service, made while the one it replaces still serves) is made without it, and once it runs its release healthy the
// domain is moved to it in one call (`takeDomain`), so the address serves throughout and keeps its DNS target; the
// service it replaces is deleted after. A public service lacking the domain otherwise (its route deleted or moved by
// hand) asks for it plainly, which the provider refuses where a thing the record doesn't hold has it: a Deploy never
// acts on a thing the record does not hold. The domain's other names (the release's `aliases`, such as its www name)
// go with it: each is routed to the public service beside the domain, in the same call, the whole list each time, and
// moved only from a service the record holds; a Deploy routes no name away (the owner's change of the names moves
// them at once, domain.js). Where the adapter names the DNS target that stays (domainRecords'
// `target`: a mobilynet route's own name), a Deploy that goes live tells it once, when the record holds none or
// another (`record.address`, what the owner was told, not a copy of the provider's); a read of it that fails never
// fails a live Deploy, and the next one tells it.

// What the address's DNS target is promised to survive.
const TARGET_STAYS = "stays the same through Take offline, every Deploy and a replaced App Service";

// A host name as an app's server reads its other names (JSKIT's APP_REDIRECT_HOSTS): labels of lowercase letters,
// digits and inner hyphens, the last starting with a letter, so no scheme, port, path, wildcard or address.
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;

/**
 * Why the domain's other names can't be routed and given to its app, or "": each a lowercase host name, none the domain
 * itself, none named twice (the app's server refuses to start with such a setting).
 * @param {string} domain @param {unknown} aliases
 */
function aliasesProblem(domain, aliases) {
  if (!Array.isArray(aliases)) return "they are no list of names";
  const bad = aliases.find((alias) => typeof alias !== "string" || !HOST_NAME.test(alias));
  if (bad !== undefined) return `${JSON.stringify(bad)} is no lowercase host name, such as www.example.com`;
  if (aliases.includes(domain)) return `${domain} is the domain itself`;
  const twice = aliases.find((alias, at) => aliases.indexOf(alias) !== at);
  return twice ? `${twice} is named twice` : "";
}

/**
 * The service item the record holds, other than `thing`'s, whose routes send the domain to it; or null.
 * @param {any} record @param {(item: any) => any} thingOf the provider's thing of an item @param {string} domain @param {any} [thing]
 */
function domainHolder(record, thingOf, domain, thing = null) {
  return Object.values(record.items).find((item) => item.kind === "service" && item.id !== thing?.id && thingOf(item)?.hosts?.includes(domain)) ?? null;
}

/**
 * Step 7: the domain and its other names routed to the public service that lacks any, once that service serves this
 * Deploy's release, each moved from the service the record holds that has it (`holder`, and each alias's own); null
 * where the service has them all or the adapter lists no hosts. The step names every other name, as the provider
 * replaces a service's whole list of names, each `take` only where a service the record holds has it.
 * @param {{ service: any, thing: any, domain: string, holder: any, aliases?: Array<{ host: string, holder: any }>, serving: boolean, failure: string | null }} context
 */
function domainStep({ service, thing, domain, holder, aliases = [], serving, failure }) {
  if (!Array.isArray(thing?.hosts)) return null;
  const lacking = [domain, ...aliases.map((alias) => alias.host)].filter((host) => !thing.hosts.includes(host));
  if (lacking.length === 0) return null;
  if (failure) return { kind: "failed", message: failure };
  if (!serving) return { kind: "wait", words: `Waiting for ${service.id} to be healthy before it takes ${namesWords(lacking)}` };
  return {
    kind: "takeDomain", service: service.id, id: thing.id, domain, ...(holder ? { from: holder.name } : {}),
    ...(aliases.length > 0 ? { aliases: aliases.map((alias) => ({ host: alias.host, take: Boolean(alias.holder) })) } : {})
  };
}

/** Names as a person reads them: "a", "a and b", "a, b and c". @param {string[]} names */
function namesWords(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The address's DNS target where the adapter names one that stays and the record holds none or another: `{ host,
 * target, previous }`, `previous` the one told before for that host, or null; null when there is nothing to tell.
 * @param {any} adapter @param {string} domain @param {{ host: string, target: string } | undefined} told
 */
async function addressChange(adapter, domain, told) {
  if (typeof adapter.domainRecords !== "function" || !domain) return null;
  const target = await adapter.domainRecords(domain).then((records) => records.target ?? null, () => null);
  const previous = told?.host === domain ? told.target : null;
  return target && target !== previous ? { host: domain, target, previous } : null;
}

/** What a Deploy tells once of the address's DNS target. @param {{ host: string, target: string, previous: string | null }} address */
function addressWords({ host, target, previous }) {
  return previous
    ? `${host}'s DNS target is now ${target}, no longer ${previous}: change its CNAME (or ALIAS) to it once. It ${TARGET_STAYS}.`
    : `${host}'s DNS target is ${target}, which ${TARGET_STAYS}. If its CNAME (or ALIAS) names anything else, such as an App Service's own name, change it once.`;
}

export { addressChange, addressWords, aliasesProblem, domainHolder, domainStep, namesWords };
