// The npm destination publishes the exact Stage 1 tarball to an npm registry and
// proves it by reading the registry's own integrity value back.
//
// The credential is an npm user config file ("npm sign-in"); the caller turns a
// token into that file with npmTokenUserconfig.
// Settings on the target: { registry, access: "public" | "restricted" } and
// { npm: argv prefix } (default `npm`) for a host that runs its own npm.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { publishError } from "../../errors.js";
import {
  artifactFiles,
  commandPrefix,
  httpJson,
  httpRequest,
  httpUrl,
  readCredentialText,
  runTool,
  settingsOf,
  toolEnvironment,
  withToolHome
} from "../registryCommon.js";
import { diffFileLists, listNpmTarball, npmTarballManifest } from "./tarball.js";

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const CREDENTIAL = Object.freeze({ id: "npm-userconfig", label: "npm sign-in", delivery: "file" });

function npmSettings(target) {
  const settings = settingsOf(target);
  const access = settings.access ?? null;
  if (access !== null && !["public", "restricted"].includes(access)) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "npm access is public or restricted.");
  }
  return {
    registry: httpUrl(settings.registry || DEFAULT_REGISTRY, "The npm registry"),
    access,
    channel: target?.channel || "latest",
    npm: commandPrefix(settings.npm, ["npm"], "The npm command")
  };
}

// npm's per-registry config key: `//host[:port]/path/`.
function registryKey(registry) {
  const url = new URL(registry);
  return `//${url.host}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
}

function npmTokenUserconfig({ registry = DEFAULT_REGISTRY, token } = {}) {
  if (typeof token !== "string" || !/^[\x21-\x7e]{8,}$/u.test(token)) {
    throw publishError("VIBE64_PUBLISH_CREDENTIAL_MISSING", "The npm token is missing or malformed.");
  }
  return `${registryKey(httpUrl(registry, "The npm registry"))}:_authToken=${token}\n`;
}

function registryToken(userconfig, registry) {
  const key = `${registryKey(registry)}:_authToken=`;
  const line = userconfig.split(/\r?\n/u).map((value) => value.trim()).find((value) => value.startsWith(key));
  return line ? line.slice(key.length).trim() : "";
}

function packumentUrl(registry, name) {
  return new URL(name.startsWith("@") ? name.replace("/", "%2f") : encodeURIComponent(name), registry).href;
}

function tarballOf(artifacts) {
  const files = artifactFiles(artifacts);
  if (files.length !== 1 || !files[0].name.endsWith(".tgz")) {
    throw publishError("VIBE64_PUBLISH_ARTIFACT_INVALID", "npm publishes exactly one tarball.");
  }
  return files[0];
}

function integrityOf(buffer) {
  return `sha512-${createHash("sha512").update(buffer).digest("base64")}`;
}

// What the registry reports for an identical tarball: its sha512 integrity.
function expectedChecksum(artifacts) {
  return integrityOf(readFileSync(tarballOf(artifacts).path));
}

async function tarballDetails(artifacts) {
  const file = tarballOf(artifacts);
  const bytes = await readFile(file.path);
  const entries = listNpmTarball(bytes);
  const manifest = npmTarballManifest(entries);
  return { file, bytes, entries, manifest };
}

function assertVersion(manifest, version) {
  if (version && manifest.version !== version) {
    throw publishError("VIBE64_PUBLISH_VERSION_MISMATCH", `The tarball is ${manifest.name}@${manifest.version}, not ${version}.`);
  }
}

async function readPackument({ registry, name, token = "" }) {
  const response = await httpJson(packumentUrl(registry, name), {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  if (response.status === 404) return null;
  if (!response.ok || !response.json) {
    throw publishError("VIBE64_PUBLISH_REGISTRY_FAILED", `The npm registry answered ${response.status} for ${name}.`);
  }
  return response.json;
}

async function credentialToken(credentials, registry) {
  const file = credentials?.files?.[CREDENTIAL.id];
  if (!file) return { file: null, token: "" };
  const userconfig = await readCredentialText(file, CREDENTIAL.label);
  return { file, token: registryToken(userconfig, registry) };
}

// Runs the npm CLI with only the given user config, a private cache and no
// global or project config, from an empty folder.
async function runNpm(args, { npm = ["npm"], userconfig = null, secrets = [], failureMessage }) {
  return withToolHome(async (home) => {
    const empty = path.join(home, "empty.npmrc");
    await writeFile(empty, "", { mode: 0o600 });
    const env = toolEnvironment({
      home,
      extra: {
        npm_config_userconfig: userconfig || empty,
        npm_config_globalconfig: empty,
        npm_config_cache: path.join(home, "cache"),
        npm_config_logs_max: "0",
        npm_config_update_notifier: "false",
        npm_config_fund: "false",
        npm_config_audit: "false"
      }
    });
    return runTool({ argv: [...npm, ...args], cwd: home, env, secrets, failureCode: "VIBE64_PUBLISH_UPLOAD_FAILED", failureMessage });
  });
}

async function readBack({ target, version, artifacts, credentials }) {
  const { registry, channel } = npmSettings(target);
  const { manifest } = await tarballDetails(artifacts);
  assertVersion(manifest, version);
  const { token } = await credentialToken(credentials, registry);
  const packument = await readPackument({ registry, name: manifest.name, token });
  const published = packument?.versions?.[manifest.version];
  if (!published) return { published: false };
  const checksum = published.dist?.integrity || "";
  return {
    published: true,
    checksum,
    proof: {
      registry,
      package: manifest.name,
      version: manifest.version,
      integrity: checksum,
      channel,
      channelVersion: packument["dist-tags"]?.[channel] || null,
      tarball: published.dist?.tarball || null
    }
  };
}

async function upload({ target, version, artifacts, credentials }) {
  const { registry, access, channel, npm } = npmSettings(target);
  const { file, manifest } = await tarballDetails(artifacts);
  assertVersion(manifest, version);
  const { file: userconfig, token } = await credentialToken(credentials, registry);
  if (!userconfig) throw publishError("VIBE64_PUBLISH_CREDENTIAL_MISSING", "npm publishing needs an npm sign-in.");
  const args = ["publish", file.path, "--registry", registry, "--tag", channel, "--ignore-scripts"];
  if (access) args.push("--access", access);
  const result = await runNpm(args, {
    npm,
    userconfig,
    secrets: [token],
    failureMessage: `npm did not publish ${manifest.name}@${manifest.version}.`
  });
  return { output: result.output.slice(-2000) };
}

// `npm publish --dry-run` on the exact tarball, plus what changes compared with
// the version the channel serves today.
async function dryRun({ target, version, artifacts, credentials }) {
  const { registry, access, channel, npm } = npmSettings(target);
  const { file, bytes, entries, manifest } = await tarballDetails(artifacts);
  assertVersion(manifest, version);
  const { file: userconfig, token } = await credentialToken(credentials, registry);
  const packument = await readPackument({ registry, name: manifest.name, token });
  const alreadyPublished = Boolean(packument?.versions?.[manifest.version]);
  let report = "";
  // npm refuses even a dry run over a published version; read-back decides that case.
  if (!alreadyPublished) {
    const args = ["publish", "--dry-run", file.path, "--registry", registry, "--tag", channel, "--ignore-scripts"];
    if (access) args.push("--access", access);
    report = (await runNpm(args, {
      npm,
      userconfig,
      secrets: [token],
      failureMessage: `npm's dry run refused ${manifest.name}@${manifest.version}.`
    })).output.slice(-4000);
  }
  const previousVersion = packument?.["dist-tags"]?.[channel] || packument?.["dist-tags"]?.latest || null;
  let previousEntries = [];
  if (previousVersion && packument.versions?.[previousVersion]?.dist?.tarball) {
    const response = await httpRequest(packument.versions[previousVersion].dist.tarball, {
      accept: "application/octet-stream",
      headers: token ? { authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) throw publishError("VIBE64_PUBLISH_REGISTRY_FAILED", `Could not download ${manifest.name}@${previousVersion} to compare.`);
    previousEntries = listNpmTarball(Buffer.from(await response.arrayBuffer()));
  }
  return {
    ok: true,
    destination: "npm",
    registry,
    package: manifest.name,
    version: manifest.version,
    channel,
    integrity: integrityOf(bytes),
    size: bytes.length,
    files: entries.map(({ path: file, size }) => ({ path: file, size })),
    previousVersion,
    diff: previousVersion ? diffFileLists(previousEntries, entries) : null,
    alreadyPublished,
    report
  };
}

// A read-only proof that the sign-in works: the registry's whoami.
async function verifyCredential({ target, credentials }) {
  const { registry } = npmSettings(target);
  const { token } = await credentialToken(credentials, registry);
  if (!token) return { ok: false, message: "The npm sign-in has no token for this registry." };
  const response = await httpJson(new URL("-/whoami", registry).href, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok || typeof response.json?.username !== "string") {
    const refused = [401, 403].includes(response.status);
    return {
      ok: false,
      message: refused
        ? `npm refused this sign-in (HTTP ${response.status}): its token may have expired or cannot publish.`
        : `npm could not confirm who this sign-in belongs to (HTTP ${response.status}); its token may not be valid here.`
    };
  }
  return { ok: true, account: response.json.username, message: `Signed in to npm as ${response.json.username}.` };
}

const npmDestination = Object.freeze({
  id: "npm",
  label: "npm",
  packers: Object.freeze(["npm"]),
  channels: Object.freeze(["latest", "next"]),
  credentials: Object.freeze([CREDENTIAL]),
  readBackCredentials: (target) => (settingsOf(target).access === "restricted" ? [CREDENTIAL] : []),
  expectedChecksum,
  dryRun,
  upload,
  readBack,
  verifyCredential
});

export { npmDestination, npmTokenUserconfig };
