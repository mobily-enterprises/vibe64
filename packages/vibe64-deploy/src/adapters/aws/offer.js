// The AWS adapter's offer: what each service and resource can run on in the region, at AWS's list price, read from the
// Price List API (GetProducts) every time the offer is asked, at most every 15 minutes. A plain service runs on
// Fargate, priced per vCPU-hour and GB-hour; a service with a sandbox allowance or reached at each instance runs on
// whole machines (EC2), priced per instance-hour with their root disk (gp3, a month's GiB); every task and machine has
// a public IPv4 address of its own, priced per hour (base.js: there is no NAT gateway). The public service is behind an
// Application Load Balancer, priced per hour (its capacity units are billed as used). A PostgreSQL resource is RDS for
// PostgreSQL, a MySQL one RDS for MariaDB (mobilynet's MySQL is MariaDB too), each in a single zone or with a standby
// copy in another (Multi-AZ), priced with its first storage; a bucket is S3, billed as used. A month is 730 hours. A
// price the Price List lacks refuses the offer, naming it, rather than pricing at a guess; a machine type or database
// class the region lacks is left out. Redis waits for its reason.

const HOURS_A_MONTH = 730n;
const NANO = 1_000_000_000n;
// Fargate's shapes Vibe64 offers, whole vCPUs and GiB (Fargate takes 1 vCPU with 2 to 8 GiB, 2 with 4 to 16, 4 with 8
// to 30, 8 with 16 to 60 and 16 with 32 to 120).
const FARGATE_SHAPES = Object.freeze([[1, 2], [1, 4], [2, 4], [2, 8], [4, 8], [4, 16], [8, 16], [8, 32], [16, 32], [16, 64]]);
// The machines a sandboxed service is offered: current x86 general purpose and compute instances, which run gVisor
// without nested virtualisation.
const MACHINE_TYPES = Object.freeze([
  ["m7i.large", 2, 8], ["c7i.xlarge", 4, 8], ["m7i.xlarge", 4, 16], ["c7i.2xlarge", 8, 16], ["m7i.2xlarge", 8, 32],
  ["c7i.4xlarge", 16, 32], ["m7i.4xlarge", 16, 64]
]);
const DATABASE_CLASSES = Object.freeze(["db.t4g.micro", "db.t4g.small", "db.t4g.medium", "db.m7g.large", "db.m7g.xlarge"]);
const DATABASE_DEFAULT = "db.t4g.small";
// A machine's root disk and a database's first storage, both gp3 (services.js, resources.js).
const ROOT_DISK_GIB = 40;
const DATABASE_STORAGE_GIB = 20;
// A size with a standby copy: the class and this suffix.
const STANDBY = ".multi-az";
const ENGINES = Object.freeze({
  postgresql: Object.freeze({ title: "Amazon RDS for PostgreSQL", engine: "postgres", priceEngine: "PostgreSQL", port: 5432 }),
  mysql: Object.freeze({ title: "Amazon RDS for MariaDB", engine: "mariadb", priceEngine: "MariaDB", port: 3306 })
});
// Why the Plan doesn't count a Deploy against AWS's quotas.
const QUOTA_UNCHECKED = "AWS's quotas aren't checked before a Deploy: AWS says its limits but not what is used of them. A Deploy that passes one "
  + "stops at the step that needs more, with AWS's reason, and what it made is kept for the next.";

const UNSUPPORTED = Object.freeze({
  redis: "Vibe64 doesn't make Valkey (ElastiCache) at AWS yet: remove the resource from genesis/stack.md, or deploy this environment elsewhere."
});

/** A Fargate size's name. @param {number} vcpus @param {number} memoryGib */
const fargateSize = (vcpus, memoryGib) => `fargate-${vcpus}x${memoryGib}`;

/** A Fargate size's vCPUs and GiB, or null for any other name. @param {string} name */
function fargateShape(name) {
  const match = /^fargate-(\d+)x(\d+)$/u.exec(String(name));
  return match ? { vcpus: Number(match[1]), memoryGib: Number(match[2]) } : null;
}

/** Whether a size is a whole machine. @param {string} name */
const isMachineSize = (name) => MACHINE_TYPES.some(([type]) => type === name);

/** A database size's class and whether it keeps a standby copy. @param {string} size */
function databaseClassOf(size) {
  return String(size).endsWith(STANDBY) ? { instanceClass: size.slice(0, -STANDBY.length), multiAz: true } : { instanceClass: size, multiAz: false };
}

/** A price in USD as AWS writes it ("0.0416000000") in whole nano-dollars, rounded up. @param {string} text */
function nanoOf(text) {
  const [whole, fraction = ""] = String(text).split(".");
  const digits = `${fraction}0000000000`;
  const nano = BigInt(whole || "0") * NANO + BigInt(digits.slice(0, 9));
  return /[1-9]/u.test(digits.slice(9)) ? nano + 1n : nano;
}

/** The hourly on-demand price of a Price List entry, in nano-dollars, or null. @param {any} entry */
function hourlyNanoOf(entry) {
  for (const term of Object.values(entry?.terms?.OnDemand ?? {})) {
    for (const dimension of Object.values(term.priceDimensions ?? {})) {
      const usd = dimension.pricePerUnit?.USD;
      if (usd !== undefined && /^(Hrs|hours?)$/iu.test(dimension.unit ?? "")) return nanoOf(usd);
    }
  }
  return null;
}

/** The refusal of an offer missing a price. @param {string} what */
function priceMissing(what, region) {
  return Object.assign(new Error(`AWS's Price List has no ${what} in ${region}, so Vibe64 can't price this offer there; deploy in another region.`), {
    code: "aws_price_missing", retryable: false, status: 409
  });
}

/** The price of the one dimension of a Price List entry in this unit, in nano-dollars, or null. */
function unitNanoOf(entry, unit) {
  for (const term of Object.values(entry?.terms?.OnDemand ?? {})) {
    for (const dimension of Object.values(term.priceDimensions ?? {})) {
      if (dimension.pricePerUnit?.USD !== undefined && dimension.unit === unit) return nanoOf(dimension.pricePerUnit.USD);
    }
  }
  return null;
}

/**
 * Every Price List entry of a service matching the filters, page after page, each parsed.
 * @param {any} client @param {string} serviceCode @param {Record<string, string>} terms exact matches
 * @param {Record<string, string[]>} [anyOf] a field matching any of these
 */
async function productsOf(client, serviceCode, terms, anyOf = {}) {
  const filters = [
    ...Object.entries(terms).map(([Field, Value]) => ({ Type: "TERM_MATCH", Field, Value })),
    ...Object.entries(anyOf).map(([Field, values]) => ({ Type: "ANY_OF", Field, Value: values.join(",") }))
  ];
  const entries = [];
  let token;
  do {
    const page = await client.json("pricing", "GetProducts", { ServiceCode: serviceCode, Filters: filters, FormatVersion: "aws_v1", MaxResults: 100, ...(token ? { NextToken: token } : {}) });
    entries.push(...(page.PriceList ?? []).map((text) => (typeof text === "string" ? JSON.parse(text) : text)));
    token = page.NextToken || undefined;
  } while (token);
  return entries;
}

/**
 * The offer in the region, from AWS's list prices now.
 * @param {any} client
 * @returns {Promise<any>} the engine's offer (plan.js), with machineSizes, resources' titles and unsupported's reasons
 */
async function readOffer(client) {
  const region = client.region;
  const [fargate, balancers, machines, disks, addresses, databases, storage] = await Promise.all([
    productsOf(client, "AmazonECS", { regionCode: region, productFamily: "Compute" }),
    productsOf(client, "AWSELB", { regionCode: region, productFamily: "Load Balancer-Application" }),
    productsOf(client, "AmazonEC2", {
      regionCode: region, operatingSystem: "Linux", tenancy: "Shared", preInstalledSw: "NA", capacitystatus: "Used", licenseModel: "No License required"
    }, { instanceType: MACHINE_TYPES.map(([type]) => type) }),
    productsOf(client, "AmazonEC2", { regionCode: region, productFamily: "Storage", volumeApiName: "gp3" }),
    productsOf(client, "AmazonVPC", { regionCode: region, productFamily: "VPC Public IPv4 Address" }),
    productsOf(client, "AmazonRDS", { regionCode: region, productFamily: "Database Instance" }, {
      instanceType: DATABASE_CLASSES, databaseEngine: Object.values(ENGINES).map((one) => one.priceEngine), deploymentOption: ["Single-AZ", "Multi-AZ"]
    }),
    productsOf(client, "AmazonRDS", { regionCode: region, productFamily: "Database Storage", volumeType: "General Purpose-GP3" }, {
      databaseEngine: Object.values(ENGINES).map((one) => one.priceEngine), deploymentOption: ["Single-AZ", "Multi-AZ"]
    })
  ]);
  const usage = (entry) => String(entry.product?.attributes?.usagetype ?? "");
  const perVcpu = hourlyNanoOf(fargate.find((entry) => /(^|-)Fargate-vCPU-Hours:perCPU$/u.test(usage(entry)) && !/Spot|Windows/u.test(usage(entry))));
  const perGib = hourlyNanoOf(fargate.find((entry) => /(^|-)Fargate-GB-Hours$/u.test(usage(entry)) && !/Spot|Windows/u.test(usage(entry))));
  if (!perVcpu || !perGib) throw priceMissing("Fargate vCPU-hour and GB-hour price", region);
  const address = hourlyNanoOf(addresses.find((entry) => /(^|-)PublicIPv4:InUseAddress$/u.test(usage(entry))));
  if (!address) throw priceMissing("public IPv4 address price", region);
  const diskGibMonth = unitNanoOf(disks.find((entry) => /(^|-)EBS:VolumeUsage\.gp3$/u.test(usage(entry))), "GB-Mo");
  if (!diskGibMonth) throw priceMissing("gp3 disk price", region);
  const sizes = FARGATE_SHAPES.map(([vcpus, memoryGib]) => ({
    name: fargateSize(vcpus, memoryGib), vcpus, memoryGib, runsOn: "fargate",
    monthlyNano: ((perVcpu * BigInt(vcpus) + perGib * BigInt(memoryGib) + address) * HOURS_A_MONTH).toString()
  }));
  const machineSizes = MACHINE_TYPES.flatMap(([type, vcpus, memoryGib]) => {
    const hourly = hourlyNanoOf(machines.find((entry) => entry.product?.attributes?.instanceType === type));
    return hourly ? [{
      name: type, vcpus, memoryGib, runsOn: "ec2", bootDiskGib: ROOT_DISK_GIB, monthlyNano: ((hourly + address) * HOURS_A_MONTH + diskGibMonth * BigInt(ROOT_DISK_GIB)).toString()
    }] : [];
  });
  const balancerHourly = hourlyNanoOf(balancers.find((entry) => /(^|-)LoadBalancerUsage$/u.test(usage(entry))));
  if (!balancerHourly) throw priceMissing("Application Load Balancer hourly price", region);
  const resources = { bucket: { title: "Amazon S3", defaultSize: "standard", sizes: [{ name: "standard", monthlyNano: "0" }] } };
  for (const [kind, engine] of Object.entries(ENGINES)) {
    const priced = DATABASE_CLASSES.flatMap((instanceClass) => ["Single-AZ", "Multi-AZ"].flatMap((option) => {
      const entry = databases.find((one) => one.product?.attributes?.instanceType === instanceClass
        && one.product?.attributes?.databaseEngine === engine.priceEngine && one.product?.attributes?.deploymentOption === option);
      const hourly = hourlyNanoOf(entry);
      if (!hourly) return [];
      const gibMonth = unitNanoOf(storage.find((one) => one.product?.attributes?.databaseEngine === engine.priceEngine && one.product?.attributes?.deploymentOption === option), "GB-Mo");
      if (!gibMonth) throw priceMissing(`${engine.title} ${option} gp3 storage price`, region);
      return [{
        name: option === "Multi-AZ" ? `${instanceClass}${STANDBY}` : instanceClass, standbyCopy: option === "Multi-AZ", storageGib: DATABASE_STORAGE_GIB,
        monthlyNano: (hourly * HOURS_A_MONTH + gibMonth * BigInt(DATABASE_STORAGE_GIB)).toString()
      }];
    }));
    if (priced.length > 0) {
      resources[kind] = { title: engine.title, defaultSize: priced.some((size) => size.name === DATABASE_DEFAULT) ? DATABASE_DEFAULT : priced[0].name, sizes: priced };
    }
  }
  return {
    title: "AWS",
    currency: "USD",
    sizes,
    machineSizes,
    balancer: { monthlyNano: (balancerHourly * HOURS_A_MONTH).toString() },
    resources,
    unsupported: { ...UNSUPPORTED },
    // Service Quotas answers an account's limits, not what is used of them (CloudWatch's, metric by metric).
    quota: { unchecked: QUOTA_UNCHECKED }
  };
}

export { DATABASE_CLASSES, DATABASE_STORAGE_GIB, ENGINES, ROOT_DISK_GIB, FARGATE_SHAPES, MACHINE_TYPES, databaseClassOf, fargateShape, fargateSize, hourlyNanoOf, isMachineSize, nanoOf, readOffer };
