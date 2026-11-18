// The stand-in's Price List (GetProducts): entries in AWS's shape (each a JSON string of product, attributes and
// on-demand terms), for one region, at made-up prices of a plausible size. TERM_MATCH and ANY_OF filters, pages of
// MaxResults with NextToken. The attribute names and values for EC2 and RDS are the ones the adapter filters by.
import { fault, required } from "./wire.js";

/** A Price List entry: its attributes, an hourly on-demand price in USD. */
function entry(serviceCode, productFamily, attributes, usd, unit = "Hrs") {
  const sku = `SKU${Buffer.from(JSON.stringify(attributes)).toString("hex").slice(0, 12).toUpperCase()}`;
  return {
    product: { productFamily, attributes: { servicecode: serviceCode, ...attributes }, sku },
    serviceCode,
    terms: { OnDemand: { [`${sku}.JRTCKXETXF`]: { sku, offerTermCode: "JRTCKXETXF", priceDimensions: { [`${sku}.JRTCKXETXF.6YS6EN2CT7`]: { unit, pricePerUnit: { USD: usd }, description: `${usd} USD per ${unit}`, beginRange: "0", endRange: "Inf", appliesTo: [] } }, termAttributes: {} } } },
    version: "20261101000000",
    publicationDate: "2026-11-01T00:00:00Z"
  };
}

/** The made-up price list of a region. @param {string} region */
function priceListOf(region) {
  // In us-east-1 Fargate's usage types carry the region's code and the others none; elsewhere every one carries it.
  const prefix = region === "us-east-1" ? "" : "XX-";
  const fargate = region === "us-east-1" ? "USE1-" : "XX-";
  const ec2 = (instanceType, usd) => entry("AmazonEC2", "Compute Instance", {
    regionCode: region, instanceType, operatingSystem: "Linux", tenancy: "Shared", preInstalledSw: "NA", capacitystatus: "Used", licenseModel: "No License required", usagetype: `${prefix}BoxUsage:${instanceType}`
  }, usd);
  const rds = (instanceType, databaseEngine, deploymentOption, usd) => entry("AmazonRDS", "Database Instance", {
    regionCode: region, instanceType, databaseEngine, deploymentOption, usagetype: `${prefix}${deploymentOption === "Multi-AZ" ? "Multi-AZUsage" : "InstanceUsage"}:${instanceType}`
  }, usd);
  const databases = [["db.t4g.micro", "0.0160000000"], ["db.t4g.small", "0.0320000000"], ["db.t4g.medium", "0.0650000000"], ["db.m7g.large", "0.1680000000"], ["db.m7g.xlarge", "0.3370000000"]];
  return [
    entry("AmazonECS", "Compute", { regionCode: region, usagetype: `${fargate}Fargate-vCPU-Hours:perCPU`, cputype: "perCPU" }, "0.0404800000", "hours"),
    entry("AmazonECS", "Compute", { regionCode: region, usagetype: `${fargate}Fargate-GB-Hours`, memorytype: "perGB" }, "0.0044450000", "hours"),
    entry("AmazonECS", "Compute", { regionCode: region, usagetype: `${fargate}Fargate-ARM-vCPU-Hours:perCPU`, cputype: "perCPU", cpuArchitecture: "ARM" }, "0.0323800000", "hours"),
    entry("AWSELB", "Load Balancer-Application", { regionCode: region, usagetype: `${prefix}LoadBalancerUsage` }, "0.0225000000"),
    entry("AWSELB", "Load Balancer-Application", { regionCode: region, usagetype: `${prefix}LCUUsage` }, "0.0080000000", "LCU-Hrs"),
    ...[["m7i.large", "0.1008000000"], ["c7i.xlarge", "0.1785000000"], ["m7i.xlarge", "0.2016000000"], ["c7i.2xlarge", "0.3570000000"], ["m7i.2xlarge", "0.4032000000"],
      ["c7i.4xlarge", "0.7140000000"], ["m7i.4xlarge", "0.8064000000"], ["m7i.8xlarge", "1.6128000000"]].map(([type, usd]) => ec2(type, usd)),
    entry("AmazonEC2", "Storage", { regionCode: region, volumeApiName: "gp3", volumeType: "General Purpose", usagetype: `${prefix}EBS:VolumeUsage.gp3` }, "0.0800000000", "GB-Mo"),
    entry("AmazonEC2", "Storage", { regionCode: region, volumeApiName: "gp2", volumeType: "General Purpose", usagetype: `${prefix}EBS:VolumeUsage.gp2` }, "0.1000000000", "GB-Mo"),
    entry("AmazonVPC", "VPC Public IPv4 Address", { regionCode: region, usagetype: `${fargate}PublicIPv4:InUseAddress`, group: "VPCPublicIPv4Address" }, "0.0050000000"),
    entry("AmazonVPC", "VPC Public IPv4 Address", { regionCode: region, usagetype: `${fargate}PublicIPv4:IdleAddress`, group: "VPCPublicIPv4Address" }, "0.0050000000"),
    ...[["PostgreSQL", "0.1150000000"], ["MariaDB", "0.1150000000"]].flatMap(([databaseEngine, usd]) => [
      entry("AmazonRDS", "Database Storage", { regionCode: region, volumeType: "General Purpose-GP3", databaseEngine, deploymentOption: "Single-AZ", usagetype: `${prefix}RDS:GP3-Storage` }, usd, "GB-Mo"),
      entry("AmazonRDS", "Database Storage", { regionCode: region, volumeType: "General Purpose-GP3", databaseEngine, deploymentOption: "Multi-AZ", usagetype: `${prefix}RDS:Multi-AZ-GP3-Storage` }, (Number(usd) * 2).toFixed(10), "GB-Mo")
    ]),
    ...databases.flatMap(([type, usd]) => [
      rds(type, "PostgreSQL", "Single-AZ", usd), rds(type, "PostgreSQL", "Multi-AZ", (Number(usd) * 2).toFixed(10)),
      rds(type, "MariaDB", "Single-AZ", (Number(usd) * 0.95).toFixed(10)), rds(type, "MariaDB", "Multi-AZ", (Number(usd) * 1.9).toFixed(10)),
      rds(type, "MySQL", "Single-AZ", usd)
    ])
  ];
}

/** @param {any} world */
function createStandInPrices(world) {
  let list = priceListOf(world.region);
  return {
    /** Takes the entries whose usage type matches out of the list, as a region lacking them would. @param {RegExp} pattern */
    drop: (pattern) => {
      list = list.filter((one) => !pattern.test(one.product.attributes.usagetype));
    },
    GetProducts: (body) => {
      const serviceCode = required(body, "ServiceCode");
      const size = Number(body.MaxResults ?? 100);
      if (!(size >= 1 && size <= 100)) throw fault(400, "InvalidParameterException", "MaxResults must be 1 to 100.");
      const matches = list.filter((one) => one.serviceCode === serviceCode && (body.Filters ?? []).every((filter) => {
        const have = filter.Field === "productFamily" ? one.product.productFamily : one.product.attributes[filter.Field];
        if (filter.Type === "TERM_MATCH" || filter.Type === "EQUALS") return have === filter.Value;
        if (filter.Type === "ANY_OF") return String(filter.Value).split(",").includes(have);
        throw fault(400, "InvalidParameterException", `Filter type ${filter.Type} isn't in this stand-in.`);
      }));
      const start = Number(body.NextToken ?? 0);
      const page = matches.slice(start, start + size);
      return { FormatVersion: "aws_v1", PriceList: page.map((one) => JSON.stringify(one)), ...(start + size < matches.length ? { NextToken: String(start + size) } : {}) };
    }
  };
}

export { createStandInPrices };
