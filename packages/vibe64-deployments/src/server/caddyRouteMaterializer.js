import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  assertValidCustomHostname,
  assertValidPublicName,
  normalizeHostname
} from "./publicNames.js";
import {
  writeTextFileAtomic
} from "./deploymentFiles.js";

const CADDY_ROOT_DIR = "caddy";
const CADDY_SITES_DIR = "sites";
const CADDY_SNIPPETS_DIR = "snippets";
const CADDY_PUBLISHED_APP_SNIPPET = "vibe64_published_app";
const CADDY_RELOAD_ENV = "VIBE64_CADDY_RELOAD";
const CADDY_CONFIG_ENV = "VIBE64_CADDY_CONFIG";
const DEPLOYMENT_LOGS_DIR = "logs";

function createCaddyRouteMaterializer({
  caddyBinary = "caddy",
  caddyConfigPath = "",
  env = process.env,
  reload = isTruthyEnvValue(env[CADDY_RELOAD_ENV]),
  runCommand = runHostCommand
} = {}) {
  async function materializeProject(context = {}, state = {}) {
    const paths = caddyPaths(context, {
      caddyConfigPath: caddyConfigPath || env[CADDY_CONFIG_ENV]
    });
    await ensureCaddySupportFiles(paths);

    const route = projectCaddyRoute(context, state);
    if (!route.active) {
      if (route.sitePath) {
        await rm(route.sitePath, {
          force: true
        });
      }
      return materializeResult({
        paths,
        reload,
        route
      });
    }

    await writeTextFileAtomic(route.sitePath, renderCaddySiteFragment(route));
    await removeStaleProjectSiteFragments(paths, route);
    const reloadResult = reload ? await reloadCaddy({
      caddyBinary,
      configPath: paths.caddyConfigPath,
      runCommand
    }) : reloadSkippedResult();
    return materializeResult({
      paths,
      reload,
      reloadResult,
      route
    });
  }

  return Object.freeze({
    materializeProject
  });
}

function caddyPaths(context = {}, {
  caddyConfigPath = ""
} = {}) {
  const systemRoot = requiredText(context.systemRoot, "systemRoot");
  const caddyRoot = path.join(systemRoot, CADDY_ROOT_DIR);
  return {
    caddyConfigPath: String(caddyConfigPath || "").trim(),
    caddyRoot,
    sitesRoot: path.join(caddyRoot, CADDY_SITES_DIR),
    snippetPath: path.join(caddyRoot, CADDY_SNIPPETS_DIR, `${CADDY_PUBLISHED_APP_SNIPPET}.caddy`)
  };
}

async function ensureCaddySupportFiles(paths = {}) {
  await Promise.all([
    mkdir(paths.sitesRoot, {
      recursive: true
    }),
    writeTextFileAtomic(paths.snippetPath, renderCaddyPublishedAppSnippet())
  ]);
}

function projectCaddyRoute(context = {}, state = {}) {
  const currentRelease = state.currentRelease || null;
  const publicNameRecord = state.publicName || null;
  const publicName = String(publicNameRecord?.publicName || currentRelease?.publicName || "").trim();
  const caddy = caddyPaths(context);
  if (!publicName) {
    return {
      active: false,
      reason: "public_name_missing",
      sitePath: ""
    };
  }

  const validPublicName = assertValidPublicName(publicName);
  const sitePath = path.join(caddy.sitesRoot, `${validPublicName}.caddy`);
  if (!currentRelease || currentRelease.status !== "published") {
    return {
      active: false,
      publicName: validPublicName,
      reason: "published_release_missing",
      sitePath
    };
  }

  const target = caddyUpstreamForRelease(currentRelease);
  if (!target) {
    throw vibe64Error(
      "Published release has no loopback route target for Caddy.",
      "vibe64_deployment_caddy_target_missing"
    );
  }

  const hosts = uniqueSorted([
    publicNameRecord?.publicHost || currentRelease.publicHost,
    ...verifiedDomainHosts(state.domains)
  ].filter(Boolean).map(normalizeHostname));

  return {
    accessLogPath: projectAccessLogPath(context),
    active: true,
    hosts,
    project: state.project || null,
    publicName: validPublicName,
    releaseId: currentRelease.releaseId,
    sitePath,
    target
  };
}

function caddyUpstreamForRelease(release = {}) {
  const container = release.container || {};
  const upstream = String(container.loopbackProxyTarget || "").trim();
  if (upstream) {
    return upstream;
  }
  return loopbackTargetFromUrl(container.loopbackBaseUrl);
}

function loopbackTargetFromUrl(urlValue = "") {
  try {
    const url = new URL(String(urlValue || ""));
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
      return "";
    }
    return `${url.hostname}:${url.port}`;
  } catch {
    return "";
  }
}

function verifiedDomainHosts(domains = []) {
  return Array.isArray(domains)
    ? domains
      .filter((domain) => domain?.verificationStatus === "verified")
      .map((domain) => assertValidCustomHostname(domain.hostname))
    : [];
}

function projectAccessLogPath(context = {}) {
  return path.join(
    requiredText(context.projectLocalRoot, "projectLocalRoot"),
    "deployments",
    DEPLOYMENT_LOGS_DIR,
    "access.log"
  );
}

function renderCaddyPublishedAppSnippet() {
  return [
    "# Generated by Vibe64. Import this snippet from the host Caddyfile.",
    `(${CADDY_PUBLISHED_APP_SNIPPET}) {`,
    "  encode zstd gzip",
    "",
    "  reverse_proxy {args[0]}",
    "",
    "  log {",
    "    output file {args[1]} {",
    "      roll_size 10MiB",
    "      roll_keep 5",
    "    }",
    "    format json",
    "  }",
    "}",
    ""
  ].join("\n");
}

function renderCaddySiteFragment(route = {}) {
  const hosts = uniqueSorted(route.hosts);
  if (!hosts.length) {
    throw vibe64Error("Caddy route requires at least one hostname.", "vibe64_deployment_caddy_hosts_missing");
  }
  return [
    "# Generated by Vibe64. Do not edit by hand.",
    `# project=${route.project?.slug || ""} publicName=${route.publicName} release=${route.releaseId}`,
    `${hosts.join(", ")} {`,
    `  import ${CADDY_PUBLISHED_APP_SNIPPET} ${route.target} ${caddyQuote(route.accessLogPath)}`,
    "}",
    ""
  ].join("\n");
}

async function reloadCaddy({
  caddyBinary = "caddy",
  configPath = "",
  runCommand = runHostCommand
} = {}) {
  const normalizedConfigPath = String(configPath || "").trim();
  if (!normalizedConfigPath) {
    throw vibe64Error(
      `${CADDY_CONFIG_ENV} must point at the host Caddyfile when ${CADDY_RELOAD_ENV} is enabled.`,
      "vibe64_deployment_caddy_config_missing"
    );
  }
  const validate = await runCommand(caddyBinary, ["validate", "--config", normalizedConfigPath], {
    timeout: 30_000
  });
  if (!validate.ok) {
    throw vibe64Error(
      validate.output || "Caddy config validation failed.",
      "vibe64_deployment_caddy_validate_failed"
    );
  }
  const reload = await runCommand(caddyBinary, ["reload", "--config", normalizedConfigPath], {
    timeout: 30_000
  });
  if (!reload.ok) {
    throw vibe64Error(
      reload.output || "Caddy reload failed.",
      "vibe64_deployment_caddy_reload_failed"
    );
  }
  return {
    enabled: true,
    ok: true,
    reloadOutput: reload.output,
    validateOutput: validate.output
  };
}

function reloadSkippedResult() {
  return {
    enabled: false,
    ok: true,
    skippedReason: `${CADDY_RELOAD_ENV} is not enabled.`
  };
}

function materializeResult({
  paths = {},
  reload = false,
  reloadResult = reloadSkippedResult(),
  route = {}
} = {}) {
  return {
    accessLogPath: route.accessLogPath || "",
    active: route.active === true,
    caddyConfigPath: paths.caddyConfigPath,
    hosts: route.hosts || [],
    ok: true,
    publicName: route.publicName || "",
    reason: route.reason || "",
    reload,
    reloadResult,
    releaseId: route.releaseId || "",
    sitePath: route.sitePath || "",
    snippetPath: paths.snippetPath,
    target: route.target || ""
  };
}

async function removeStaleProjectSiteFragments(paths = {}, route = {}) {
  const projectSlug = String(route.project?.slug || "").trim();
  const activeSitePath = path.resolve(String(route.sitePath || ""));
  if (!projectSlug || !activeSitePath) {
    return;
  }
  const entries = await readdir(paths.sitesRoot, {
    withFileTypes: true
  });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".caddy"))
    .map(async (entry) => {
      const sitePath = path.join(paths.sitesRoot, entry.name);
      if (path.resolve(sitePath) === activeSitePath) {
        return;
      }
      const contents = await readFile(sitePath, "utf8");
      if (!isGeneratedProjectSiteFragment(contents, projectSlug)) {
        return;
      }
      await rm(sitePath, {
        force: true
      });
    }));
}

function isGeneratedProjectSiteFragment(contents = "", projectSlug = "") {
  const lines = String(contents || "").split(/\r?\n/u).slice(0, 3);
  return lines[0] === "# Generated by Vibe64. Do not edit by hand." &&
    lines.some((line) => line.startsWith(`# project=${projectSlug} `));
}

function caddyQuote(value = "") {
  return JSON.stringify(String(value || ""));
}

function requiredText(value = "", label = "value") {
  const text = String(value || "").trim();
  if (!text) {
    throw vibe64Error(`Caddy route materializer requires ${label}.`, "vibe64_deployment_caddy_context_missing");
  }
  return text;
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function isTruthyEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

export {
  CADDY_CONFIG_ENV,
  CADDY_RELOAD_ENV,
  createCaddyRouteMaterializer,
  projectAccessLogPath,
  renderCaddyPublishedAppSnippet,
  renderCaddySiteFragment
};
