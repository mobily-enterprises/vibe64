import { INSTANCE_SIZES, MACHINE_SIZES } from "./catalogue.js";

// mobilynet's prices as its stand-in answers them (its billing package's prices.js: `GET /v1/prices`, the price table
// in force, any scheduled, and every offered size with its price). Each row has mobilynet's priceView shape: its kind,
// its size and class when it has them, its unit (`GiB-month` for the disk, `month` otherwise), its monthly price as text
// with two decimals, in nano-units and an hour's of it, and the data disk a machine's row includes. A machine of a size
// with a data disk costs its size's row a month, plus the disk's for each GiB past what the size includes.
// STAND-IN ONLY: the amounts are plain test values, not mobilynet's prices: machines m-1 10, m-2 20, m-4 40, m-8 80 a
// month (including 20, 40, 60 and 120 GiB of disk), the disk 0.10 a GiB-month, App Service instances a-1 8, a-2 16,
// a-4 32, a-8 64, and the load balancer 10.

const NANO = 1_000_000_000n;
const SECONDS_PER_MONTH = 730n * 3600n;
const CURRENCY = "USD";

/** A monthly price in nano-units as mobilynet's decimalText shows it, two decimals. @param {bigint} nano */
function monthlyText(nano) {
  const cents = nano / 10_000_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** A price row as mobilynet's priceView shows it. */
function priceRow(kind, { size, class: priceClass, monthlyNano, includedDiskGib }) {
  return {
    kind,
    ...(size ? { size } : {}),
    ...(priceClass ? { class: priceClass } : {}),
    unit: kind === "disk" ? "GiB-month" : "month",
    monthly: monthlyText(monthlyNano),
    monthlyNano: monthlyNano.toString(),
    hourlyNano: ((3600n * monthlyNano) / SECONDS_PER_MONTH).toString(),
    ...(kind === "vps" ? { includedDiskGib } : {})
  };
}

const TABLE = Object.freeze({
  id: "ptb_standin1",
  startsAt: "2026-01-01T00:00:00.000Z",
  currency: CURRENCY,
  taxRateBp: 0,
  note: "The stand-in's table",
  prices: Object.freeze([
    ...[["m-1", 10, 20], ["m-2", 20, 40], ["m-4", 40, 60], ["m-8", 80, 120]].map(([size, monthly, includedDiskGib]) => priceRow("vps", {
      size, class: "shared", monthlyNano: BigInt(monthly) * NANO, includedDiskGib
    })),
    priceRow("disk", { monthlyNano: 100_000_000n }),
    ...[["a-1", 8], ["a-2", 16], ["a-4", 32], ["a-8", 64]].map(([size, monthly]) => priceRow("instance", { size, monthlyNano: BigInt(monthly) * NANO })),
    priceRow("load_balancer", { monthlyNano: 10n * NANO })
  ])
});

/** A size's price beside it, as `GET /v1/prices` lists it (mobilynet's sizePrice). @param {any} row */
const sizePrice = ({ monthly, monthlyNano, hourlyNano, includedDiskGib }) => ({
  monthly, monthlyNano, hourlyNano, ...(includedDiskGib === undefined ? {} : { includedDiskGib })
});

/** `GET /v1/prices`: the table in force, none scheduled, and every offered size with its price. */
function pricesAnswer() {
  const offered = [
    ...Object.entries(MACHINE_SIZES).map(([name, size]) => ({ kind: "vps", name, class: "shared", ...size })),
    ...Object.entries(INSTANCE_SIZES).map(([name, size]) => ({ kind: "instance", name, class: "", ...size }))
  ];
  const sizes = offered.map((size) => {
    const price = TABLE.prices.find((row) => row.kind === size.kind && row.size === size.name && (row.class ?? "") === size.class);
    return {
      kind: size.kind,
      name: size.name,
      ...(size.class ? { class: size.class } : {}),
      vcpus: size.vcpus,
      memoryGib: size.memoryGib,
      ...(size.kind === "vps" ? { includedDiskGib: price.includedDiskGib } : {}),
      price: sizePrice(price),
      next: null
    };
  });
  return structuredClone({ inForce: TABLE, scheduled: [], sizes });
}

/**
 * What a shared machine of a size with a data disk costs a month (mobilynet's monthlyOf): its size's row, plus the
 * disk's for each GiB past what the size includes; null for a size the table lacks.
 * @param {{ size: string, dataDiskGib: number }} shape
 */
function monthlyOf({ size, dataDiskGib }) {
  const machine = TABLE.prices.find((row) => row.kind === "vps" && row.size === size);
  const disk = TABLE.prices.find((row) => row.kind === "disk");
  if (!machine) return null;
  const extra = Math.max(0, Number(dataDiskGib) - machine.includedDiskGib);
  return BigInt(machine.monthlyNano) + BigInt(disk.monthlyNano) * BigInt(extra);
}

const prices = Object.freeze({ currency: CURRENCY, answer: pricesAnswer, monthlyOf });

export { prices };
