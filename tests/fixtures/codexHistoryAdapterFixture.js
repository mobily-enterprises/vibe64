import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The managed leader owns the history adapter. Replace its upstream transport
// in native tests, while retaining the real adapter, Codex process and protocol.
export async function codexHistoryAdapterFixture(root, fixtureUrl) {
  const preload = path.join(root, "history-adapter-fixture.mjs");
  await writeFile(preload, `
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.origin !== "https://api.openai.com" || !url.pathname.startsWith("/v1/")) {
    throw new Error("Unexpected fixture upstream: " + url.origin + url.pathname);
  }
  return nativeFetch(new URL(url.pathname + url.search, ${JSON.stringify(fixtureUrl)}), options);
};
`);
  return `--import=${pathToFileURL(preload).href}`;
}
