import { randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  isMissingPathError,
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  assertValidCustomHostname,
  assertValidPublicName,
  domainVerificationRecord,
  normalizeHostname,
  normalizePublicName,
  publicNameFromHost,
  publicHostForName,
  validateCustomHostname,
  validatePublicName
} from "./publicNames.js";

const DEPLOYMENT_SCHEMA_VERSION = 1;
const DEPLOYMENTS_DIR = "deployments";
const DOMAIN_BINDINGS_DIR = "domain-bindings";
const RELEASES_DIR = "releases";
const RELEASE_MANIFEST_FILE = "manifest.json";
const GLOBAL_REGISTRY_DIR = "deployment-registry";
const PUBLIC_NAME_REGISTRY_DIR = "public-names";
const CUSTOM_DOMAIN_REGISTRY_DIR = "custom-domains";
const REGISTRY_LOCK_DIR = "registry.lock";
const REGISTRY_LOCK_RETRY_MS = 25;
const REGISTRY_LOCK_STALE_MS = 30000;
const REGISTRY_LOCK_TIMEOUT_MS = 5000;

function createDeploymentStore({
  clock = () => new Date(),
  resolveTxtRecords = resolveTxt
} = {}) {
  function nowIso() {
    return toDate(clock()).toISOString();
  }

  async function readState(context = {}) {
    const paths = deploymentPaths(context);
    const publicNameRecord = await readOptionalJson(paths.publicNamePath);
    const currentRelease = await readOptionalJson(paths.currentReleasePath);
    const domains = await listLocalDomainBindings(paths.localDomainBindingsRoot);
    const releases = await listReleaseManifests(paths.releasesRoot);
    return {
      currentRelease: currentRelease || null,
      domains,
      ok: true,
      project: projectRecord(context),
      publicName: publicNameRecord || null,
      publicUrl: publicNameRecord?.publicHost ? `https://${publicNameRecord.publicHost}` : "",
      releases,
      stateRoot: paths.projectDeploymentsRoot
    };
  }

  async function beginRelease(context = {}, {
    publishPlan = {}
  } = {}) {
    const paths = deploymentPaths(context);
    const publicName = await requireLocalPublicName(paths.publicNamePath);
    const currentRelease = await readOptionalJson(paths.currentReleasePath);
    const releaseId = releaseIdForDate(nowIso());
    const manifest = releaseManifest({
      context,
      currentRelease,
      now: nowIso(),
      publicName,
      publishPlan,
      releaseId,
      status: "publishing"
    });
    await writeReleaseManifest(paths, manifest);
    return {
      logsRoot: releaseLogsRoot(paths, releaseId),
      manifest,
      releaseRoot: releaseRoot(paths, releaseId)
    };
  }

  async function failRelease(context = {}, releaseId = "", {
    error = "",
    phases = []
  } = {}) {
    return updateRelease(context, releaseId, {
      error: String(error || "Deployment failed."),
      finishedAt: nowIso(),
      phases,
      status: "failed"
    });
  }

  async function listReleases(context = {}) {
    const paths = deploymentPaths(context);
    return {
      ok: true,
      releases: await listReleaseManifests(paths.releasesRoot)
    };
  }

  async function publishRelease(context = {}, releaseId = "", {
    container = {},
    health = {},
    phases = []
  } = {}) {
    const manifest = await updateRelease(context, releaseId, {
      container,
      finishedAt: nowIso(),
      health,
      phases,
      status: "published"
    });
    await writeJsonFile(deploymentPaths(context).currentReleasePath, manifest);
    return manifest;
  }

  async function rollbackRelease(context = {}, {
    releaseId = ""
  } = {}) {
    const paths = deploymentPaths(context);
    const manifest = await readReleaseManifest(paths, releaseId);
    if (!manifest || manifest.status !== "published") {
      throw vibe64Error(
        "Only a published release can be used for rollback.",
        "vibe64_deployment_release_not_publishable"
      );
    }
    const current = {
      ...manifest,
      rolledBackAt: nowIso()
    };
    await writeJsonFile(paths.currentReleasePath, current);
    return readState(context);
  }

  async function updateRelease(context = {}, releaseId = "", patch = {}) {
    const paths = deploymentPaths(context);
    const manifest = await readReleaseManifest(paths, releaseId);
    if (!manifest) {
      throw vibe64Error("Deployment release not found.", "vibe64_deployment_release_not_found");
    }
    const nextManifest = {
      ...manifest,
      ...patch,
      updatedAt: nowIso()
    };
    await writeReleaseManifest(paths, nextManifest);
    return nextManifest;
  }

  async function writeReleaseLog(context = {}, releaseId = "", logName = "", text = "") {
    const paths = deploymentPaths(context);
    const logPath = releaseLogPath(paths, releaseId, logName);
    await writeFileEnsured(logPath, `${String(text || "").replace(/\s+$/u, "")}\n`);
    return logPath;
  }

  async function validatePublicNameAvailability(context = {}, input = {}) {
    const publicName = normalizePublicName(input?.publicName);
    const validation = validatePublicName(publicName);
    if (!validation.ok) {
      return {
        ...validation,
        available: false
      };
    }
    const paths = deploymentPaths(context);
    const registryRecord = await readOptionalJson(publicNameRegistryPath(paths.systemRoot, validation.publicName));
    const ownerIsCurrentProject = registryRecord ? registryOwnerMatches(registryRecord, context) : false;
    const available = !registryRecord || ownerIsCurrentProject;
    return {
      available,
      code: available ? "" : "vibe64_public_name_unavailable",
      message: available
        ? "Public name is available."
        : "That public name is already attached to another Vibe64 project.",
      ok: true,
      publicHost: validation.publicHost,
      publicName: validation.publicName,
      reservedByCurrentProject: ownerIsCurrentProject
    };
  }

  async function reservePublicName(context = {}, input = {}) {
    const publicName = assertValidPublicName(input?.publicName);
    const paths = deploymentPaths(context);
    await assertNoDifferentLocalPublicName(paths.publicNamePath, publicName);

    return withRegistryLock(paths.systemRoot, async () => {
      const registryPath = publicNameRegistryPath(paths.systemRoot, publicName);
      const existingRegistryRecord = await readOptionalJson(registryPath);
      if (existingRegistryRecord && !registryOwnerMatches(existingRegistryRecord, context)) {
        throw vibe64Error(
          "That public name is already attached to another Vibe64 project.",
          "vibe64_public_name_unavailable"
        );
      }

      const existingLocalRecord = await readOptionalJson(paths.publicNamePath);
      const record = publicNameRecord({
        context,
        existing: existingLocalRecord || existingRegistryRecord || null,
        now: nowIso(),
        publicName
      });
      await writeJsonFile(registryPath, registryRecord(record, context));
      await writeJsonFile(paths.publicNamePath, record);
      return readState(context);
    });
  }

  async function listDomainBindings(context = {}) {
    const paths = deploymentPaths(context);
    return {
      domains: await listLocalDomainBindings(paths.localDomainBindingsRoot),
      ok: true
    };
  }

  async function addCustomDomain(context = {}, input = {}) {
    const hostname = assertValidCustomHostname(input?.hostname);
    const paths = deploymentPaths(context);
    const publicNameRecordValue = await readOptionalJson(paths.publicNamePath);
    if (!publicNameRecordValue?.publicName) {
      throw vibe64Error(
        "Reserve a public Vibe64 URL before adding custom domains.",
        "vibe64_public_name_required"
      );
    }

    return withRegistryLock(paths.systemRoot, async () => {
      const globalDomainPath = customDomainRegistryPath(paths.systemRoot, hostname);
      const existingGlobalDomain = await readOptionalJson(globalDomainPath);
      if (existingGlobalDomain && !registryOwnerMatches(existingGlobalDomain, context)) {
        throw vibe64Error(
          "That custom domain is already attached to another Vibe64 project.",
          "vibe64_custom_domain_unavailable"
        );
      }

      const localDomainPath = domainBindingPath(paths.localDomainBindingsRoot, hostname);
      const existingLocalDomain = await readOptionalJson(localDomainPath);
      const record = domainBindingRecord({
        context,
        existing: existingLocalDomain || existingGlobalDomain || null,
        hostname,
        now: nowIso(),
        publicName: publicNameRecordValue.publicName
      });
      await writeJsonFile(globalDomainPath, registryRecord(record, context));
      await writeJsonFile(localDomainPath, record);
      return {
        domain: record,
        ok: true
      };
    });
  }

  async function verifyCustomDomain(context = {}, input = {}) {
    const hostname = assertValidCustomHostname(input?.hostname);
    const paths = deploymentPaths(context);
    const localDomainPath = domainBindingPath(paths.localDomainBindingsRoot, hostname);
    const localDomain = await readOptionalJson(localDomainPath);
    if (!localDomain?.hostname) {
      throw vibe64Error("Custom domain binding not found.", "vibe64_custom_domain_not_found");
    }

    const requiredRecord = localDomain.requiredDnsRecords?.[0] || null;
    const observedDnsRecords = requiredRecord
      ? await readTxtValues(resolveTxtRecords, requiredRecord.host)
      : [];
    const verified = Boolean(requiredRecord && observedDnsRecords.includes(requiredRecord.value));
    const verifiedAt = verified ? nowIso() : String(localDomain.lastVerifiedAt || "");
    const record = {
      ...localDomain,
      certificateStatus: verified ? "ready_for_on_demand" : "not_requested",
      lastVerifiedAt: verifiedAt,
      observedDnsRecords,
      updatedAt: nowIso(),
      verificationStatus: verified ? "verified" : "pending"
    };

    await withRegistryLock(paths.systemRoot, async () => {
      const globalDomainPath = customDomainRegistryPath(paths.systemRoot, hostname);
      const globalDomain = await readOptionalJson(globalDomainPath);
      if (globalDomain && !registryOwnerMatches(globalDomain, context)) {
        throw vibe64Error(
          "That custom domain is already attached to another Vibe64 project.",
          "vibe64_custom_domain_unavailable"
        );
      }
      await writeJsonFile(globalDomainPath, registryRecord(record, context));
      await writeJsonFile(localDomainPath, record);
    });

    return {
      ...(verified ? {} : ingressDenied(
        "DNS TXT verification record was not found yet.",
        "vibe64_custom_domain_verification_pending",
        hostname
      )),
      domain: record,
      ok: verified,
      verified
    };
  }

  async function tlsAsk(context = {}, input = {}) {
    const route = await resolveHostRoute(context, {
      host: input?.domain || input?.host || input?.hostname
    });
    if (!route.ok) {
      return {
        ...route,
        certificateAllowed: false,
        ok: false
      };
    }
    return {
      certificateAllowed: true,
      domain: route.host,
      host: route.host,
      ok: true,
      project: route.project,
      publicHost: route.publicHost,
      publicName: route.publicName,
      releaseId: route.release.releaseId,
      routeKind: route.routeKind
    };
  }

  async function resolveHostRoute(context = {}, input = {}) {
    const host = normalizeHostname(input?.host || input?.domain || input?.hostname);
    if (!host) {
      return ingressDenied("Enter a hostname to route.", "vibe64_deployment_host_required", host);
    }

    const systemRoot = requiredText(context.systemRoot, "systemRoot");
    const binding = await readHostBinding(systemRoot, host);
    if (!binding) {
      return ingressDenied("Hostname is not attached to a Vibe64 deployment.", "vibe64_deployment_host_not_found", host);
    }
    if (binding.requiresVerification && binding.record.verificationStatus !== "verified") {
      return ingressDenied("Custom domain has not been verified yet.", "vibe64_custom_domain_not_verified", host);
    }

    const currentRelease = await readCurrentReleaseForRegistryRecord(binding.record);
    if (!currentRelease || currentRelease.status !== "published") {
      return ingressDenied("Hostname has no published release.", "vibe64_deployment_release_not_published", host);
    }
    if (!currentRelease.container?.internalBaseUrl) {
      return ingressDenied("Published release has no internal route target.", "vibe64_deployment_route_target_missing", host);
    }

    return {
      host,
      ok: true,
      project: binding.record.project,
      publicHost: binding.record.publicHost,
      publicName: binding.record.publicName,
      release: {
        containerId: String(currentRelease.container?.containerId || ""),
        releaseId: currentRelease.releaseId,
        status: currentRelease.status
      },
      routeKind: binding.routeKind,
      target: {
        internalBaseUrl: currentRelease.container.internalBaseUrl,
        internalHealthUrl: String(currentRelease.container?.internalHealthUrl || "")
      }
    };
  }

  return Object.freeze({
    addCustomDomain,
    beginRelease,
    failRelease,
    listDomainBindings,
    listReleases,
    publishRelease,
    readState,
    resolveHostRoute,
    rollbackRelease,
    reservePublicName,
    tlsAsk,
    updateRelease,
    verifyCustomDomain,
    validatePublicNameAvailability,
    writeReleaseLog
  });
}

function deploymentPaths(context = {}) {
  const projectLocalRoot = requiredText(context.projectLocalRoot, "projectLocalRoot");
  const systemRoot = requiredText(context.systemRoot, "systemRoot");
  const projectDeploymentsRoot = path.join(projectLocalRoot, DEPLOYMENTS_DIR);
  const localDomainBindingsRoot = path.join(projectDeploymentsRoot, DOMAIN_BINDINGS_DIR);
  const releasesRoot = path.join(projectDeploymentsRoot, RELEASES_DIR);
  return {
    currentReleasePath: path.join(projectDeploymentsRoot, "current.json"),
    localDomainBindingsRoot,
    projectDeploymentsRoot,
    publicNamePath: path.join(projectDeploymentsRoot, "public-name.json"),
    releasesRoot,
    systemRoot
  };
}

function projectRecord(context = {}) {
  return {
    projectKey: projectKey(context),
    projectLocalRoot: requiredText(context.projectLocalRoot, "projectLocalRoot"),
    projectRoot: requiredText(context.targetRoot, "targetRoot"),
    slug: requiredText(context.projectSlug, "projectSlug")
  };
}

function projectKey(context = {}) {
  return `${requiredText(context.projectSlug, "projectSlug")}:${path.resolve(requiredText(context.targetRoot, "targetRoot"))}`;
}

function publicNameRecord({
  context = {},
  existing = null,
  now = "",
  publicName = ""
} = {}) {
  const normalizedPublicName = assertValidPublicName(publicName);
  return {
    createdAt: existing?.createdAt || now,
    project: projectRecord(context),
    publicHost: publicHostForName(normalizedPublicName),
    publicName: normalizedPublicName,
    schema: "vibe64.deployment.public_name.v1",
    schemaVersion: DEPLOYMENT_SCHEMA_VERSION,
    updatedAt: now
  };
}

function domainBindingRecord({
  context = {},
  existing = null,
  hostname = "",
  now = "",
  publicName = ""
} = {}) {
  const normalizedHostname = normalizeHostname(hostname);
  return {
    activeReleaseId: String(existing?.activeReleaseId || ""),
    certificateStatus: String(existing?.certificateStatus || "not_requested"),
    createdAt: existing?.createdAt || now,
    hostname: normalizedHostname,
    lastRoutingHealthCheckAt: String(existing?.lastRoutingHealthCheckAt || ""),
    lastVerifiedAt: String(existing?.lastVerifiedAt || ""),
    observedDnsRecords: Array.isArray(existing?.observedDnsRecords) ? existing.observedDnsRecords : [],
    project: projectRecord(context),
    publicHost: publicHostForName(publicName),
    publicName: assertValidPublicName(publicName),
    requiredDnsRecords: [
      domainVerificationRecord({
        hostname: normalizedHostname,
        projectSlug: context.projectSlug,
        publicName
      })
    ],
    schema: "vibe64.deployment.custom_domain.v1",
    schemaVersion: DEPLOYMENT_SCHEMA_VERSION,
    updatedAt: now,
    verificationStatus: String(existing?.verificationStatus || "pending")
  };
}

function registryRecord(record = {}, context = {}) {
  return {
    ...record,
    project: projectRecord(context)
  };
}

function registryOwnerMatches(record = {}, context = {}) {
  return String(record?.project?.projectKey || "") === projectKey(context);
}

async function readHostBinding(systemRoot = "", host = "") {
  const publicName = publicNameFromHost(host);
  if (publicName && validatePublicName(publicName).ok) {
    const record = await readOptionalJson(publicNameRegistryPath(systemRoot, publicName));
    return record
      ? {
          record,
          requiresVerification: false,
          routeKind: "public-name"
        }
      : null;
  }

  if (!validateCustomHostname(host).ok) {
    return null;
  }
  const record = await readOptionalJson(customDomainRegistryPath(systemRoot, host));
  return record
    ? {
        record,
        requiresVerification: true,
        routeKind: "custom-domain"
      }
    : null;
}

async function readCurrentReleaseForRegistryRecord(record = {}) {
  const projectRoot = String(record?.project?.projectRoot || "").trim();
  if (!projectRoot) {
    return null;
  }
  const projectLocalRoot = String(record?.project?.projectLocalRoot || "").trim() ||
    path.join(projectRoot, ".vibe64-local");
  return readOptionalJson(path.join(projectLocalRoot, DEPLOYMENTS_DIR, "current.json"));
}

function ingressDenied(message = "", code = "vibe64_deployment_host_not_allowed", host = "") {
  return {
    allowed: false,
    code,
    errors: [
      {
        code,
        message
      }
    ],
    host,
    message,
    ok: false
  };
}

async function requireLocalPublicName(publicNamePath = "") {
  const publicName = await readOptionalJson(publicNamePath);
  if (!publicName?.publicName) {
    throw vibe64Error(
      "Reserve a public Vibe64 URL before publishing.",
      "vibe64_public_name_required"
    );
  }
  return publicName;
}

function releaseIdForDate(value = "") {
  const date = toDate(value);
  const stamp = date.toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/[-:]/gu, "")
    .replace("T", "_")
    .toLowerCase();
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function releaseRoot(paths = {}, releaseId = "") {
  return path.join(paths.releasesRoot, requiredText(releaseId, "releaseId"));
}

function releaseLogsRoot(paths = {}, releaseId = "") {
  return path.join(releaseRoot(paths, releaseId), "logs");
}

function releaseManifestPath(paths = {}, releaseId = "") {
  return path.join(releaseRoot(paths, releaseId), RELEASE_MANIFEST_FILE);
}

function releaseLogPath(paths = {}, releaseId = "", logName = "") {
  const safeLogName = String(logName || "").trim().replace(/[^a-z0-9_.-]+/giu, "-").replace(/^-+|-+$/gu, "");
  return path.join(releaseLogsRoot(paths, releaseId), `${safeLogName || "release"}.log`);
}

function releaseManifest({
  context = {},
  currentRelease = null,
  now = "",
  publicName = {},
  publishPlan = {},
  releaseId = "",
  status = "publishing"
} = {}) {
  return {
    adapterId: String(publishPlan.adapterId || ""),
    artifact: publishPlan.artifacts || null,
    build: publishPlan.build || null,
    container: null,
    createdAt: now,
    error: "",
    finishedAt: "",
    health: null,
    logs: {
      docker: {
        driver: "json-file",
        maxFile: "5",
        maxSize: "10m"
      },
      phases: "logs/"
    },
    migrate: publishPlan.migrate || null,
    phases: [],
    previousReleaseId: String(currentRelease?.releaseId || ""),
    project: projectRecord(context),
    publicHost: publicName.publicHost,
    publicName: publicName.publicName,
    releaseId,
    schema: "vibe64.deployment.release.v1",
    schemaVersion: DEPLOYMENT_SCHEMA_VERSION,
    serve: publishPlan.serve || null,
    status,
    updatedAt: now
  };
}

async function listReleaseManifests(root = "") {
  try {
    const entries = await readdir(root, {
      withFileTypes: true
    });
    const releases = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name))
      .map((entry) => readOptionalJson(path.join(root, entry.name, RELEASE_MANIFEST_FILE))));
    return releases.filter(Boolean);
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function readReleaseManifest(paths = {}, releaseId = "") {
  return readOptionalJson(releaseManifestPath(paths, releaseId));
}

async function writeReleaseManifest(paths = {}, manifest = {}) {
  await writeJsonFile(releaseManifestPath(paths, manifest.releaseId), manifest);
}

async function assertNoDifferentLocalPublicName(publicNamePath = "", publicName = "") {
  const existing = await readOptionalJson(publicNamePath);
  if (existing?.publicName && existing.publicName !== publicName) {
    throw vibe64Error(
      `This project is already attached to ${existing.publicName}. Rename support will be added as an explicit publishing action.`,
      "vibe64_public_name_already_configured"
    );
  }
}

async function listLocalDomainBindings(root = "") {
  try {
    const entries = await readdir(root, {
      withFileTypes: true
    });
    const domains = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => readOptionalJson(path.join(root, entry.name))));
    return domains.filter(Boolean);
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function withRegistryLock(systemRoot = "", operation) {
  const lockDir = path.join(requiredText(systemRoot, "systemRoot"), GLOBAL_REGISTRY_DIR, REGISTRY_LOCK_DIR);
  await mkdir(path.dirname(lockDir), {
    recursive: true
  });
  await acquireRegistryLock(lockDir);
  try {
    return await operation();
  } finally {
    await rm(lockDir, {
      force: true,
      recursive: true
    });
  }
}

async function acquireRegistryLock(lockDir = "") {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      await writeJsonFile(path.join(lockDir, "owner.json"), {
        createdAt: new Date().toISOString(),
        pid: process.pid
      });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await registryLockIsStale(lockDir)) {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
        continue;
      }
      if (Date.now() - startedAt > REGISTRY_LOCK_TIMEOUT_MS) {
        throw vibe64Error(
          "Timed out waiting for the Vibe64 deployment registry lock.",
          "vibe64_deployment_registry_busy"
        );
      }
      await sleep(REGISTRY_LOCK_RETRY_MS);
    }
  }
}

async function registryLockIsStale(lockDir = "") {
  const owner = await readOptionalJson(path.join(lockDir, "owner.json"));
  if (!owner?.createdAt) {
    try {
      const info = await stat(lockDir);
      return Date.now() - info.mtimeMs > REGISTRY_LOCK_STALE_MS;
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
  }
  const createdAtMs = Date.parse(owner.createdAt);
  return !Number.isFinite(createdAtMs) || Date.now() - createdAtMs > REGISTRY_LOCK_STALE_MS;
}

function publicNameRegistryPath(systemRoot = "", publicName = "") {
  return path.join(
    requiredText(systemRoot, "systemRoot"),
    GLOBAL_REGISTRY_DIR,
    PUBLIC_NAME_REGISTRY_DIR,
    `${assertValidPublicName(publicName)}.json`
  );
}

function customDomainRegistryPath(systemRoot = "", hostname = "") {
  const normalizedHostname = assertValidCustomHostname(hostname);
  return path.join(
    requiredText(systemRoot, "systemRoot"),
    GLOBAL_REGISTRY_DIR,
    CUSTOM_DOMAIN_REGISTRY_DIR,
    `${normalizedHostname}.json`
  );
}

function domainBindingPath(root = "", hostname = "") {
  return path.join(requiredText(root, "localDomainBindingsRoot"), `${assertValidCustomHostname(hostname)}.json`);
}

async function readOptionalJson(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function readTxtValues(resolveTxtRecords, hostname = "") {
  try {
    const records = await resolveTxtRecords(hostname);
    return records.flat().map((value) => String(value || "").trim()).filter(Boolean);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ETIMEOUT", "ESERVFAIL"].includes(error?.code)) {
      return [];
    }
    throw error;
  }
}

async function writeJsonFile(filePath = "", value = {}) {
  await writeFileEnsured(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileEnsured(filePath = "", text = "") {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, text, "utf8");
  await rename(tempPath, filePath);
}

function requiredText(value = "", label = "value") {
  const text = String(value || "").trim();
  if (!text) {
    throw vibe64Error(`Deployment store requires ${label}.`, "vibe64_deployment_context_missing");
  }
  return text;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export {
  createDeploymentStore
};
