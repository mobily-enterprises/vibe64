// The PyPI destination uploads the exact Stage 1 sdist and wheels with twine and
// proves them by reading the index's own sha256 for every file back.
//
// One credential, a PyPI token (or, for a private index, the account password),
// is delivered as a private file and only ever reaches twine through a private
// config file in a throwaway home; it never appears in argv or the environment.
// Settings on the target: { instance: "pypi" | "testpypi" } or, for another
// index, { repository: upload URL, index: simple index URL }, plus
// { username } (default `__token__`) and { twine: argv prefix }.
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { publishError } from "../../errors.js";
import { distributionFileVersion, normalizeProjectName } from "../../packers/pythonDist/index.js";
import { pep440FromSemver } from "../../release/version.js";
import {
  artifactFiles,
  commandPrefix,
  httpJson,
  httpUrl,
  namedFilesChecksum,
  readCredentialText,
  runTool,
  settingsOf,
  toolEnvironment,
  withToolHome
} from "../registryCommon.js";

const INSTANCES = Object.freeze({
  pypi: Object.freeze({ repository: "https://upload.pypi.org/legacy/", index: "https://pypi.org/simple/", web: "https://pypi.org/" }),
  testpypi: Object.freeze({ repository: "https://test.pypi.org/legacy/", index: "https://test.pypi.org/simple/", web: "https://test.pypi.org/" })
});
const CREDENTIAL = Object.freeze({ id: "pypi-token", label: "PyPI token", delivery: "file" });
const SIMPLE_JSON = "application/vnd.pypi.simple.v1+json";
const SHA256_HEX = /^[0-9a-f]{64}$/u;

function pypiSettings(target) {
  const settings = settingsOf(target);
  const custom = Boolean(settings.repository || settings.index);
  const instance = settings.instance ?? (custom ? null : "pypi");
  if (instance !== null && !INSTANCES[instance]) throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "The PyPI instance is pypi or testpypi.");
  if (instance && custom) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "Give either a PyPI instance or repository and index addresses, not both.");
  }
  if (!instance && !(settings.repository && settings.index)) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "A private Python index needs both its upload and its simple index address.");
  }
  const username = settings.username ?? "__token__";
  if (typeof username !== "string" || !/^[\x21-\x7e]{1,128}$/u.test(username)) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "The PyPI user name must be one word.");
  }
  return {
    instance,
    repository: httpUrl(instance ? INSTANCES[instance].repository : settings.repository, "The Python upload address"),
    index: httpUrl(instance ? INSTANCES[instance].index : settings.index, "The Python simple index"),
    web: instance ? INSTANCES[instance].web : null,
    username,
    twine: commandPrefix(settings.twine, ["python3", "-m", "twine"], "The twine command")
  };
}

// The release's files, its one project and its PEP 440 version.
function distributions(artifacts, version) {
  const files = artifactFiles(artifacts).map((file) => ({ ...file, ...distributionFileVersion(file.name) }));
  const projects = new Set(files.map((file) => file.project));
  const versions = new Set(files.map((file) => file.version));
  if (!files.length || files.some((file) => !file.kind) || projects.size !== 1 || versions.size !== 1) {
    throw publishError("VIBE64_PUBLISH_ARTIFACT_INVALID", "PyPI publishes the sdist and wheels of exactly one release.");
  }
  const [built] = versions;
  if (version && built !== pep440FromSemver(version)) {
    throw publishError("VIBE64_PUBLISH_VERSION_MISMATCH", `The distributions are version ${built}, not ${pep440FromSemver(version)}.`);
  }
  return { files, project: [...projects][0], version: built };
}

function expectedChecksum(artifacts) {
  return namedFilesChecksum(artifactFiles(artifacts));
}

function unescapeHtml(value) {
  return value.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&amp;/gu, "&");
}

// PEP 691 JSON when the index speaks it, otherwise PEP 503 HTML anchors whose
// URL fragment carries the file's sha256.
function indexFiles(response) {
  if (Array.isArray(response.json?.files)) {
    return response.json.files.map((file) => ({
      name: file.filename,
      sha256: String(file.hashes?.sha256 || "").toLowerCase(),
      yanked: Boolean(file.yanked)
    }));
  }
  const files = [];
  for (const match of response.text.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/giu)) {
    const hash = /#sha256=([0-9a-f]{64})/iu.exec(unescapeHtml(match[1]));
    files.push({ name: unescapeHtml(match[2]).trim(), sha256: hash ? hash[1].toLowerCase() : "", yanked: /data-yanked/iu.test(match[0]) });
  }
  return files;
}

async function readIndex({ index, project }) {
  const response = await httpJson(new URL(`${normalizeProjectName(project)}/`, index).href, {
    accept: `${SIMPLE_JSON}, text/html;q=0.1`
  });
  if (response.status === 404) return [];
  if (!response.ok) throw publishError("VIBE64_PUBLISH_REGISTRY_FAILED", `The Python index answered ${response.status} for ${project}.`);
  return indexFiles(response);
}

function releaseFiles(listed, release) {
  return listed.filter((file) => {
    const parsed = distributionFileVersion(file.name);
    return parsed?.project === release.project && parsed.version === release.version;
  });
}

async function readBack({ target, version, artifacts }) {
  const settings = pypiSettings(target);
  const release = distributions(artifacts, version);
  const listed = releaseFiles(await readIndex({ index: settings.index, project: release.project }), release);
  if (!listed.length) return { published: false };
  const ours = new Map(release.files.map((file) => [file.name, file.sha256]));
  const differing = listed.filter((entry) => ours.get(entry.name) !== `sha256:${entry.sha256}`);
  // A partial upload of our own files resumes; anything else under this version is a conflict.
  if (!differing.length && listed.length < release.files.length) {
    return { published: false, partial: listed.map((entry) => entry.name).sort() };
  }
  const files = listed
    .map(({ name, sha256, yanked }) => ({ name, sha256: SHA256_HEX.test(sha256) ? `sha256:${sha256}` : "unknown", yanked }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    published: true,
    checksum: namedFilesChecksum(files),
    proof: {
      index: settings.index,
      project: release.project,
      version: release.version,
      files,
      page: settings.web ? `${settings.web}project/${release.project}/${release.version}/` : null
    }
  };
}

// twine reads the token only from a private config file in a throwaway home.
async function runTwine(settings, args, { token = "", failureMessage }) {
  return withToolHome(async (home) => {
    const argv = [...settings.twine, ...args];
    if (token) {
      const config = path.join(home, "pypirc");
      await writeFile(config, [
        "[distutils]",
        "index-servers = vibe64",
        "",
        "[vibe64]",
        `repository = ${settings.repository}`,
        `username = ${settings.username}`,
        `password = ${token}`,
        ""
      ].join("\n"), { mode: 0o600, flag: "wx" });
      argv.push("--config-file", config, "--repository", "vibe64");
    }
    return runTool({
      argv,
      cwd: home,
      env: toolEnvironment({ home, extra: { PYTHON_KEYRING_BACKEND: "keyring.backends.null.Keyring", PYTHONDONTWRITEBYTECODE: "1" } }),
      secrets: [token],
      failureCode: "VIBE64_PUBLISH_UPLOAD_FAILED",
      failureMessage
    });
  });
}

async function credentialToken(credentials) {
  const file = credentials?.files?.[CREDENTIAL.id];
  return file ? readCredentialText(file, CREDENTIAL.label) : "";
}

async function upload({ target, version, artifacts, credentials }) {
  const settings = pypiSettings(target);
  const release = distributions(artifacts, version);
  const token = await credentialToken(credentials);
  if (!token) throw publishError("VIBE64_PUBLISH_CREDENTIAL_MISSING", "PyPI publishing needs a PyPI token.");
  // Resuming after a partial upload sends only the files the index does not list yet.
  const listed = new Set((await readIndex({ index: settings.index, project: release.project })).map((file) => file.name));
  const pending = release.files.filter((file) => !listed.has(file.name));
  const result = await runTwine(settings, ["upload", "--non-interactive", "--disable-progress-bar", ...pending.map((file) => file.path)], {
    token,
    failureMessage: `twine did not upload ${release.project} ${release.version}.`
  });
  return { files: pending.map((file) => file.name), output: result.output.slice(-2000) };
}

// `twine check --strict` on the exact files, and what the index already holds.
async function dryRun({ target, version, artifacts }) {
  const settings = pypiSettings(target);
  const release = distributions(artifacts, version);
  const check = await runTwine(settings, ["check", "--strict", ...release.files.map((file) => file.path)], {
    failureMessage: `twine check refused ${release.project} ${release.version}.`
  });
  const listed = await readIndex({ index: settings.index, project: release.project });
  const versions = [...new Set(listed.map((file) => distributionFileVersion(file.name)?.version).filter(Boolean))].sort();
  return {
    ok: true,
    destination: "pypi",
    index: settings.index,
    project: release.project,
    version: release.version,
    files: release.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
    alreadyPublished: versions.includes(release.version),
    publishedVersions: versions,
    report: check.output.slice(-4000)
  };
}

// PyPI offers no read-only way to test an upload token; say so honestly.
async function verifyCredential({ credentials }) {
  const token = await credentialToken(credentials);
  if (!token) return { ok: false, message: "No PyPI token is saved for this target." };
  return { ok: true, verified: false, message: "PyPI cannot check a token without uploading; the upload proves it." };
}

// PyPI yanks only on its website: this is the page to do it, never an automatic action.
function yankPage({ target, project, version }) {
  const settings = pypiSettings(target);
  return settings.web ? `${settings.web}manage/project/${normalizeProjectName(project)}/release/${version}/` : null;
}

const pypiDestination = Object.freeze({
  id: "pypi",
  label: "PyPI",
  packers: Object.freeze(["python-dist"]),
  channels: Object.freeze([]),
  modes: Object.freeze(["token"]),
  credentials: Object.freeze([CREDENTIAL]),
  implemented: true,
  expectedChecksum,
  dryRun,
  upload,
  readBack,
  verifyCredential,
  yankPage
});

export { pypiDestination };
