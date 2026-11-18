// The stand-in's Cloud Billing Catalog API v1: `services/{id}/skus`, paged, for the services the offer reads (Compute
// Engine, Cloud Run, Cloud SQL, Networking). Its SKUs take the catalogue's shape and descriptions, at list prices of
// us-central1 read from Google's pricing pages in November 2026, as examples: a test reads its prices from here, never
// from Google. Beside them stand SKUs the offer must not take: Spot machines, another region, request-based Cloud Run,
// high-availability Cloud SQL, the forwarding rules past the first five. `removeSku(description)` takes one away.

const SERVICES = Object.freeze({
  "6F81-5844-456A": "Compute Engine",
  "152E-C115-5142": "Cloud Run",
  "9662-B51E-5089": "Cloud SQL",
  "E505-1604-58F8": "Networking"
});

/** A price as the catalogue gives it: whole units and nanos of a dollar. @param {string} dollars such as "0.02181159" */
function moneyOf(dollars) {
  const [units, fraction = ""] = dollars.split(".");
  return { currencyCode: "USD", units, nanos: Number(fraction.padEnd(9, "0").slice(0, 9)) };
}

/**
 * One SKU.
 * @param {string} service @param {string} skuId @param {string} description @param {string[]} regions
 * @param {string} usageUnit @param {string} dollars @param {{ usageType?: string, freeUpTo?: number }} [more]
 */
function sku(service, skuId, description, regions, usageUnit, dollars, { usageType = "OnDemand", freeUpTo = 0 } = {}) {
  const rate = { startUsageAmount: freeUpTo, unitPrice: moneyOf(dollars) };
  return {
    name: `services/${service}/skus/${skuId}`,
    skuId,
    description,
    category: { serviceDisplayName: SERVICES[service], resourceFamily: "Compute", resourceGroup: "Standard", usageType },
    serviceRegions: regions,
    pricingInfo: [{
      summary: "",
      pricingExpression: {
        usageUnit, displayQuantity: 1, usageUnitDescription: usageUnit, baseUnit: usageUnit, baseUnitDescription: usageUnit, baseUnitConversionFactor: 1,
        tieredRates: freeUpTo > 0 ? [{ startUsageAmount: 0, unitPrice: { currencyCode: "USD", units: "0", nanos: 0 } }, rate] : [rate]
      },
      currencyConversionRate: 1,
      effectiveTime: "2026-11-01T00:00:00Z"
    }],
    serviceProviderName: "Google",
    geoTaxonomy: { type: regions[0] === "global" ? "GLOBAL" : "REGIONAL", regions: regions[0] === "global" ? [] : regions }
  };
}

const COMPUTE = "6F81-5844-456A";
const RUN = "152E-C115-5142";
const SQL = "9662-B51E-5089";
const NETWORKING = "E505-1604-58F8";

function catalogueOf(region) {
  return [
    sku(COMPUTE, "CF4E-A0C7-E3BF", "E2 Instance Core running in Americas", [region], "h", "0.02181159"),
    sku(COMPUTE, "F449-33EC-A5EF", "E2 Instance Ram running in Americas", [region], "GiBy.h", "0.00292353"),
    sku(COMPUTE, "6AE1-525F-8B80", "Balanced PD Capacity", [region], "GiBy.mo", "0.1"),
    sku(COMPUTE, "2D1A-0001-AAAA", "Spot Preemptible E2 Instance Core running in Americas", [region], "h", "0.00654", { usageType: "Preemptible" }),
    sku(COMPUTE, "2D1A-0002-AAAA", "E2 Instance Core running in EMEA", ["europe-west1"], "h", "0.02398"),
    sku(RUN, "011E-3072-CBDB", "Services CPU (Instance-based billing) in us-central1", [region], "s", "0.000018", { freeUpTo: 240000 }),
    sku(RUN, "F6D2-B591-E54F", "Services Memory (Instance-based billing) in us-central1", [region], "GiBy.s", "0.000002", { freeUpTo: 450000 }),
    sku(RUN, "2D1A-0003-AAAA", "Services CPU (Request-based billing) in us-central1", [region], "s", "0.000024", { freeUpTo: 180000 }),
    sku(SQL, "965E-7C36-08E6", "Cloud SQL for PostgreSQL: Zonal - vCPU in Americas", [region], "h", "0.0413"),
    sku(SQL, "93DA-3F55-CB04", "Cloud SQL for PostgreSQL: Zonal - RAM in Americas", [region], "GiBy.h", "0.007"),
    sku(SQL, "C18F-7FE0-0717", "Cloud SQL for PostgreSQL: Zonal - Standard storage in Americas", [region], "GiBy.mo", "0.17"),
    sku(SQL, "2D1A-0004-AAAA", "Cloud SQL for PostgreSQL: Regional - vCPU in Americas", [region], "h", "0.0826"),
    sku(SQL, "741F-D668-2417", "Cloud SQL for MySQL: Zonal - vCPU in Americas", [region], "h", "0.0413"),
    sku(SQL, "49E9-5D00-B807", "Cloud SQL for MySQL: Zonal - RAM in Americas", [region], "GiBy.h", "0.007"),
    sku(SQL, "F0A1-2B08-FA36", "Cloud SQL for MySQL: Zonal - Standard storage in Americas", [region], "GiBy.mo", "0.17"),
    sku(NETWORKING, "DEE3-C42E-3E4D", "Cloud Load Balancer Forwarding Rule Minimum Global", ["global"], "h", "0.025"),
    sku(NETWORKING, "1211-928B-AF92", "Cloud Load Balancer Forwarding Rule Additional Global", ["global"], "h", "0.01")
  ];
}

function createStandInCatalog(world) {
  let skus = catalogueOf(world.region);
  return {
    request({ method, path, query }) {
      const match = /^v1\/services\/([^/]+)\/skus$/u.exec(path);
      if (!match || method !== "GET") return null;
      if (!SERVICES[match[1]]) return world.error(404, "NOT_FOUND", `Service ${match[1]} not found.`);
      if (query.get("currencyCode") && query.get("currencyCode") !== "USD") return world.error(400, "INVALID_ARGUMENT", "The stand-in prices in USD only.");
      const own = skus.filter((one) => one.name.startsWith(`services/${match[1]}/`));
      const size = Math.min(Number(query.get("pageSize") || 5000), 5000);
      const start = Number(query.get("pageToken") || 0);
      return world.answer(200, { skus: structuredClone(own.slice(start, start + size)), nextPageToken: start + size < own.length ? String(start + size) : "" });
    },
    controls: Object.freeze({
      removeSku: (description) => {
        skus = skus.filter((one) => one.description !== description);
      }
    })
  };
}

export { createStandInCatalog };
