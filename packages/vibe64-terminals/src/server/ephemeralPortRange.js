import { readFile } from "node:fs/promises";
import process from "node:process";

// Where the kernel takes each outgoing connection's own port. Linux names it here; elsewhere IANA's range is the
// default.
const EPHEMERAL_PORT_RANGE_FILE = "/proc/sys/net/ipv4/ip_local_port_range";
const IANA_EPHEMERAL_PORT_RANGE = Object.freeze({ first: 49152, last: 65535 });

/**
 * The host's ephemeral port range, { first, last }: from rangeFile where it exists, IANA's off Linux.
 * @param {{ rangeFile?: string, platform?: string }} [host]
 */
async function ephemeralPortRange({ rangeFile = EPHEMERAL_PORT_RANGE_FILE, platform = process.platform } = {}) {
  const text = await readFile(rangeFile, "utf8").catch((error) => {
    if (error?.code !== "ENOENT" || platform === "linux") throw error;
    return "";
  });
  if (!text) return IANA_EPHEMERAL_PORT_RANGE;
  const [first, last] = text.trim().split(/\s+/u).map(Number);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > last || last > 65535) {
    throw new Error(`${rangeFile} does not hold a port range: ${text.trim()}`);
  }
  return { first, last };
}

export { ephemeralPortRange };
