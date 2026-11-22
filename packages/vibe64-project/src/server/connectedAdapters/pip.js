// The pip adapter: each connected Python distribution is installed editable (PEP 660) from the
// session's copy into the session's virtual environment, `.venv` at the session source, in one
// resolution with the tracked requirements.txt when there is one, so source edits are live (the
// treatment examples/connected-development/pip proves). An exact `==` pin of a connected
// distribution would make that resolution impossible whenever the checkout's version moves past
// it, so pip reads the untracked requirements.connected.txt: the tracked file with those pins left
// out (a range stays, and pip reports a checkout outside it). Nothing tracked changes in a session;
// on Save, `bump` moves a pin to the checkout's version once that version is published.
// No watcher: an editable install reads the checkout in place.
import { lstat, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { lastLine } from "./commandOutput.js";
import { readDerivedFile, refuseTracked, removeDerivedFiles, writeDerivedFiles } from "./derivedFiles.js";

const VENV = ".venv";
const REQUIREMENTS = "requirements.txt";
const DERIVED = "requirements.connected.txt";
const PIN_NOTE = "# Vibe64: the connected checkout takes the place of this pin:";
const PIP_TIMEOUT_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 2 * 60_000;
const UNPUBLISHED = /No matching distribution found|Could not find a version that satisfies/u;
// pip ends an unreachable index with the same words as an unpublished version; its retries tell them apart.
const UNREACHABLE = /Retrying \(Retry\(|NewConnectionError|Max retries exceeded|Network is unreachable|Temporary failure in name resolution/u;

// Run by the environment's interpreter: the distribution must be an editable install of the
// checkout (PEP 610), and its modules must import from inside it.
const PROBE = String.raw`
import importlib, importlib.metadata as md, json, os, pkgutil, sys, urllib.parse, urllib.request
name, root = sys.argv[1], sys.argv[2]
dist = md.distribution(name)
direct = json.loads(dist.read_text("direct_url.json") or "null")
if not direct or not direct.get("dir_info", {}).get("editable"):
    sys.exit(f"{name} is not an editable install")
url = urllib.parse.urlparse(direct["url"])
if url.scheme != "file" or os.path.realpath(urllib.request.url2pathname(url.path)) != root:
    sys.exit(f"{name} is installed from {direct['url']}, not {root}")
inside = lambda path: os.path.realpath(path).startswith(root + os.sep)
modules = set((dist.read_text("top_level.txt") or "").split())
for entry in sys.path:
    if entry and inside(entry):
        modules.update(m.name for m in pkgutil.iter_modules([entry]))
imported = []
for module in sorted(modules):
    loaded = importlib.import_module(module)
    if not inside(getattr(loaded, "__file__", "") or ""):
        sys.exit(f"{module} imports from {loaded.__file__}, not {root}")
    imported.append(module)
if not imported:
    sys.exit(f"no module of {name} imports from {root}")
print(f"{name} {dist.version} imports {', '.join(imported)} from {root}")
`;

function canonicalName(name) {
  return String(name).toLowerCase().replace(/[-_.]+/gu, "-");
}

/** One header of a distribution's METADATA, or "". */
function field(metadata, name) {
  const match = new RegExp(`^${name}:[ \\t]*(.+)$`, "mu").exec(metadata);
  return match ? match[1].trim() : "";
}


async function exists(target) {
  return Boolean(await lstat(target).catch(() => null));
}

/** The `[project]` name and static version of a pyproject.toml. */
function projectFields(text) {
  const found = { name: "", version: null };
  let inProject = false;
  for (const raw of String(text).split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inProject = line.replace(/\s*#.*$/u, "") === "[project]";
      continue;
    }
    const match = inProject ? /^(name|version)\s*=\s*(["'])([^"']+)\2\s*(?:#.*)?$/u.exec(line) : null;
    if (match && match[1] === "name") found.name = match[3];
    if (match && match[1] === "version") found.version = match[3];
  }
  return found;
}

/** Each connection's distribution: its name and version (from pyproject.toml) and its checkout. */
async function connectedDistributions(connections) {
  const found = [];
  for (const connection of connections) {
    const root = await realpath(connection.sourceRoot).catch(() => "");
    const { name, version } = projectFields(root ? await readFile(path.join(root, "pyproject.toml"), "utf8").catch(() => "") : "");
    if (!name) {
      throw vibe64Error(
        `Connected ${connection.name}: ${connection.sourceRoot} has no pyproject.toml with a [project] name, so pip cannot install it.`,
        "vibe64_connected_pip_project_missing"
      );
    }
    const twin = found.find(entry => canonicalName(entry.name) === canonicalName(name));
    if (twin) {
      throw vibe64Error(
        `Connected ${connection.name} and ${twin.connection.name} both hold the Python distribution ${name}; connect it once.`,
        "vibe64_connected_pip_duplicate"
      );
    }
    found.push({ connection, name, version, root });
  }
  return found;
}

/** A requirements line's distribution name and its exact `==` pin, if it names one. */
function requirementOf(line) {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/u.exec(line.replace(/\s+#.*$/u, ""));
  if (!match || line.trim().startsWith("#")) return null;
  const pin = /^===?\s*([^\s;,]+)\s*(?:;.*)?$/u.exec(match[2].trim());
  return { name: canonicalName(match[1]), pin: pin ? pin[1] : null };
}

/** The tracked requirements with each exact pin of a connected distribution left out. */
function derivedRequirements(text, distributions) {
  const connected = new Set(distributions.map(entry => canonicalName(entry.name)));
  return String(text).split("\n").map(line => {
    const requirement = requirementOf(line);
    return requirement && requirement.pin && connected.has(requirement.name) ? `${PIN_NOTE} ${line}` : line;
  }).join("\n");
}

function venvPython(sessionSourceRoot) {
  return path.join(sessionSourceRoot, VENV, "bin", "python");
}

/** The installed distributions of `.venv`, by canonical name: their version and PEP 610 origin. */
async function installedDistributions(sessionSourceRoot) {
  const lib = path.join(sessionSourceRoot, VENV, "lib");
  const installed = new Map();
  for (const version of await readdir(lib).catch(() => [])) {
    const sitePackages = path.join(lib, version, "site-packages");
    for (const entry of await readdir(sitePackages).catch(() => [])) {
      if (!entry.endsWith(".dist-info")) continue;
      const info = path.join(sitePackages, entry);
      const metadata = await readFile(path.join(info, "METADATA"), "utf8").catch(() => "");
      const name = field(metadata, "Name");
      if (!name) continue;
      const direct = await readFile(path.join(info, "direct_url.json"), "utf8").then(JSON.parse).catch(() => null);
      const url = typeof direct?.url === "string" ? direct.url : "";
      let origin = url;
      try {
        if (url.startsWith("file:")) origin = fileURLToPath(url);
      } catch {
        origin = url;
      }
      installed.set(canonicalName(name), {
        name,
        version: field(metadata, "Version"),
        editable: direct?.dir_info?.editable === true,
        origin
      });
    }
  }
  return installed;
}

async function applyPip({ connection, connections, sessionSourceRoot, runCommand, writeGitExcludes }) {
  const distributions = await connectedDistributions(connections);
  await refuseTracked({ connection, tree: sessionSourceRoot, paths: [VENV], runCommand });
  const tracked = await readDerivedFile(sessionSourceRoot, REQUIREMENTS);
  // A project that does not ignore its environment would commit it with its work.
  const excludes = (tree, paths) => writeGitExcludes(tree, [...new Set([...paths, VENV])]);
  if (tracked === null) {
    if (await readDerivedFile(sessionSourceRoot, DERIVED) !== null) {
      await removeDerivedFiles({ tree: sessionSourceRoot, paths: [DERIVED], writeGitExcludes });
    }
    await excludes(sessionSourceRoot, []);
  } else {
    await writeDerivedFiles({
      connection,
      tree: sessionSourceRoot,
      files: { [DERIVED]: derivedRequirements(tracked, distributions) },
      runCommand,
      writeGitExcludes: excludes
    });
  }
  const lines = [];
  if (!(await exists(venvPython(sessionSourceRoot)))) {
    const created = await runCommand({ command: "python3", args: ["-m", "venv", VENV], cwd: sessionSourceRoot, timeout: PIP_TIMEOUT_MS });
    if (created?.ok !== true) {
      throw vibe64Error(
        `Connected ${connection.name}: Python could not create the session's virtual environment ${VENV}. ${lastLine(created?.stderr || created?.error)}`.trim(),
        "vibe64_connected_pip_venv_failed"
      );
    }
    lines.push(`[Connected] Created the session's virtual environment ${VENV}.`);
  }
  // One resolution: each checkout satisfies the app's own requirement on its name, or pip says why not.
  const installed = await runCommand({
    command: venvPython(sessionSourceRoot),
    args: [
      "-m",
      "pip",
      "install",
      "--quiet",
      "--disable-pip-version-check",
      ...(tracked === null ? [] : ["-r", DERIVED]),
      ...distributions.flatMap(entry => ["-e", entry.root])
    ],
    cwd: sessionSourceRoot,
    timeout: PIP_TIMEOUT_MS
  });
  if (installed?.ok !== true) {
    throw vibe64Error(
      `Connected ${connection.name}: pip could not install the connected checkouts. ${lastLine(installed?.stderr || installed?.error)}`.trim(),
      "vibe64_connected_pip_install_failed"
    );
  }
  const own = distributions.find(entry => entry.connection.repository === connection.repository);
  lines.push(`[Connected] ${connection.name}: ${own.name} installed editable from ${own.root} in ${VENV}.`);
  return { lines };
}

/** What `.venv` holds for the distribution, read from its files: "" when it is the checkout's editable install. */
async function installedReason(sessionSourceRoot, { name, root }) {
  if (!(await exists(venvPython(sessionSourceRoot)))) return `the session has no ${VENV} yet; prepare the workspace to install ${name} from ${root}.`;
  const installed = (await installedDistributions(sessionSourceRoot)).get(canonicalName(name));
  if (!installed) return `${name} is not installed in ${VENV}; prepare the workspace to install it from ${root}.`;
  if (!installed.editable) return `${VENV} holds ${name} ${installed.version}, not an editable install of ${root}; prepare the workspace again.`;
  const origin = await realpath(installed.origin).catch(() => installed.origin);
  return origin === root ? "" : `${name} in ${VENV} is installed from ${installed.origin}, not this session's copy ${root}; prepare the workspace again.`;
}

async function provePip({ connection, connections, sessionSourceRoot, runCommand }) {
  let distribution;
  let distributions;
  try {
    distributions = await connectedDistributions(connections);
    distribution = distributions.find(entry => entry.connection.repository === connection.repository);
  } catch (error) {
    return { inEffect: false, reason: String(error.message) };
  }
  const files = await installedReason(sessionSourceRoot, distribution);
  if (files) return { inEffect: false, reason: files };
  const tracked = await readDerivedFile(sessionSourceRoot, REQUIREMENTS);
  if (tracked !== null && await readDerivedFile(sessionSourceRoot, DERIVED) !== derivedRequirements(tracked, distributions)) {
    return { inEffect: false, reason: `${DERIVED} does not match ${REQUIREMENTS}; prepare the workspace again.` };
  }
  if (!runCommand) return { inEffect: true, reason: "" };
  const { name, root } = distribution;
  const probe = await runCommand({
    command: venvPython(sessionSourceRoot),
    args: ["-c", PROBE, name, root],
    cwd: sessionSourceRoot,
    timeout: PROBE_TIMEOUT_MS
  });
  if (probe?.ok !== true) {
    return { inEffect: false, reason: `${VENV}'s Python does not load ${name} from ${root}: ${lastLine(probe?.stderr || probe?.error)}` };
  }
  const check = await runCommand({
    command: venvPython(sessionSourceRoot),
    args: ["-m", "pip", "check", "--disable-pip-version-check"],
    cwd: sessionSourceRoot,
    timeout: PROBE_TIMEOUT_MS
  });
  if (check?.ok !== true) {
    return { inEffect: false, reason: `pip check finds broken requirements in ${VENV}: ${lastLine(check?.stdout || check?.stderr || check?.error)}` };
  }
  return { inEffect: true, reason: "" };
}

/**
 * The connected distribution's version beside the one Staging and Production install: the tracked
 * requirements.txt's exact pin (null for a range). Files only.
 */
async function lockedPip({ connection, sessionSourceRoot }) {
  const root = await realpath(connection.sourceRoot).catch(() => "");
  const { name, version } = projectFields(root ? await readFile(path.join(root, "pyproject.toml"), "utf8").catch(() => "") : "");
  const tracked = await readDerivedFile(sessionSourceRoot, REQUIREMENTS);
  if (!name || tracked === null) return [];
  const requirements = tracked.split("\n").map(requirementOf).filter(entry => entry && entry.name === canonicalName(name));
  if (!requirements.length) return [];
  const pinned = requirements.find(entry => entry.pin);
  return [{ package: name, connected: version, locked: pinned ? pinned.pin : null }];
}

/** Whether pip finds the distribution's version where the project installs from. */
async function published({ name, version, sessionSourceRoot, runCommand }) {
  const dest = path.join(sessionSourceRoot, VENV, "vibe64-published-check");
  await rm(dest, { recursive: true, force: true });
  try {
    const result = await runCommand({
      command: venvPython(sessionSourceRoot),
      args: ["-m", "pip", "download", "--no-deps", "--quiet", "--disable-pip-version-check", "--dest", dest, `${name}==${version}`],
      cwd: sessionSourceRoot,
      timeout: PIP_TIMEOUT_MS
    });
    if (result?.ok === true) return { published: true, reason: "" };
    const output = `${result?.stderr || ""}\n${result?.stdout || ""}`;
    const unreachable = output.split("\n").find(line => UNREACHABLE.test(line));
    if (unreachable) return { published: false, reason: unreachable.trim().slice(0, 300) };
    return { published: false, reason: UNPUBLISHED.test(output) ? "" : lastLine(result?.stderr || result?.error) || "pip download failed" };
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
}

/**
 * On Save: moves the tracked exact pin to the checkout's version once pip finds that version
 * published, and puts the checkout in effect again. An unpublished version changes nothing.
 */
async function bumpPip(context) {
  const { connection, sessionSourceRoot, runCommand } = context;
  const bumped = [];
  const lines = [];
  for (const entry of await lockedPip(context)) {
    if (!entry.connected || !entry.locked || entry.connected === entry.locked) continue;
    if (!(await exists(venvPython(sessionSourceRoot)))) {
      lines.push(`[Connected] ${connection.name}: could not check whether ${entry.package} ${entry.connected} is published: the session has no ${VENV}.`);
      continue;
    }
    const check = await published({ name: entry.package, version: entry.connected, sessionSourceRoot, runCommand });
    if (!check.published) {
      if (check.reason) lines.push(`[Connected] ${connection.name}: could not check whether ${entry.package} ${entry.connected} is published: ${check.reason}.`);
      continue;
    }
    const tracked = await readDerivedFile(sessionSourceRoot, REQUIREMENTS);
    const moved = tracked.split("\n").map(line => {
      const requirement = requirementOf(line);
      return requirement && requirement.pin && requirement.name === canonicalName(entry.package)
        ? line.replace(/(===?\s*)[^\s;,#]+/u, `$1${entry.connected}`)
        : line;
    }).join("\n");
    await writeFile(path.join(sessionSourceRoot, REQUIREMENTS), moved);
    bumped.push({ package: entry.package, from: entry.locked, to: entry.connected });
    lines.push(`[Connected] ${connection.name}: Staging and Production now use the published ${entry.package} ${entry.connected}.`);
  }
  // The derived requirements follow the moved pin.
  if (bumped.length) lines.push(...(await applyPip(context)).lines);
  return { bumped, lines };
}

/**
 * Once no pip connection remains, the derived requirements go. pip cannot run here, so an editable
 * install of a connection that is gone stays in `.venv`: say which, and how the published package comes back.
 */
async function restorePip({ connections, sessionSourceRoot, writeGitExcludes }) {
  const lines = [];
  const derived = await readDerivedFile(sessionSourceRoot, DERIVED);
  // Only Vibe64's own: the tracked requirements with some pins left out.
  const own = derived !== null && derived.split("\n").map(line => line.startsWith(`${PIN_NOTE} `) ? line.slice(PIN_NOTE.length + 1) : line)
    .join("\n") === await readDerivedFile(sessionSourceRoot, REQUIREMENTS);
  if (!connections.length && own) {
    await removeDerivedFiles({ tree: sessionSourceRoot, paths: [DERIVED], writeGitExcludes });
    lines.push(`[Connected] No pip connection remains: removed ${DERIVED}.`);
  }
  if (!(await exists(venvPython(sessionSourceRoot)))) return lines;
  const connectedFolder = path.join(path.dirname(path.resolve(sessionSourceRoot)), "connected");
  const remaining = new Set();
  for (const connection of connections) remaining.add(await realpath(connection.sourceRoot).catch(() => connection.sourceRoot));
  for (const installed of (await installedDistributions(sessionSourceRoot)).values()) {
    if (!installed.editable || !installed.origin.startsWith(`${connectedFolder}${path.sep}`)) continue;
    if (remaining.has(await realpath(installed.origin).catch(() => installed.origin))) continue;
    lines.push(
      `[Connected] ${VENV} still has ${installed.name} installed editable from ${installed.origin}, which is no longer connected. ` +
      `Run \`${VENV}/bin/python -m pip install --force-reinstall ${installed.name}\` (or remove ${VENV} and prepare the workspace) for the published package.`
    );
  }
  return lines;
}

const pipAdapter = Object.freeze({
  type: "pip",
  runtimeRequirements: Object.freeze(["python", "git"]),
  apply: applyPip,
  proof: provePip,
  restore: restorePip,
  locked: lockedPip,
  bump: bumpPip
});

export { pipAdapter };
