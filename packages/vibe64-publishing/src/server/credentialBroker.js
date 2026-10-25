// Connects targets to the person's publishing keys. Publishing accounts (npm,
// PyPI and GitHub sign-ins) and per-app signing keys live in the age key store;
// Stage 2 receives a value only for one operation, as a private temporary file
// the shared stage code removes. No value is ever returned to a caller here
// except into that stage.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ANDROID_SIDELOAD_KEYSTORE, ANDROID_SIDELOAD_KEY_PASSWORD } from "@local/vibe64-packaging/server";

const run = promisify(execFile);
const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const ACCOUNT_KINDS = Object.freeze(["npm", "pypi", "github"]);
const PROOF_FIELDS = Object.freeze([
  "integrity", "channelVersion", "registry", "url", "release", "repository", "tag", "channel", "immutable", "assets",
  "project", "files", "fileName", "sha256", "size", "certificateSha256", "applicationId", "versionName", "versionCode", "page", "index"
]);

function brokerError(message, code = "vibe64_publishing_account_invalid") {
  return Object.assign(new Error(message), { code });
}

function accountEntryId(accountId) {
  return `account:${accountId}`;
}

function sideloadKeyEntryId(target) {
  return `android-sideload:${target.package}`;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 40);
}

function plainProof(proof) {
  if (!proof || typeof proof !== "object") return null;
  const result = {};
  for (const field of PROOF_FIELDS) {
    if (proof[field] === undefined) continue;
    result[field] = JSON.parse(JSON.stringify(proof[field]));
  }
  return result;
}

function createCredentialBroker({ keys, packaging, now = () => new Date().toISOString(), ghCommand = "gh" } = {}) {
  async function accounts() {
    const status = await keys.status();
    return status.entries.filter((entry) => entry.kind === "account").map((entry) => ({
      id: entry.id.slice("account:".length),
      kind: entry.accountKind,
      label: entry.label,
      address: entry.address || "",
      source: entry.source || "token",
      createdAt: entry.createdAt
    }));
  }

  async function addAccount({ kind, label, address = "", token, source = "token" } = {}) {
    if (!ACCOUNT_KINDS.includes(kind)) throw brokerError("Choose npm, PyPI or GitHub.");
    let value = typeof token === "string" ? token.trim() : "";
    if (source === "github-cli") {
      if (kind !== "github") throw brokerError("Only a GitHub account can come from the GitHub CLI.");
      value = await githubCliToken();
    }
    if (!/^[\x21-\x7e]{8,4096}$/u.test(value)) throw brokerError("Paste the whole token: it is one word of at least 8 characters.");
    const id = slug(`${kind}-${label || address || kind}`) || kind;
    if (!ACCOUNT_ID.test(id)) throw brokerError("Give the account a short name.");
    const entry = await keys.put(accountEntryId(id), {
      value,
      kind: "account",
      label: String(label || `${kind} account`).trim().slice(0, 80),
      meta: { accountKind: kind, address: String(address || "").trim().slice(0, 300), source: source === "github-cli" ? "github-cli" : "token" }
    });
    value = "";
    return { id, kind, label: entry.label, address: entry.address || "", source: entry.source, createdAt: entry.createdAt };
  }

  async function removeAccount(id) {
    if (!ACCOUNT_ID.test(id || "")) throw brokerError("That is not an account.");
    await keys.remove(accountEntryId(id));
    return { removed: id };
  }

  // The token of the person's own `gh` sign-in, copied once into their keys.
  async function githubCliToken() {
    try {
      const { stdout } = await run(ghCommand, ["auth", "token"], { timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
      return stdout.trim();
    } catch {
      throw brokerError("The GitHub CLI is not signed in on this computer. Run gh auth login, or paste a token.", "vibe64_publishing_github_cli_missing");
    }
  }

  // obtainCredential for one target: the account's token in the shape its
  // destination expects, or the app's install key.
  function obtainFor(target) {
    return async (spec) => {
      if (spec.id === ANDROID_SIDELOAD_KEYSTORE.id || spec.id === ANDROID_SIDELOAD_KEY_PASSWORD.id) {
        const stored = JSON.parse(keys.read(sideloadKeyEntryId(target)).toString("utf8"));
        return spec.id === ANDROID_SIDELOAD_KEYSTORE.id ? Buffer.from(stored.keystore, "base64") : stored.password;
      }
      if (!target.account) throw brokerError(`Choose a publishing account for ${target.id}.`, "vibe64_publishing_account_missing");
      const token = keys.read(accountEntryId(target.account)).toString("utf8");
      if (spec.id === "npm-userconfig") return packaging.npmTokenUserconfig({ registry: target.settings?.registry || undefined, token });
      return token;
    };
  }

  async function facts({ targets = [], toolchains = {} } = {}) {
    const result = {};
    for (const target of targets) {
      Object.assign(result, await packaging.gatherCredentialFacts({ targets: [target], obtainCredential: obtainFor(target), toolchains }));
    }
    return result;
  }

  async function dryRun({ target, version, artifacts, toolchains = {} }) {
    const destination = packaging.vibe64Destination(target.destination);
    return packaging.withStageCredentials({ credentials: packaging.credentialSpecs(destination, "credentials", target), obtainCredential: obtainFor(target) },
      (credentials) => destination.dryRun({ target, version, artifacts, credentials, toolchains }));
  }

  async function publish({ target, version, artifacts, previous = null, toolchains = {} }) {
    return packaging.publishTarget({
      destination: packaging.vibe64Destination(target.destination),
      target,
      version,
      artifacts,
      previous: previous?.status === "proven" ? previous : null,
      obtainCredential: obtainFor(target),
      toolchains,
      now
    });
  }

  // Creates the app's install key straight into the person's keys.
  async function createSideloadKey({ target, appName, javaHome }) {
    const entryId = sideloadKeyEntryId(target);
    if (keys.has(entryId)) throw brokerError(`${target.package} already has an install key.`, "vibe64_publishing_key_exists");
    return packaging.generateSideloadKey({
      javaHome,
      commonName: appName || target.package,
      sink: async ({ keystore, password, certificateSha256 }) => {
        const value = Buffer.from(JSON.stringify({ keystore: keystore.toString("base64"), password: password.toString("utf8") }), "utf8");
        try {
          await keys.put(entryId, { value, kind: "android-sideload-key", label: `Install key for ${appName || target.package}`, meta: { certificateSha256, package: target.package } });
        } finally {
          value.fill(0);
        }
      }
    });
  }

  // What a dry run reports, without local paths or anything credential-like.
  function safeReport(report = {}) {
    const keep = ["destination", "alreadyPublished", "previousVersion", "diff", "integrity", "repository", "tag", "tagPushed", "channel", "releaseExists", "project", "version", "index", "check"];
    const result = {};
    for (const field of keep) if (report?.[field] !== undefined) result[field] = JSON.parse(JSON.stringify(report[field]));
    if (Array.isArray(report?.files)) {
      result.files = report.files.slice(0, 200).map((file) => ({
        ...(file.path ? { path: String(file.path) } : {}),
        ...(file.name ? { name: file.name } : {}),
        ...(Number.isFinite(file.size) ? { size: file.size } : {}),
        ...(file.sha256 ? { sha256: file.sha256 } : {}),
        ...(file.alreadyAttached !== undefined ? { alreadyAttached: file.alreadyAttached } : {})
      }));
    }
    return result;
  }

  function safeOutcome(outcome = {}) {
    return {
      status: outcome.status,
      version: outcome.version,
      checksum: outcome.checksum,
      alreadyPublished: Boolean(outcome.alreadyPublished),
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      proof: plainProof(outcome.proof),
      // The signed APK's place in the result store, for downloads; never shown.
      ...(outcome.proof?.file || outcome.localFile ? { localFile: outcome.proof?.file || outcome.localFile } : {})
    };
  }

  return Object.freeze({ accounts, addAccount, createSideloadKey, dryRun, facts, obtainFor, publish, removeAccount, safeOutcome, safeReport });
}

export { accountEntryId, createCredentialBroker, sideloadKeyEntryId };
