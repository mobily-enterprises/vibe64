import { createRequire } from "node:module";

import { formatGreeting } from "./format.ts";

const require = createRequire(import.meta.url);
const { legacyTotal } = require("./legacy.cjs");

let housekeepingRuns = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function alphaStep(name) {
  return formatGreeting(name);
}

function betaStep(values) {
  return legacyTotal(values);
}

const gammaStep = (text) => text.split("").reverse().join("");

function explode() {
  const message = "boom";
  throw new Error(message);
}

export function housekeeping() {
  housekeepingRuns += 1;
}

async function readBody(request) {
  let length = 0;
  for await (const chunk of request) length += chunk.length;
  return length;
}

const routes = {
  async "/alpha"() {
    await delay(40);
    return alphaStep("alpha");
  },
  async "/beta"() {
    await delay(20);
    const total = betaStep([1, 2, 3]);
    await delay(20);
    return `total ${total}`;
  },
  async "/gamma"() {
    await delay(10);
    return gammaStep("gamma");
  },
  async "/boom"() {
    try {
      explode();
    } catch (error) {
      return error.stack.split("\n").slice(0, 3).join("\n");
    }
    return "";
  },
  async "/odd"() {
    return require("./odd.cjs").odd();
  },
  async "/count"() {
    for (let index = 0; index < 5; index += 1) gammaStep("x");
    return `housekeeping ${housekeepingRuns > 0}`;
  },
  async "/work"() {
    let length = 0;
    for (let index = 0; index < 2000; index += 1) length += gammaStep("work").length;
    return `work ${length}`;
  }
};

export async function handleRequest(request, response) {
  const bytes = await readBody(request);
  const route = routes[new URL(request.url, "http://localhost").pathname];
  const body = route ? await route() : `not found (${bytes})`;
  response.statusCode = route ? 200 : 404;
  response.setHeader("content-type", "text/plain");
  response.end(body);
}
