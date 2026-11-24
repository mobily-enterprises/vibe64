import assert from "node:assert/strict";
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import nodeTest, { after, afterEach } from "node:test";

// A native Codex test reaches only this computer, on any host. A test file takes `test` from here in place of
// node:test's. Importing it puts a `codex` first on PATH that runs the installed CLI with every proxy variable naming a
// proxy here, which refuses each address but loopback at once. The first address refused fails the running test there
// and then, naming it, so a Codex that would call a real provider (chatgpt.com, github.com) fails in words instead of
// calling out, or waiting on a network that cannot answer. The tests' own fixtures, on loopback, stay direct.

const LOOPBACK = "127.0.0.1,localhost,::1";
const refused = [];
let refuseRunningTest = null;

function refusal(addresses) {
  return `Codex tried to reach ${addresses.join(", ")}, which a test never does: start it as the product does, with ` +
    "the CLI's model catalogue (-c model_catalog_json) and without what calls out (plugins, update checks).";
}

function refuse(address) {
  refused.push(address);
  refuseRunningTest?.(new Error(refusal(refused)));
}

function installedCodex() {
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    try {
      accessSync(path.join(directory, "codex"), constants.X_OK);
      return path.join(directory, "codex");
    } catch {
      // Not in this directory.
    }
  }
  return "";
}

const proxy = createServer((request, response) => {
  refuse(request.headers.host || request.url);
  response.writeHead(403, { "content-type": "text/plain" }).end("A test never reaches a real provider.\n");
});
proxy.on("connect", (request, socket) => {
  refuse(request.url);
  socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
});
// PATH changes before any module imported after this one runs; the proxy's port, known once it listens, is read by
// the shim from a file, written before any test starts.
const codex = installedCodex();
const shims = mkdtempSync(path.join(os.tmpdir(), "vibe64-codex-network-"));
if (codex) {
  if (`${codex}${shims}`.includes("'")) throw new Error(`A quote in the Codex CLI's or the shim's path: ${codex}, ${shims}`);
  const address = `http://127.0.0.1:$(cat '${path.join(shims, "port")}')`;
  const proxies = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"].flatMap((name) => [name, name.toLowerCase()]);
  writeFileSync(path.join(shims, "codex"), [
    "#!/bin/sh",
    `export ${proxies.map((name) => `${name}="${address}"`).join(" ")} NO_PROXY=${LOOPBACK} no_proxy=${LOOPBACK}`,
    `exec '${codex}' "$@"`,
    ""
  ].join("\n"), { mode: 0o755 });
  process.env.PATH = `${shims}${path.delimiter}${process.env.PATH}`;
}
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
proxy.unref();
writeFileSync(path.join(shims, "port"), String(proxy.address().port));

export default function test(name, options, fn) {
  if (typeof options === "function") [options, fn] = [{}, options];
  return nodeTest(name, options, async (t) => {
    const stopped = Promise.withResolvers();
    refuseRunningTest = stopped.reject;
    const run = Promise.resolve().then(() => fn(t));
    // Once a refusal has failed the test, the abandoned run ends however its teardown leaves it.
    run.catch(() => {});
    try {
      await Promise.race([run, stopped.promise]);
    } finally {
      refuseRunningTest = null;
    }
  });
}

// Addresses asked for between tests, such as during a test's teardown, fail that test too.
afterEach(() => {
  const asked = refused.splice(0);
  assert.deepEqual(asked, [], refusal(asked));
});

after(() => {
  proxy.closeAllConnections();
  proxy.close();
  rmSync(shims, { force: true, recursive: true });
});
