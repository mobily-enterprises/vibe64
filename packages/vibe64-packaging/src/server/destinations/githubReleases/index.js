// The GitHub Releases destination attaches the exact Stage 1 files to the release
// of the tag Vibe64 put on the saved commit, and proves them through the Releases
// API's own sha256 digest of every asset. A published asset is never replaced:
// a different file under the same name is a conflict, never an overwrite.
//
// One credential, a GitHub token with contents access to the repository, is
// delivered as a private file; `gh` receives it only in its environment.
// Target: { tag (default `v<version>`), notes, settings: { repository: "owner/name",
// api, gh: argv prefix } }; channel draft | prerelease | latest (default latest).
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { publishError } from "../../errors.js";
import {
  artifactFiles,
  commandPrefix,
  httpJson,
  httpRequest,
  httpUrl,
  namedFilesChecksum,
  readCredentialText,
  runTool,
  settingsOf,
  toolEnvironment,
  withToolHome
} from "../registryCommon.js";

const CREDENTIAL = Object.freeze({ id: "github-token", label: "GitHub sign-in", delivery: "file" });
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;
const TAG = /^[0-9A-Za-z][0-9A-Za-z._@/+-]{0,199}$/u;
const CHANNELS = Object.freeze(["draft", "prerelease", "latest"]);

function releaseSettings(target, version) {
  const settings = settingsOf(target);
  if (!REPOSITORY.test(settings.repository || "")) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "GitHub Releases needs the repository as owner/name.");
  }
  const channel = target?.channel || "latest";
  if (!CHANNELS.includes(channel)) throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `GitHub Releases has no channel ${channel}.`);
  const tag = target?.tag || `v${version}`;
  if (!TAG.test(tag) || tag.includes("..")) throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `${tag} is not a release tag.`);
  const notes = target?.notes ?? `Release ${tag}.`;
  if (typeof notes !== "string") throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "Release notes must be text.");
  return {
    repository: settings.repository,
    api: httpUrl(settings.api || "https://api.github.com/", "The GitHub API address"),
    gh: commandPrefix(settings.gh, ["gh"], "The gh command"),
    channel,
    tag,
    notes
  };
}

function expectedChecksum(artifacts) {
  return namedFilesChecksum(artifactFiles(artifacts));
}

async function credentialToken(credentials) {
  const file = credentials?.files?.[CREDENTIAL.id];
  if (!file) throw publishError("VIBE64_PUBLISH_CREDENTIAL_MISSING", "GitHub Releases needs a GitHub sign-in.");
  return readCredentialText(file, CREDENTIAL.label);
}

function apiHeaders(token) {
  return { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
}

// Drafts have no public tag yet, so the release is found in the list by tag name.
async function findRelease({ api, repository, tag, token }) {
  for (let page = 1; page <= 10; page += 1) {
    const response = await httpJson(new URL(`repos/${repository}/releases?per_page=100&page=${page}`, api).href, {
      accept: "application/vnd.github+json",
      headers: apiHeaders(token)
    });
    if (response.status === 404) throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `GitHub has no repository ${repository} this sign-in can see.`);
    if (!response.ok || !Array.isArray(response.json)) {
      throw publishError("VIBE64_PUBLISH_REGISTRY_FAILED", `GitHub answered ${response.status} listing releases of ${repository}.`);
    }
    const found = response.json.find((release) => release.tag_name === tag);
    if (found || response.json.length < 100) return found || null;
  }
  return null;
}

// GitHub reports `digest: "sha256:..."` for assets; older assets without one are hashed.
async function assetDigest(asset, token) {
  if (/^sha256:[0-9a-f]{64}$/u.test(asset.digest || "")) return asset.digest;
  const response = await httpRequest(asset.url, { accept: "application/octet-stream", headers: apiHeaders(token) });
  if (!response.ok) throw publishError("VIBE64_PUBLISH_REGISTRY_FAILED", `GitHub did not return asset ${asset.name} (${response.status}).`);
  return `sha256:${createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex")}`;
}

function channelOf(release, latestId) {
  if (release.draft) return "draft";
  if (release.prerelease) return "prerelease";
  return release.id === latestId ? "latest" : "release";
}

async function latestReleaseId({ api, repository, token }) {
  const response = await httpJson(new URL(`repos/${repository}/releases/latest`, api).href, {
    accept: "application/vnd.github+json",
    headers: apiHeaders(token)
  });
  return response.ok ? response.json?.id ?? null : null;
}

async function readBack({ target, version, artifacts, credentials }) {
  const settings = releaseSettings(target, version);
  const token = await credentialToken(credentials);
  const release = await findRelease({ ...settings, token });
  if (!release) return { published: false };
  const files = artifactFiles(artifacts);
  const ours = new Map(files.map((file) => [file.name, file.sha256]));
  const assets = [];
  for (const asset of release.assets || []) {
    if (ours.has(asset.name)) assets.push({ name: asset.name, sha256: await assetDigest(asset, token), size: asset.size });
  }
  const differing = assets.some((asset) => ours.get(asset.name) !== asset.sha256);
  if (!differing && assets.length < files.length) return { published: false, release: release.id, partial: assets.map(({ name }) => name).sort() };
  return {
    published: true,
    checksum: namedFilesChecksum(assets),
    proof: {
      repository: settings.repository,
      tag: settings.tag,
      release: release.id,
      url: release.html_url,
      channel: channelOf(release, release.draft ? null : await latestReleaseId({ ...settings, token })),
      immutable: typeof release.immutable === "boolean" ? release.immutable : null,
      assets: assets.sort((left, right) => left.name.localeCompare(right.name))
    }
  };
}

async function runGh(settings, args, { token, home, failureMessage }) {
  return runTool({
    argv: [...settings.gh, ...args],
    cwd: home,
    env: toolEnvironment({
      home,
      extra: { GH_TOKEN: token, GH_CONFIG_DIR: path.join(home, "gh"), GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1" }
    }),
    secrets: [token],
    failureCode: "VIBE64_PUBLISH_UPLOAD_FAILED",
    failureMessage
  });
}

function channelFlags(channel) {
  if (channel === "draft") return ["--draft"];
  if (channel === "prerelease") return ["--prerelease", "--latest=false"];
  return ["--latest"];
}

// Creates the release on the existing tag with every file, or, resuming, attaches
// only the files it still lacks (never `--clobber`).
async function upload({ target, version, artifacts, credentials }) {
  const settings = releaseSettings(target, version);
  const token = await credentialToken(credentials);
  const files = artifactFiles(artifacts);
  const existing = await findRelease({ ...settings, token });
  return withToolHome(async (home) => {
    if (existing) {
      const present = new Set((existing.assets || []).map((asset) => asset.name));
      const pending = files.filter((file) => !present.has(file.name));
      if (pending.length) {
        await runGh(settings, ["release", "upload", settings.tag, ...pending.map((file) => file.path), "--repo", settings.repository], {
          token,
          home,
          failureMessage: `gh did not attach the files to ${settings.tag}.`
        });
      }
      return { release: existing.id, files: pending.map((file) => file.name) };
    }
    const notes = path.join(home, "notes.md");
    await writeFile(notes, `${settings.notes.trim()}\n`, { mode: 0o600 });
    await runGh(settings, [
      "release", "create", settings.tag, ...files.map((file) => file.path),
      "--repo", settings.repository, "--verify-tag", "--title", settings.tag, "--notes-file", notes, ...channelFlags(settings.channel)
    ], { token, home, failureMessage: `gh did not create the ${settings.tag} release.` });
    return { files: files.map((file) => file.name) };
  });
}

// What would be attached, and whether the tag and release exist already.
async function dryRun({ target, version, artifacts, credentials }) {
  const settings = releaseSettings(target, version);
  const token = await credentialToken(credentials);
  const files = artifactFiles(artifacts);
  const [release, tag] = await Promise.all([
    findRelease({ ...settings, token }),
    httpJson(new URL(`repos/${settings.repository}/git/ref/tags/${encodeURIComponent(settings.tag)}`, settings.api).href, {
      accept: "application/vnd.github+json",
      headers: apiHeaders(token)
    })
  ]);
  const present = new Map((release?.assets || []).map((asset) => [asset.name, asset]));
  return {
    ok: true,
    destination: "github-releases",
    repository: settings.repository,
    tag: settings.tag,
    tagPushed: tag.ok,
    channel: settings.channel,
    releaseExists: Boolean(release),
    files: files.map(({ name, size, sha256 }) => ({ name, size, sha256, alreadyAttached: present.has(name) })),
    alreadyPublished: Boolean(release) && files.every((file) => present.has(file.name))
  };
}

// A read-only proof that the sign-in can see the repository and write to it.
async function verifyCredential({ target, credentials }) {
  const settings = releaseSettings(target, "0.0.0");
  let token;
  try {
    token = await credentialToken(credentials);
  } catch (error) {
    return { ok: false, message: error.message };
  }
  const response = await httpJson(new URL(`repos/${settings.repository}`, settings.api).href, {
    accept: "application/vnd.github+json",
    headers: apiHeaders(token)
  });
  if (!response.ok) return { ok: false, message: `GitHub did not show ${settings.repository} to this sign-in (${response.status}).` };
  if (response.json?.permissions && !response.json.permissions.push) {
    return { ok: false, message: `This GitHub sign-in cannot publish releases to ${settings.repository}.` };
  }
  return { ok: true, account: settings.repository, message: `Can publish releases to ${settings.repository}.` };
}

// "Rollback" for a release: make an earlier release the latest one again.
async function markLatest({ target, tag, credentials }) {
  const settings = releaseSettings({ ...target, tag }, "0.0.0");
  const token = await credentialToken(credentials);
  const release = await findRelease({ ...settings, token });
  if (!release || release.draft) throw publishError("VIBE64_PUBLISH_TARGET_INVALID", `${settings.tag} is not a published release.`);
  await withToolHome((home) => runGh(settings, ["release", "edit", settings.tag, "--repo", settings.repository, "--latest"], {
    token,
    home,
    failureMessage: `gh did not make ${settings.tag} the latest release.`
  }));
  if (await latestReleaseId({ ...settings, token }) !== release.id) {
    throw publishError("VIBE64_PUBLISH_NOT_PROVEN", `GitHub does not show ${settings.tag} as the latest release yet.`);
  }
  return { tag: settings.tag };
}

const githubReleasesDestination = Object.freeze({
  id: "github-releases",
  label: "GitHub Releases",
  packers: Object.freeze(["npm", "python-dist", "capacitor"]),
  channels: CHANNELS,
  modes: Object.freeze(["token"]),
  credentials: Object.freeze([CREDENTIAL]),
  readBackCredentials: Object.freeze([CREDENTIAL]),
  implemented: true,
  expectedChecksum,
  dryRun,
  upload,
  readBack,
  verifyCredential,
  markLatest
});

export { githubReleasesDestination };
