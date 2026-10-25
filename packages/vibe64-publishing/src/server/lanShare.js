// "Install on my phone" from a laptop: Vibe64's own pages answer only this
// computer, so a phone cannot reach them. When the person asks, Vibe64 shares
// exactly one signed APK on the local network for a few minutes, at an address
// with an unguessable part, and the QR code points there. Nothing else is
// served, and sharing stops by itself.
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function lanAddresses(interfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !/^(docker|br-|veth|virbr|incus|lxd|tun|tap)/u.test(name)) addresses.push(entry.address);
    }
  }
  return addresses.sort((left, right) => Number(right.startsWith("192.168.")) - Number(left.startsWith("192.168.")));
}

function createLanShare({ now = () => Date.now(), host = "0.0.0.0", addresses = lanAddresses } = {}) {
  let share = null; // { server, key, file, fileName, url, expiresAt, timer }

  async function stop() {
    const current = share;
    share = null;
    if (!current) return { sharing: false };
    clearTimeout(current.timer);
    // Close first, then end every open connection (a phone mid-download
    // included), so stopping never waits for a download to finish.
    const closed = new Promise((resolve) => current.server.close(() => resolve()));
    current.server.closeAllConnections();
    await closed;
    return { sharing: false };
  }

  function status() {
    return share ? { sharing: true, key: share.key, url: share.url, fileName: share.fileName, expiresAt: new Date(share.expiresAt).toISOString() } : { sharing: false };
  }

  async function start({ key, file, fileName, ttlMs = DEFAULT_TTL_MS }) {
    const details = await stat(file).catch(() => null);
    if (!details?.isFile()) throw Object.assign(new Error("The signed APK is no longer on this computer. Release again."), { code: "vibe64_publishing_download_missing" });
    await stop();
    const [address] = addresses();
    if (!address) throw Object.assign(new Error("This computer is not on a network a phone can reach. Download the APK instead."), { code: "vibe64_publishing_no_network" });
    const secret = randomBytes(18).toString("base64url");
    const route = `/${secret}/${encodeURIComponent(fileName)}`;
    const server = http.createServer((request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD" || request.url !== route) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": "application/vnd.android.package-archive",
        "content-length": details.size,
        "content-disposition": `attachment; filename="${fileName.replace(/"/gu, "")}"`,
        "cache-control": "no-store"
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
    const expiresAt = now() + ttlMs;
    share = {
      server,
      key,
      file,
      fileName,
      url: `http://${address}:${server.address().port}${route}`,
      expiresAt,
      timer: setTimeout(() => { stop(); }, ttlMs)
    };
    share.timer.unref?.();
    return status();
  }

  return Object.freeze({ start, status, stop });
}

export { createLanShare, lanAddresses };
