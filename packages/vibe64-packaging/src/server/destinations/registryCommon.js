// Shared mechanics of the registry destinations (npm, PyPI, GitHub Releases):
// the exact files of an artifact set, a scrubbed tool environment, tool runs
// whose output never repeats a credential, and small HTTP reads.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJson, sha256 } from "../canonical.js";
import { publishError } from "../errors.js";
import { BUILD_ENVIRONMENT_PASSTHROUGH, spawnCommand } from "../stages.js";

const HTTP_TIMEOUT_MS = 30_000;

// Every artifact file by its upload name (its base name), with checksum and size.
function artifactFiles(artifacts) {
  const files = artifacts.manifest.files.map((file) => ({
    name: path.posix.basename(file.path),
    path: path.join(artifacts.directory, "files", file.path),
    sha256: file.sha256,
    size: file.size
  }));
  const names = new Set();
  for (const file of files) {
    if (names.has(file.name)) {
      throw publishError("VIBE64_PUBLISH_ARTIFACT_INVALID", `Two built files are both named ${file.name}; uploads need distinct names.`);
    }
    names.add(file.name);
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

// One checksum for a set of named files, comparable with what a registry reports.
function namedFilesChecksum(files) {
  return sha256(canonicalJson([...files]
    .map(({ name, sha256: checksum }) => ({ name, sha256: checksum }))
    .sort((left, right) => left.name.localeCompare(right.name))));
}

function settingsOf(target) {
  const settings = target?.settings;
  if (settings !== undefined && (settings === null || typeof settings !== "object" || Array.isArray(settings))) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `Target ${target?.id} has invalid settings.`);
  }
  return settings || {};
}

function httpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `${label} must be an http or https address.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `${label} must be an http or https address without a user name.`);
  }
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

function commandPrefix(value, fallback, label) {
  const argv = value === undefined ? fallback : value;
  if (!Array.isArray(argv) || !argv.length || argv.some((part) => typeof part !== "string" || !part)) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `${label} must be a non-empty argv list.`);
  }
  return argv;
}

// Publishing tools see PATH and locale, a private HOME, and nothing they could
// mistake for an ambient login.
function toolEnvironment({ home, baseEnvironment = process.env, extra = {} }) {
  const environment = {};
  for (const name of BUILD_ENVIRONMENT_PASSTHROUGH) {
    if (typeof baseEnvironment[name] === "string") environment[name] = baseEnvironment[name];
  }
  return {
    ...environment,
    HOME: home,
    TMPDIR: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...extra
  };
}

async function withToolHome(operation) {
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-publish-tool-"));
  try {
    return await operation(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function redact(text, secrets = []) {
  let value = String(text || "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 6) value = value.split(secret).join("[credential]");
  }
  return value;
}

// Runs one tool; failures carry its redacted output, never a credential.
async function runTool({ argv, cwd, env, stdin = null, secrets = [], failureCode, failureMessage }, { runCommand = spawnCommand } = {}) {
  const result = await runCommand({ command: argv[0], args: argv.slice(1), cwd, env, stdin });
  const output = redact(`${result?.stdout || ""}${result?.stderr || ""}${result?.error || ""}`, secrets).trim();
  if (result?.ok !== true) {
    throw publishError(failureCode, failureMessage, { exitCode: result?.exitCode ?? null, output: output.slice(-8000) });
  }
  return { stdout: redact(result.stdout, secrets), stderr: redact(result.stderr, secrets), output };
}

async function readCredentialText(file, label) {
  const value = (await readFile(file, "utf8")).trim();
  if (!value) throw publishError("VIBE64_PUBLISH_CREDENTIAL_MISSING", `${label} is empty.`);
  return value;
}

async function httpRequest(url, { method = "GET", headers = {}, body, accept = "application/json", timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { accept, "user-agent": "vibe64-publish", ...headers },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw publishError("VIBE64_PUBLISH_REGISTRY_UNREACHABLE", `Could not reach ${new URL(url).host}: ${error?.cause?.code || error?.name || "network error"}.`);
  }
  return response;
}

async function httpJson(url, options = {}) {
  const response = await httpRequest(url, options);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, ok: response.ok, headers: response.headers, json, text };
}

export {
  artifactFiles,
  commandPrefix,
  httpJson,
  httpRequest,
  httpUrl,
  namedFilesChecksum,
  readCredentialText,
  redact,
  runTool,
  settingsOf,
  toolEnvironment,
  withToolHome
};
