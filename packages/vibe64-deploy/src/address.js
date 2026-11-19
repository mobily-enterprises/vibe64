// A Deploy's address, its domain (steps.js 3, 4, 7 and 9): the public App Service it is routed to, and the DNS target
// its owner adds once. Where the adapter lists the names each App Service's routes send it (`hosts`: mobilynet's
// inventory), a public service made while another App Service the record holds has the domain (a renamed public
// service, made while the one it replaces still serves) is made without it, and once it runs its release healthy the
// domain is moved to it in one call (`takeDomain`), so the address serves throughout and keeps its DNS target; the
// service it replaces is deleted after. A public service lacking the domain otherwise (its route deleted or moved by
// hand) asks for it plainly, which the provider refuses where a thing the record doesn't hold has it: a Deploy never
// acts on a thing the record does not hold. Where the adapter names the DNS target that stays (domainRecords'
// `target`: a mobilynet route's own name), a Deploy that goes live tells it once, when the record holds none or
// another (`record.address`, what the owner was told, not a copy of the provider's); a read of it that fails never
// fails a live Deploy, and the next one tells it.

// What the address's DNS target is promised to survive.
const TARGET_STAYS = "stays the same through Take offline, every Deploy and a replaced App Service";

/**
 * The service item the record holds, other than `thing`'s, whose routes send the domain to it; or null.
 * @param {any} record @param {(item: any) => any} thingOf the provider's thing of an item @param {string} domain @param {any} [thing]
 */
function domainHolder(record, thingOf, domain, thing = null) {
  return Object.values(record.items).find((item) => item.kind === "service" && item.id !== thing?.id && thingOf(item)?.hosts?.includes(domain)) ?? null;
}

/**
 * Step 7: the domain routed to the public service that lacks it, once that service serves this Deploy's release,
 * moved from the service `holder` names where one has it; null where the service has it or the adapter lists no hosts.
 * @param {{ service: any, thing: any, domain: string, holder: any, serving: boolean, failure: string | null }} context
 */
function domainStep({ service, thing, domain, holder, serving, failure }) {
  if (!Array.isArray(thing?.hosts) || thing.hosts.includes(domain)) return null;
  if (failure) return { kind: "failed", message: failure };
  if (!serving) return { kind: "wait", words: `Waiting for ${service.id} to be healthy before it takes ${domain}` };
  return { kind: "takeDomain", service: service.id, id: thing.id, domain, ...(holder ? { from: holder.name } : {}) };
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

export { addressChange, addressWords, domainHolder, domainStep };
