// Vibe64's Node.js usage recorder, loaded with --import into a recorded Output
// target's processes. It records which of the project's own functions ran, per
// request or run, into the recording directory, and nothing else: no request
// contents, no arguments or values, no network or debugging access. Any setup
// that is not exactly right leaves the process untouched.
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { USAGE_RECORDING_ENVIRONMENT, USAGE_RECORDING_LIMITS } from "../../src/shared/contract.js";
import { instrumentSource } from "./instrument.mjs";
import { createScopes } from "./scope.mjs";
import { controlSaysStopping, createTraceWriter } from "./writer.mjs";

const INSTRUMENTED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
const MINIMUM_NODE = [22, 15];

function recordingSetup(env = process.env) {
  try {
    const directory = String(env[USAGE_RECORDING_ENVIRONMENT.directory] || "");
    const sourceRoot = String(env[USAGE_RECORDING_ENVIRONMENT.sourceRoot] || "");
    const targetKind = String(env[USAGE_RECORDING_ENVIRONMENT.targetKind] || "");
    if (!path.isAbsolute(directory) || !path.isAbsolute(sourceRoot) || !["web", "terminal"].includes(targetKind)) return null;
    const directoryInfo = lstatSync(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) return null;
    const realSourceRoot = realpathSync(sourceRoot);
    if (!lstatSync(realSourceRoot).isDirectory()) return null;
    return { directory, sourceRoot: realSourceRoot, targetKind };
  } catch {
    return null;
  }
}

function nodeSupported() {
  const [major, minor] = String(process.versions.node).split(".").map(Number);
  return typeof nodeModule.registerHooks === "function" &&
    (major > MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor >= MINIMUM_NODE[1]));
}

// The source-root-relative POSIX path of a project file the recorder may
// instrument, or "" for anything else.
function projectPath(url, sourceRoot) {
  if (!url.startsWith("file:")) return "";
  const file = fileURLToPath(url);
  if (!INSTRUMENTED_EXTENSIONS.has(path.extname(file))) return "";
  const relative = path.relative(sourceRoot, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  const parts = relative.split(path.sep);
  return parts.includes("node_modules") ? "" : parts.join("/");
}

async function startRecorder() {
  const setup = recordingSetup();
  // A process started after Stop records nothing and writes nothing.
  if (!setup || controlSaysStopping(setup.directory)) return;

  let flushScheduled = false;
  const writer = createTraceWriter({
    directory: setup.directory,
    onFlushNeeded() {
      if (flushScheduled) return;
      flushScheduled = true;
      setImmediate(() => {
        flushScheduled = false;
        flush();
      }).unref();
    }
  });
  // Without in-thread load hooks the recorder says why once and stays inert.
  if (!nodeSupported()) {
    writer.start([{ type: "diagnostic", code: "NODE_TOO_OLD" }]);
    return;
  }
  let parse;
  try {
    ({ parse } = await import("@babel/parser"));
  } catch {
    writer.start([{ type: "diagnostic", code: "PARSER_UNAVAILABLE" }]);
    return;
  }

  let recording = true;
  const scopes = createScopes({ targetKind: setup.targetKind });
  const active = () => recording && writer.active;
  const flush = () => {
    try {
      if (!recording) return;
      if (controlSaysStopping(setup.directory)) {
        recording = false;
        writer.finish();
        return;
      }
      writer.flush();
    } catch {
      recording = false;
    }
  };

  Object.defineProperty(globalThis, "__vibe64UsageHit", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: function vibe64UsageHit(functionIndex) {
      if (!recording || !writer.active) return;
      try {
        writer.hit(scopes.current(), functionIndex);
      } catch {
        recording = false;
      }
    }
  });
  scopes.patchServers({
    isActive: active,
    onRequestEnd(scope) {
      try {
        if (recording) writer.endScope(scope);
      } catch {
        recording = false;
      }
    }
  });

  let nextFileIndex = 0;
  let nextFunctionIndex = 0;
  // A file loaded again with the same bytes keeps its indices.
  const instrumented = new Map();

  function instrument(url, result) {
    const relative = projectPath(url, setup.sourceRoot);
    if (!relative || result?.source === null || result?.source === undefined) return result;
    const format = String(result.format || "");
    if (!["module", "commonjs", "module-typescript", "commonjs-typescript"].includes(format)) return result;
    if (!writer.start([{ type: "tracer", state: "ready" }])) return result;
    const bytes = typeof result.source === "string" ? Buffer.from(result.source) : Buffer.from(result.source.buffer, result.source.byteOffset, result.source.byteLength);
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const key = `${relative}\0${hash}`;
    let entry = instrumented.get(key);
    if (!entry) {
      try {
        const extension = path.extname(relative);
        const { code, functions } = instrumentSource(bytes.toString("utf8"), {
          parse,
          typescript: TYPESCRIPT_EXTENSIONS.has(extension),
          commonjs: format.startsWith("commonjs"),
          nextFunctionIndex
        });
        const fileIndex = nextFileIndex;
        nextFileIndex += 1;
        nextFunctionIndex += functions.length;
        writer.declareFile(fileIndex, relative, hash);
        for (const entryFunction of functions) writer.declareFunction(fileIndex, entryFunction);
        entry = { code };
      } catch (error) {
        writer.diagnostic(error instanceof SyntaxError || error?.code === "BABEL_PARSER_SYNTAX_ERROR" ? "PARSE_FAILED" : "INSTRUMENT_FAILED", relative);
        entry = { code: null };
      }
      instrumented.set(key, entry);
    }
    return entry.code === null ? result : { ...result, source: entry.code };
  }

  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!active()) return result;
      try {
        return instrument(url, result);
      } catch {
        return result;
      }
    }
  });

  const timer = setInterval(flush, USAGE_RECORDING_LIMITS.flushIntervalMs);
  timer.unref();
  process.on("exit", () => {
    try {
      if (!recording) return;
      if (setup.targetKind === "terminal") writer.endScope(scopes.processScope);
      writer.flush();
    } catch {
      // The process is ending; a failed final write loses only this flush.
    }
  });
}

try {
  await startRecorder();
} catch {
  // Never let the recorder stop the application from starting.
}
