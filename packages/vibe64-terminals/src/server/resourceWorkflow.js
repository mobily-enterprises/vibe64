import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  RUNTIME_PACKS,
  runtimePackBinPaths,
  runtimePackRoot,
  startVibe64Workflow,
  vibe64ManagedExecutionProvider,
  vibe64ManagedExecutionRequired
} from "@local/vibe64-execution/server";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

const fileDigests = new Map();
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function within(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

async function dependencyIdentity(root, file, budget) {
  let actual;
  try {
    actual = await realpath(file);
  } catch (error) {
    if (error.code === "ENOENT") return "absent";
    throw error;
  }
  if (!within(root, actual)) throw new Error("dependency_outside_source");
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (process.platform === "linux" && !within(root, await realpath(`/proc/self/fd/${handle.fd}`))) {
      throw new Error("dependency_outside_source");
    }
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("dependency_identity_unavailable");
    if (before.size > BigInt(MAX_FILE_BYTES)) throw new Error("dependency_identity_too_large");
    budget.bytes += Number(before.size);
    if (budget.bytes > MAX_INPUT_BYTES) throw new Error("dependency_identity_too_large");
    const stamp = [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].join(":");
    const cached = fileDigests.get(actual);
    if (cached?.stamp === stamp) return cached.hash;
    // Read through a bounded buffer, not readFile(): a concurrent append must
    // not turn a small inspected lockfile into an unbounded allocation.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (length !== Number(before.size) || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new Error("dependency_identity_changed");
    }
    const hash = digest(buffer.subarray(0, length));
    if (fileDigests.size >= 256) fileDigests.delete(fileDigests.keys().next().value);
    fileDigests.set(actual, { stamp, hash });
    return hash;
  } finally {
    await handle.close();
  }
}

async function runtimePathIdentity(file, optional = false) {
  try {
    const actual = await realpath(file);
    const info = await stat(actual, { bigint: true });
    if (!info.isFile() && !info.isDirectory()) throw new Error("runtime_identity_unavailable");
    return [actual, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String);
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  }
}

async function resourceWorkflowIdentity({ sourceRoot, operation, runtimes = [], steps = [], configuration = {}, env = process.env }) {
  const root = await realpath(sourceRoot);
  const runtimeNames = [...new Set(runtimes)].sort();
  const commandSteps = steps.map((step) => {
    const cwd = path.resolve(root, step.workdir || ".");
    if (!within(root, cwd)) throw new Error("Workflow work directory is outside its source.");
    return { argv: step.argv, workdir: path.relative(root, cwd) || ".", role: step.role || "" };
  });
  const description = {
    version: 1, operation, runtimes: runtimeNames, steps: commandSteps,
    architecture: process.arch, platform: process.platform, configuration
  };
  let compatibilityStatus = "complete";
  let compatibilityDiagnostic = "";
  try {
    if (Object.hasOwn(configuration, "environmentFingerprint") &&
      !/^[a-f0-9]{64}$/u.test(configuration.environmentFingerprint || "")) {
      throw new Error("configuration_identity_unavailable");
    }
    description.runtimeIdentities = await Promise.all(runtimeNames.map(async (name) => {
      const pack = RUNTIME_PACKS[name];
      if (!pack) throw new Error("runtime_identity_unavailable");
      const bins = runtimePackBinPaths(name, { env });
      // Fingerprint the pack as well as its tools: an aggregate pack can change
      // while its first command still points at an unchanged shared binary.
      const directories = await Promise.all(bins.map((bin) => runtimePathIdentity(bin)));
      const commands = await Promise.all(bins.flatMap((bin) => pack.managedCommands
        .map((command) => runtimePathIdentity(path.join(bin, command), true))));
      if (pack.managedCommands.length && !commands.some(Boolean)) throw new Error("runtime_identity_unavailable");
      const installed = await Promise.all((pack.identityPaths || [])
        .map((file) => runtimePathIdentity(path.join(runtimePackRoot({ env }), file))));
      const identity = { directories, commands, installed };
      return { name, fingerprint: digest(JSON.stringify(identity)) };
    }));
    const files = new Set();
    for (const workdir of new Set([".", ...commandSteps.map((step) => step.workdir)])) {
      for (const name of runtimeNames) {
        for (const file of RUNTIME_PACKS[name].dependencyFiles || []) files.add(path.join(workdir, file));
      }
    }
    if (files.size > 64) throw new Error("dependency_identity_too_large");
    const budget = { bytes: 0 };
    description.dependencies = [];
    for (const file of [...files].sort()) {
      description.dependencies.push([file, await dependencyIdentity(root, path.join(root, file), budget)]);
    }
  } catch (error) {
    compatibilityStatus = "incomplete";
    compatibilityDiagnostic = ["configuration_identity_unavailable", "dependency_outside_source", "dependency_identity_too_large", "dependency_identity_changed"].includes(error.message)
      ? error.message : "runtime_or_dependency_identity_unavailable";
  }
  // No source path, command text, environment value or file contents cross into
  // host profile storage. Incomplete identities permit accounting, not learning.
  return { compatibilityKey: digest(JSON.stringify(description)), compatibilityStatus, compatibilityDiagnostic };
}

async function startResourceWorkflow({ session, sourceRoot, operation, runtimes, steps, configuration, estimates, environment = "development", kind, label, env = process.env }) {
  if (!vibe64ManagedExecutionProvider() && !vibe64ManagedExecutionRequired()) return { ok: true, workflow: null };
  const project = currentProjectRequestContext();
  if (!project?.slug || !session?.sessionId) throw new Error("Managed resource accounting requires the resolved project and session.");
  return startVibe64Workflow({
    projectSlug: project.slug, sessionId: session.sessionId, ownerId: session.sessionId,
    operation, environment, kind, label, estimates, mode: configuration?.mode || "finite",
    ...await resourceWorkflowIdentity({ sourceRoot, operation, runtimes, steps, configuration, env })
  });
}

export { resourceWorkflowIdentity, startResourceWorkflow };
