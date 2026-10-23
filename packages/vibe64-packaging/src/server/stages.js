// The three publish stages. Stage 1 builds third-party code with no credentials
// and snapshots unsigned artifacts with checksums into an immutable result store.
// Stage 2 hands the exact bytes and caller-supplied credentials (private temporary
// files or stdin, always removed) to a destination. Stage 3 reads the published
// version back; a target succeeds only then.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJson, sha256 } from "./canonical.js";
import { publishError } from "./errors.js";

const VIBE64_PUBLISH_ARTIFACTS_CONTRACT = "vibe64.publish-artifacts.v1";
const BUILD_ENVIRONMENT_PASSTHROUGH = Object.freeze(["PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TERM"]);
const CREDENTIAL_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|API_KEY|CREDENTIAL|_AUTH)/iu;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PLAN_HASH = /^sha256:([0-9a-f]{64})$/u;
const OUTPUT_LIMIT = 64 * 1024;

function stageError(code, message, details) {
  return publishError(code, message, details);
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw stageError("VIBE64_PUBLISH_STAGE_INVALID", `${label} must be an absolute path.`);
  return path.resolve(value);
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Stage 1 environment: a fixed passthrough (PATH and locale), a fresh credential-free
// HOME, and the package's declared non-secret build Environment. Nothing else.
function buildStageEnvironment({ baseEnvironment = process.env, declared = [], home, cacheDirectory = "" } = {}) {
  const environment = {};
  for (const name of BUILD_ENVIRONMENT_PASSTHROUGH) {
    if (typeof baseEnvironment[name] === "string") environment[name] = baseEnvironment[name];
  }
  Object.assign(environment, {
    HOME: home,
    TMPDIR: path.join(home, "tmp"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: cacheDirectory || path.join(home, ".cache"),
    npm_config_userconfig: path.join(home, ".npmrc"),
    npm_config_cache: path.join(cacheDirectory || path.join(home, ".cache"), "npm"),
    GIT_TERMINAL_PROMPT: "0",
    CI: "1"
  });
  for (const entry of declared) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(entry?.name || "") || typeof entry.value !== "string") {
      throw stageError("VIBE64_PUBLISH_STAGE_INVALID", "Build Environment entries need an uppercase name and a text value.");
    }
    if (CREDENTIAL_NAME.test(entry.name)) {
      throw stageError("VIBE64_PUBLISH_CREDENTIAL_IN_BUILD", `Build Environment ${entry.name} looks like a credential; builds run without credentials.`);
    }
    if (Object.hasOwn(environment, entry.name)) {
      throw stageError("VIBE64_PUBLISH_STAGE_INVALID", `Build Environment ${entry.name} is reserved by the build stage.`);
    }
    environment[entry.name] = entry.value;
  }
  return environment;
}

function tail(text) {
  const value = String(text || "");
  return value.length > OUTPUT_LIMIT ? value.slice(-OUTPUT_LIMIT) : value;
}

// Runs argv without a shell, with exactly the given environment.
function spawnCommand({ command, args, cwd, env, stdin = null, signal }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = tail(stdout + chunk); });
    child.stderr.on("data", (chunk) => { stderr = tail(stderr + chunk); });
    child.on("error", (error) => resolve({ ok: false, exitCode: null, stdout, stderr, error: error.message }));
    child.on("close", (exitCode) => resolve({ ok: exitCode === 0, exitCode, stdout, stderr }));
    if (stdin) child.stdin.end(stdin);
  });
}

async function fileSha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function listFiles(root, prefix = "") {
  const files = [];
  for (const entry of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw stageError("VIBE64_PUBLISH_ARTIFACT_INVALID", `Artifact ${relative} is not a regular file.`);
  }
  return files;
}

// One digest names a whole artifact set: every file's path and checksum.
function artifactsDigest(manifest) {
  return sha256(manifest.files.map(({ path: file, sha256: checksum }) => `${checksum}  ${file}\n`).join(""));
}

function resultDirectory(resultStore, planHash, packageId) {
  const match = PLAN_HASH.exec(planHash || "");
  if (!match) throw stageError("VIBE64_PUBLISH_STAGE_INVALID", "A stage needs the plan hash.");
  if (!ID.test(packageId || "")) throw stageError("VIBE64_PUBLISH_STAGE_INVALID", "A stage needs a package id.");
  return path.join(absolute(resultStore, "Result store"), match[1], packageId);
}

async function readArtifacts(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest?.contract !== VIBE64_PUBLISH_ARTIFACTS_CONTRACT) {
    throw stageError("VIBE64_PUBLISH_ARTIFACT_INVALID", "The result store holds no Vibe64 artifact manifest.");
  }
  return { directory, manifest, digest: artifactsDigest(manifest) };
}

// Re-hashes the stored bytes so Stage 2 signs and uploads exactly what Stage 1 built.
async function verifyArtifacts(artifacts) {
  const filesRoot = path.join(artifacts.directory, "files");
  const present = await listFiles(filesRoot);
  const declared = artifacts.manifest.files.map(({ path: file }) => file);
  if (present.join("\n") !== declared.join("\n")) {
    throw stageError("VIBE64_PUBLISH_ARTIFACT_CHANGED", "The stored artifacts no longer match their manifest.");
  }
  for (const file of artifacts.manifest.files) {
    if (await fileSha256(path.join(filesRoot, file.path)) !== file.sha256) {
      throw stageError("VIBE64_PUBLISH_ARTIFACT_CHANGED", `Artifact ${file.path} changed after it was built.`);
    }
  }
  return artifacts;
}

async function runBuildStage({
  planHash,
  packageId,
  steps = [],
  outputs = [],
  environment = [],
  resultStore,
  allowedRoots = [],
  baseEnvironment = process.env,
  cacheDirectory = "",
  signal
} = {}, {
  runCommand = spawnCommand
} = {}) {
  const directory = resultDirectory(resultStore, planHash, packageId);
  // Resumable: a completed build for this plan and package is reused after verification.
  if (await stat(path.join(directory, "manifest.json")).catch(() => null)) {
    return { ...await verifyArtifacts(await readArtifacts(directory)), reused: true };
  }
  const roots = allowedRoots.map((root) => absolute(root, "Allowed root"));
  if (!roots.length) throw stageError("VIBE64_PUBLISH_STAGE_INVALID", "A build stage needs the roots it may run in.");
  const outputPaths = outputs.map((output) => absolute(output, "Build output"));
  if (!outputPaths.length) throw stageError("VIBE64_PUBLISH_STAGE_INVALID", "A build stage needs at least one output.");
  for (const candidate of [...outputPaths, ...steps.map((step) => absolute(step.cwd, "Build step directory"))]) {
    if (!roots.some((root) => within(root, candidate))) {
      throw stageError("VIBE64_PUBLISH_STAGE_INVALID", `${candidate} is outside the build's allowed roots.`);
    }
  }
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-build-home-"));
  const staging = `${directory}.partial-${randomUUID()}`;
  try {
    await mkdir(path.join(home, "tmp"), { recursive: true });
    const env = buildStageEnvironment({ baseEnvironment, declared: environment, home, cacheDirectory });
    for (const step of steps) {
      if (!Array.isArray(step.argv) || !step.argv.length || step.argv.some((value) => typeof value !== "string")) {
        throw stageError("VIBE64_PUBLISH_STAGE_INVALID", `Build step ${step.label} needs argv.`);
      }
      const result = await runCommand({ command: step.argv[0], args: step.argv.slice(1), cwd: step.cwd, env, signal });
      if (result?.ok !== true) {
        throw stageError("VIBE64_PUBLISH_BUILD_FAILED", `${step.label} failed${result?.exitCode == null ? "" : ` with exit code ${result.exitCode}`}.`, {
          step: step.label,
          output: tail(`${result?.stdout || ""}${result?.stderr || ""}${result?.error || ""}`)
        });
      }
    }
    const filesRoot = path.join(staging, "files");
    await mkdir(filesRoot, { recursive: true });
    for (const output of outputPaths) {
      const details = await stat(output).catch(() => null);
      if (!details) throw stageError("VIBE64_PUBLISH_BUILD_FAILED", `The build did not produce ${path.basename(output)}.`);
      await cp(output, path.join(filesRoot, path.basename(output)), { recursive: true, errorOnExist: true, force: false });
    }
    const files = [];
    for (const file of await listFiles(filesRoot)) {
      const absoluteFile = path.join(filesRoot, file);
      files.push({ path: file, size: (await stat(absoluteFile)).size, sha256: await fileSha256(absoluteFile) });
      await chmod(absoluteFile, 0o444);
    }
    const manifest = { contract: VIBE64_PUBLISH_ARTIFACTS_CONTRACT, planHash, package: packageId, files };
    await writeFile(path.join(staging, "manifest.json"), canonicalJson(manifest), { mode: 0o444 });
    await mkdir(path.dirname(directory), { recursive: true });
    await rename(staging, directory);
    return { directory, manifest, digest: artifactsDigest(manifest), reused: false };
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

// Credentials exist only for the duration of one Stage 2 operation: files are 0600
// in a private 0700 directory, stdin values are buffers, and both are removed or
// zeroed whatever happens.
async function withStageCredentials({ credentials = [], obtainCredential, tempRoot = os.tmpdir() } = {}, operation) {
  if (typeof operation !== "function") throw new TypeError("withStageCredentials requires an operation.");
  if (credentials.length && typeof obtainCredential !== "function") {
    throw stageError("VIBE64_PUBLISH_CREDENTIAL_MISSING", "This destination needs credentials and none were supplied.");
  }
  const directory = await mkdtemp(path.join(absolute(tempRoot, "Credential temp root"), "vibe64-credentials-"));
  const buffers = [];
  try {
    await chmod(directory, 0o700);
    const files = {};
    const stdin = {};
    for (const spec of credentials) {
      if (!ID.test(spec?.id || "") || !["file", "stdin"].includes(spec.delivery)) {
        throw stageError("VIBE64_PUBLISH_STAGE_INVALID", "Credential specs need an id and a file or stdin delivery.");
      }
      const value = await obtainCredential(spec);
      if (typeof value !== "string" && !Buffer.isBuffer(value)) {
        throw stageError("VIBE64_PUBLISH_CREDENTIAL_MISSING", `${spec.label || spec.id} is not available.`);
      }
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
      buffers.push(buffer);
      if (spec.delivery === "file") {
        files[spec.id] = path.join(directory, spec.id);
        await writeFile(files[spec.id], buffer, { mode: 0o600, flag: "wx" });
      } else {
        stdin[spec.id] = buffer;
      }
    }
    return await operation({ files, stdin });
  } finally {
    for (const buffer of buffers) buffer.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
}

function expectedChecksum(destination, artifacts) {
  return typeof destination.expectedChecksum === "function" ? destination.expectedChecksum(artifacts) : artifacts.digest;
}

// A destination's credential specs may depend on the target (for example a
// private package that needs a sign-in even to be read back).
function credentialSpecs(destination, field, target) {
  const specs = typeof destination[field] === "function" ? destination[field](target) : destination[field];
  return Array.isArray(specs) ? specs : [];
}

// Stage 3 alone: what the destination reports for this target and version. A
// destination that cannot read without signing in declares readBackCredentials.
async function readBackTarget({ destination, target, version, artifacts, obtainCredential, tempRoot }) {
  const credentials = credentialSpecs(destination, "readBackCredentials", target);
  const result = credentials.length
    ? await withStageCredentials({ credentials, obtainCredential, tempRoot }, (supplied) => destination.readBack({ target, version, artifacts, credentials: supplied }))
    : await destination.readBack({ target, version, artifacts });
  if (!result || typeof result.published !== "boolean") {
    throw stageError("VIBE64_PUBLISH_READ_BACK_INVALID", `${destination.label} returned no read-back result.`);
  }
  const expected = expectedChecksum(destination, artifacts);
  if (result.published && result.checksum !== expected) {
    throw stageError(
      "VIBE64_PUBLISH_VERSION_CONFLICT",
      `${destination.label} already has ${version} with different contents. Publish a new version instead.`,
      { target: target.id, version, published: result.checksum || null, expected }
    );
  }
  return { ...result, expected };
}

// Stage 2 + 3 for one target, resumable and idempotent: the same version and
// checksum already published is success; a different checksum is an error.
async function publishTarget({
  destination,
  target,
  version,
  artifacts,
  previous = null,
  obtainCredential,
  tempRoot,
  now = () => new Date().toISOString()
} = {}) {
  const startedAt = now();
  await verifyArtifacts(artifacts);
  const checksum = expectedChecksum(destination, artifacts);
  if (previous?.status === "proven" && previous.version === version && previous.checksum === checksum) return previous;
  const before = await readBackTarget({ destination, target, version, artifacts, obtainCredential, tempRoot });
  if (before.published) {
    return { target: target.id, version, checksum, status: "proven", alreadyPublished: true, proof: before.proof || null, startedAt, finishedAt: now() };
  }
  const upload = await withStageCredentials({
    credentials: credentialSpecs(destination, "credentials", target),
    obtainCredential,
    tempRoot
  }, (credentials) => destination.upload({ target, version, artifacts, credentials }));
  const after = await readBackTarget({ destination, target, version, artifacts, obtainCredential, tempRoot });
  if (!after.published) {
    throw stageError("VIBE64_PUBLISH_NOT_PROVEN", `${destination.label} accepted the upload but does not show ${version} yet.`, {
      target: target.id,
      version,
      upload: upload ?? null
    });
  }
  return { target: target.id, version, checksum, status: "proven", alreadyPublished: false, proof: after.proof || null, startedAt, finishedAt: now() };
}

export {
  BUILD_ENVIRONMENT_PASSTHROUGH,
  VIBE64_PUBLISH_ARTIFACTS_CONTRACT,
  artifactsDigest,
  buildStageEnvironment,
  publishTarget,
  readArtifacts,
  readBackTarget,
  runBuildStage,
  spawnCommand,
  verifyArtifacts,
  withStageCredentials
};
