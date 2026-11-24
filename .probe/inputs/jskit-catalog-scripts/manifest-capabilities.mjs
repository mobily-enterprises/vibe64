import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { toPosixPath } from "./files.mjs";

// The manifest part of plain `jskit check`: an application package's manifest (`jskit.capabilities` in its
// package.json) names what its features (the server providers `jskit.runtime.server.providers` declares) provide and
// require. The server refuses to start on a drifted one; here it fails the check instead, with the capability to add or
// remove. The kernel the package itself resolves loads the features and compares them, by the rules it applies at
// start-up, so the two never disagree.

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#package-manifest";
const KERNEL_PLATFORM = "@jskit-ai/kernel/server/platform";

// The line naming a capability in a manifest's `capabilities` block, else the block's own line.
function capabilityLine(contents, capabilityId = "") {
  const text = String(contents);
  const block = text.indexOf('"capabilities"');
  if (block < 0) return 1;
  const named = capabilityId ? text.indexOf(`"${capabilityId}"`, block) : -1;
  return text.slice(0, named < 0 ? block : named).split("\n").length;
}

// The kernel's platform module as the package resolves it, else as the app does; null when neither has one.
async function kernelPlatform(manifestPath, root) {
  for (const base of [manifestPath, path.join(root, "package.json")]) {
    let resolved;
    try {
      resolved = createRequire(base).resolve(KERNEL_PLATFORM);
    } catch {
      continue;
    }
    return await import(pathToFileURL(resolved).href);
  }
  return null;
}

async function checkManifestCapabilities({ projectRoot, manifests }) {
  const root = path.resolve(projectRoot);
  const findings = [];
  const installTime = [];
  let packages = 0;
  for (const manifest of manifests) {
    const jskit = manifest.value?.jskit;
    if (!Array.isArray(jskit?.runtime?.server?.providers) || jskit.runtime.server.providers.length < 1) continue;
    const file = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
    const at = (capabilityId, message) => findings.push({ file, line: capabilityLine(manifest.contents, capabilityId), rule: "manifest/capabilities", message });
    const kernel = await kernelPlatform(manifest.absolutePath, root);
    if (typeof kernel?.packageCapabilityDrift !== "function") {
      at("", `declares server providers, but no installed ${KERNEL_PLATFORM} compares a manifest with them; run jskit update.`);
      continue;
    }
    let drift;
    try {
      drift = await kernel.packageCapabilityDrift({
        packageId: String(manifest.value.name || file),
        packageRoot: path.dirname(manifest.absolutePath),
        packageMetadata: jskit
      });
    } catch (error) {
      at("", `declares server providers that do not load: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!drift) continue;
    packages += 1;
    for (const id of drift.unlistedProvides) at("", `its features provide ${id}, which jskit.capabilities.provides does not list; add it.`);
    for (const id of drift.extraProvides) at(id, `jskit.capabilities.provides lists ${id}, which none of its features provides; remove it.`);
    for (const id of drift.unlistedRequires) at("", `its features require ${id}, which jskit.capabilities.requires does not list; add it.`);
    for (const id of drift.extraRequires) installTime.push({ file, line: capabilityLine(manifest.contents, id), capabilityId: id });
  }
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return { ok: findings.length < 1, findings, installTime, packages };
}

function formatManifestCapabilitiesReport(result) {
  const lines = result.findings.flatMap(({ file, line, rule, message }) => [`${file}:${line}  ${rule}  ${message}`, `  ${GUIDE}`]);
  if (result.installTime.length > 0) {
    lines.push(`Manifest requirements no feature has (${result.installTime.length}), each needed only at install time, such as ` +
      `the database a migration needs; remove any other (${GUIDE}):`);
    for (const { file, line, capabilityId } of result.installTime) lines.push(`  ${file}:${line}  ${capabilityId}`);
  }
  lines.push(result.ok
    ? `JSKIT package manifests name what their features provide and require in ${result.packages} package(s).`
    : `JSKIT package manifests: ${result.findings.length} error(s). A package's jskit.capabilities lists exactly what its ` +
      "features provide, and every capability they require beyond the kernel's own and the package's.");
  return lines.join("\n");
}

export { checkManifestCapabilities, formatManifestCapabilitiesReport };
