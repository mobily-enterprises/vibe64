// The Google Cloud adapter's offer: the sizes it runs a service and a resource on, each priced from Google's public
// list prices in one region, read from the Cloud Billing Catalog (`services/{id}/skus`) in US dollars, for 730 hours a
// month. A service runs on Cloud Run (one of SHAPES, its instances always allocated, billed per vCPU-second and
// GiB-second) or, when it needs a whole machine of its own (a sandbox allowance, or reached at each instance), on a
// Compute Engine machine of a managed instance group (one of MACHINES, billed per vCPU-hour and GiB-hour, with its boot
// disk). A database is Cloud SQL (one of TIERS, per vCPU-hour and GiB-hour, with its disk); a bucket is Cloud Storage,
// priced by what it holds and serves, so its line is 0. The public service's load balancer is the forwarding rules'
// hourly minimum, which covers its two rules (https, and http redirecting to it). Valkey (redis) is not offered yet,
// with the reason the Plan names.
//
// Which SKU is which is said once, in SKUS, by its description and region; a SKU the catalogue no longer has in the
// region refuses the offer, naming it, rather than pricing at a guess.

const HOURS_PER_MONTH = 730n;
const NANO = 1_000_000_000n;
// The catalogue's service ids: Compute Engine, Cloud Run, Cloud SQL, and Networking (load balancing's SKUs).
const CATALOGUE = Object.freeze({ compute: "6F81-5844-456A", run: "152E-C115-5142", sql: "9662-B51E-5089", networking: "E505-1604-58F8" });

/** Cloud Run instance shapes: vCPU and memory in GiB, within Cloud Run's limits for each CPU count. */
const SHAPES = Object.freeze([
  [1, 2], [2, 4], [2, 8], [4, 8], [4, 16], [8, 16], [8, 32]
].map(([vcpus, memoryGib]) => Object.freeze({ name: `run-${vcpus}-${memoryGib}`, vcpus, memoryGib })));
/** Compute Engine machine types for a managed instance group, and the boot disk each instance has. */
const MACHINES = Object.freeze([
  ["e2-standard-2", 2, 8], ["e2-standard-4", 4, 16], ["e2-standard-8", 8, 32], ["e2-standard-16", 16, 64], ["e2-standard-32", 32, 128],
  ["e2-highcpu-8", 8, 8], ["e2-highcpu-16", 16, 16], ["e2-highcpu-32", 32, 32],
  ["e2-highmem-2", 2, 16], ["e2-highmem-4", 4, 32], ["e2-highmem-8", 8, 64], ["e2-highmem-16", 16, 128]
].map(([name, vcpus, memoryGib]) => Object.freeze({ name, vcpus, memoryGib })));
const BOOT_DISK_GIB = 50;
/** Cloud SQL Enterprise custom tiers, and the disk each instance starts with (it grows by itself). */
const TIERS = Object.freeze([[1, 3.75], [2, 7.5], [4, 15], [8, 30]].map(([vcpus, memoryGib]) => Object.freeze({
  name: `db-custom-${vcpus}-${Math.round(memoryGib * 1024)}`, vcpus, memoryGib
})));
const DATA_DISK_GIB = 10;
const DEFAULT_TIER = TIERS[0].name;

/** The products a resource kind is on Google Cloud, which the Plan names; mysql is MySQL itself, as Google runs no MariaDB. */
const RESOURCE_TITLES = Object.freeze({
  postgresql: "Cloud SQL for PostgreSQL 16",
  mysql: "Cloud SQL for MySQL 8.4 (MySQL itself: Google Cloud runs no MariaDB)",
  bucket: "Cloud Storage through its S3-compatible XML API, an HMAC key per service, priced by what it holds and serves"
});
/** Each resource kind Google Cloud runs none of yet, with the reason the Plan's refusal names. */
const UNSUPPORTED = Object.freeze({
  redis: "Memorystore for Valkey comes later on Google Cloud: remove the resource from genesis/stack.md (the coding agent can do this), "
    + "or deploy this app at a provider that runs it, such as mobilynet."
});

/**
 * The SKUs the offer reads: by catalogue service, a description pattern, and what the Plan calls it when it's missing.
 * A SKU is also of the region (its serviceRegions) and on demand.
 */
const SKUS = Object.freeze({
  e2Core: { service: "compute", label: "E2 instance core", description: /^E2 Instance Core running in /u },
  e2Ram: { service: "compute", label: "E2 instance RAM", description: /^E2 Instance Ram running in /u },
  balancedDisk: { service: "compute", label: "balanced persistent disk", description: /^Balanced PD Capacity( in .+)?$/u },
  forwardingRule: { service: "networking", label: "global forwarding rules (minimum)", description: /^Cloud Load Balancer Forwarding Rule Minimum Global/u },
  runCpu: { service: "run", label: "Cloud Run CPU (instance-based billing)", description: /^Services CPU \(Instance-based billing\) in /u },
  runMemory: { service: "run", label: "Cloud Run memory (instance-based billing)", description: /^Services Memory \(Instance-based billing\) in /u },
  postgresqlCpu: { service: "sql", label: "Cloud SQL for PostgreSQL vCPU", description: /^Cloud SQL for PostgreSQL: Zonal - vCPU in /u },
  postgresqlRam: { service: "sql", label: "Cloud SQL for PostgreSQL RAM", description: /^Cloud SQL for PostgreSQL: Zonal - RAM in /u },
  postgresqlDisk: { service: "sql", label: "Cloud SQL for PostgreSQL storage", description: /^Cloud SQL for PostgreSQL: Zonal - Standard storage in /u },
  mysqlCpu: { service: "sql", label: "Cloud SQL for MySQL vCPU", description: /^Cloud SQL for MySQL: Zonal - vCPU in /u },
  mysqlRam: { service: "sql", label: "Cloud SQL for MySQL RAM", description: /^Cloud SQL for MySQL: Zonal - RAM in /u },
  mysqlDisk: { service: "sql", label: "Cloud SQL for MySQL storage", description: /^Cloud SQL for MySQL: Zonal - Standard storage in /u }
});

/** A refusal of the offer: the catalogue lacks what it prices. */
function offerError(message) {
  return Object.assign(new Error(message), { code: "google_price_missing", status: 502, retryable: false });
}

/**
 * A SKU's list price for a month of one unit (a vCPU, a GiB, a forwarding rule's minimum) in nano-dollars: its first
 * tier with a price, past any free tier, from the unit it is quoted in (per second, hour or month; of a GiB or not).
 * @param {any} sku
 */
function monthlyNanoOf(sku) {
  const expression = sku.pricingInfo?.[0]?.pricingExpression ?? {};
  const rate = (expression.tieredRates ?? []).find((tier) => BigInt(tier.unitPrice?.units ?? 0) > 0n || Number(tier.unitPrice?.nanos ?? 0) > 0);
  if (!rate) return null;
  const nano = BigInt(rate.unitPrice.units ?? 0) * NANO + BigInt(rate.unitPrice.nanos ?? 0);
  const per = /^(?:GiBy\.)?(s|h|mo)$/u.exec(String(expression.usageUnit ?? ""))?.[1];
  return { s: nano * 3600n * HOURS_PER_MONTH, h: nano * HOURS_PER_MONTH, mo: nano }[per] ?? null;
}

/**
 * The prices the offer needs in one region, by SKUS' names.
 * @param {(serviceId: string) => Promise<any[]>} listSkus the catalogue's SKUs of a service, every page
 * @param {string} region
 */
async function readPrices(listSkus, region) {
  const services = Object.fromEntries(await Promise.all(Object.entries(CATALOGUE).map(async ([name, id]) => [name, await listSkus(id)])));
  const prices = {};
  for (const [name, { service, label, description }] of Object.entries(SKUS)) {
    const sku = services[service].find((one) => description.test(String(one.description ?? "")) && one.category?.usageType === "OnDemand"
      && (one.serviceRegions ?? []).some((where) => where === region || where === "global"));
    const nano = sku ? monthlyNanoOf(sku) : null;
    if (nano === null) throw offerError(`Google's price list has no ${label} price in ${region}, which the offer needs to price its sizes.`);
    prices[name] = nano;
  }
  return prices;
}

/** A month's nano-dollars for an amount of a unit, a fraction of a GiB (Cloud SQL's 3.75) rounded up, never down. */
function times(nano, amount) {
  const hundredths = BigInt(Math.round(amount * 100));
  return (nano * hundredths + 99n) / 100n;
}

/**
 * The offer, as the engine's plan reads it.
 * @param {(serviceId: string) => Promise<any[]>} listSkus @param {string} region
 */
async function offerOf(listSkus, region) {
  const prices = await readPrices(listSkus, region);
  const sizes = SHAPES.map(({ name, vcpus, memoryGib }) => ({
    name, vcpus, memoryGib, runsOn: "cloud run", monthlyNano: (times(prices.runCpu, vcpus) + times(prices.runMemory, memoryGib)).toString()
  }));
  const machineSizes = MACHINES.map(({ name, vcpus, memoryGib }) => ({
    name, vcpus, memoryGib, runsOn: "compute engine", bootDiskGib: BOOT_DISK_GIB,
    monthlyNano: (times(prices.e2Core, vcpus) + times(prices.e2Ram, memoryGib) + times(prices.balancedDisk, BOOT_DISK_GIB)).toString()
  }));
  const databaseOffer = (kind) => ({
    title: RESOURCE_TITLES[kind],
    defaultSize: DEFAULT_TIER,
    sizes: TIERS.map(({ name, vcpus, memoryGib }) => ({
      name, vcpus, memoryGib, dataDiskGib: DATA_DISK_GIB,
      monthlyNano: (times(prices[`${kind}Cpu`], vcpus) + times(prices[`${kind}Ram`], memoryGib) + times(prices[`${kind}Disk`], DATA_DISK_GIB)).toString()
    }))
  });
  return {
    title: "Google Cloud",
    currency: "USD",
    sizes,
    machineSizes,
    balancer: { monthlyNano: prices.forwardingRule.toString() },
    resources: {
      postgresql: databaseOffer("postgresql"),
      mysql: databaseOffer("mysql"),
      bucket: { title: RESOURCE_TITLES.bucket, defaultSize: "standard", sizes: [{ name: "standard", monthlyNano: "0" }] }
    },
    unsupported: { ...UNSUPPORTED }
  };
}

export { BOOT_DISK_GIB, CATALOGUE, DATA_DISK_GIB, MACHINES, RESOURCE_TITLES, SHAPES, SKUS, TIERS, UNSUPPORTED, monthlyNanoOf, offerOf };
