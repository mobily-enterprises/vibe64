import { readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { codexAppServerRuntimeBaseDir } from "@local/vibe64-runtime/server/agentProviderRuntimePaths";
import { codexProviderPaths } from "@local/vibe64-core/server/codexProviderConnections";
import { codexAuthMarkerPath, codexAuthStatusPath } from "@local/vibe64-core/server/codexAuthState";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";

const providers = ["deepseek", "zai", "zai-coding-plan"];
const nativeHomePattern = /^(?:private-[A-Za-z0-9-]+|verify-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const object = value => value && typeof value === "object" && !Array.isArray(value);
function parse(source, label) {
  try { const value = JSON.parse(source); if (object(value)) return value; } catch { /* Never expose saved credentials. */ }
  throw new Error(`${label} is invalid. Inspect or restore it before clearing saved provider credentials.`);
}

// Accounts owns this explicit offline policy. The existing publisher owns private
// before/after copies and exact-byte retry; no normal reader invokes this code.
export async function upgradeIndependentProviderCredentials({ systemRoot, apply, backupRoot, report,
  env = process.env, home = os.homedir() }) {
  const storePath = path.join(systemRoot, "ai-connections", "connections.json");
  const exactPaths = new Set([storePath]);
  for (const engineId of ["codex", "claude"]) for (const providerId of providers) {
    const locations = codexProviderPaths(systemRoot, providerId, engineId);
    for (const file of [locations.connectionPath, path.join(locations.codexHome, "config.toml"),
      codexAuthMarkerPath(locations.systemRoot), codexAuthStatusPath(locations.systemRoot)]) exactPaths.add(file);
  }
  // Both the configured runtime and the ordinary persistent default can contain
  // managed native auth left by a prior stopped process. These are editor-owned
  // private homes; the person's independent CLI configuration is not enumerated.
  const runtimeBases = [...new Set([
    codexAppServerRuntimeBaseDir({ env, hostEnv: env }),
    path.join(home, ".cache", "vibe64", "agent-providers"),
    ...(path.isAbsolute(env.XDG_RUNTIME_DIR || "") ? [path.join(env.XDG_RUNTIME_DIR, "vibe64", "agent-providers")] : [])
  ])];
  const runtimeRoots = runtimeBases.map(root => path.join(root, "opencode"));
  const nativePath = file => runtimeRoots.some(root => {
    const relative = path.relative(root, file).split(path.sep);
    return relative.length === 4 && nativeHomePattern.test(relative[0]) &&
      relative.slice(1).join("/") === "data/opencode/auth.json";
  });
  const helperPath = file => runtimeBases.some(root => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    return /^codex-app-server(?:-[a-f0-9]{12}|-[a-f0-9]{16})?\/codex-home\/config\.toml$/u.test(relative);
  });
  const ownedPath = file => exactPaths.has(file) || nativePath(file) || helperPath(file);
  const publicationRoot = path.parse(systemRoot).root;
  // Native generated credentials can lie outside systemRoot. Fence the existing
  // publisher's wider boundary, including saved retry manifests, to exact owners.
  await verifyUpgradeParents(systemRoot, path.join(backupRoot, "manifest.json"));
  const manifestSource = await readUpgradeFile(path.join(backupRoot, "manifest.json"));
  if (manifestSource !== null) {
    const manifest = parse(manifestSource, "Provider credential backup manifest");
    if (!Array.isArray(manifest.files) || manifest.files.some(entry => typeof entry?.path !== "string" ||
      !ownedPath(path.join(publicationRoot, entry.path)))) {
      throw new Error("Provider credential backup manifest contains an unowned path. Inspect it before retrying.");
    }
  }
  report("warning", "Applying this upgrade clears ALL saved DeepSeek, regular GLM API and GLM Coding Plan connections for Codex, Claude Code and OpenCode, including managed native credentials. Stop services and every native writer first. Routing stays selected but unavailable until each orchestrator is independently reconnected. Local clearing does not revoke keys at the provider. Conversations, history, source, subscription logins and unrelated providers remain.");
  report("warning", `Managed native credential inventory includes external runtime locations: ${runtimeBases.join(", ")}. Stop every service and native terminal writing these paths before apply.`);
  await publishStateUpgradeFiles({ systemRoot: publicationRoot, apply, backupRoot, report,
    async prepareUpdates() {
      const updates = [];
      for (const filePath of exactPaths) {
        await verifyUpgradeParents(publicationRoot, filePath);
        const original = await readUpgradeFile(filePath);
        if (original === null) continue;
        if (filePath === storePath) {
          const state = parse(original, "OpenCode connection store");
          if (![1, 2, 3, 4, 5].includes(state.version) || !object(state.connections)) {
            throw new Error("OpenCode connection store has an unsupported shape. Inspect it before clearing credentials.");
          }
          const next = structuredClone(state);
          for (const providerId of providers) delete next.connections[providerId];
          if (providers.some(id => Object.hasOwn(state.connections, id))) {
            updates.push({ filePath, original, contents: `${JSON.stringify(next, null, 2)}\n` });
          }
        } else {
          if (filePath.endsWith("connection.json")) {
            const connection = parse(original, "Curated provider connection");
            if (typeof connection.apiKey !== "string" || !connection.apiKey) throw new Error("Curated provider connection has an unsupported shape. Inspect it before clearing credentials.");
          }
          updates.push({ filePath, original, contents: null });
        }
      }
      for (const root of runtimeRoots) {
        await verifyUpgradeParents(publicationRoot, path.join(root, ".inventory"));
        let entries;
        try { entries = await readdir(root, { withFileTypes: true }); }
        catch (error) { if (error.code === "ENOENT") continue; throw error; }
        for (const entry of entries) {
          if (!nativeHomePattern.test(entry.name)) continue;
          if (!entry.isDirectory()) throw new Error("Managed OpenCode credential home must be a regular directory. Inspect it before clearing credentials.");
          const filePath = path.join(root, entry.name, "data", "opencode", "auth.json");
          await verifyUpgradeParents(publicationRoot, filePath);
          const original = await readUpgradeFile(filePath);
          if (original === null) continue;
          const auth = parse(original, "Managed OpenCode native credentials");
          if (!providers.some(id => Object.hasOwn(auth, id))) continue;
          const next = structuredClone(auth);
          for (const providerId of providers) delete next[providerId];
          updates.push({ filePath, original, contents: `${JSON.stringify(next, null, 2)}\n` });
        }
      }
      for (const root of runtimeBases) {
        await verifyUpgradeParents(publicationRoot, path.join(root, ".inventory"));
        let entries;
        try { entries = await readdir(root, { withFileTypes: true }); }
        catch (error) { if (error.code === "ENOENT") continue; throw error; }
        for (const entry of entries) {
          if (!/^codex-app-server(?:-[a-f0-9]{12}|-[a-f0-9]{16})?$/u.test(entry.name)) continue;
          if (!entry.isDirectory()) throw new Error("Managed Codex runtime must be a regular directory. Inspect it before clearing credentials.");
          const filePath = path.join(root, entry.name, "codex-home", "config.toml");
          await verifyUpgradeParents(publicationRoot, filePath);
          const original = await readUpgradeFile(filePath);
          if (original === null) continue;
          // Existing isolated helpers copy curated TOML. Remove only credential
          // assignments in those exact provider tables, retaining native trust,
          // catalogue, routing and all unrelated provider settings byte-for-byte.
          let providerTable = "", removed = false;
          const contents = original.split(/(?<=\n)/u).filter(line => {
            if (/^\s*\[/u.test(line)) {
              const table = /^\s*\[model_providers\.(?:"([^"\\]+)"|([A-Za-z0-9_-]+))\]\s*(?:#.*)?$/u.exec(line.trimEnd());
              providerTable = table?.[1] || table?.[2] || "";
            }
            if (providers.includes(providerTable) && /^\s*experimental_bearer_token\s*=/u.test(line)) {
              // Generated secrets are one JSON-quoted line; unfamiliar TOML
              // requires explicit review rather than risking a partial clear.
              if (!/^\s*experimental_bearer_token\s*=\s*"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/u.test(line.trimEnd())) {
                throw new Error("Managed Codex provider credentials have an unsupported TOML shape. Inspect them before clearing.");
              }
              removed = true; return false;
            }
            return true;
          }).join("");
          if (removed) updates.push({ filePath, original, contents });
        }
      }
      report("info", `${updates.length} credential-bearing or connection-state file(s) inventoried; no provider requests or credential copying.`);
      return updates;
    }
  });
}
