import crypto from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  closeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  fixCodexTerminalNamespace
} from "./terminalShared.js";

const FIX_CODEX_JOB_STATUSES = new Set(["fixed", "blocked"]);
const FIX_CODEX_HELPER_SOCKET_CONTAINER_DIR = "/vibe64-fix-helper";
const FIX_CODEX_HELPER_SOCKET_NAME = `fix-codex-${process.pid}.sock`;
const FIX_CODEX_HELPER_SCRIPT_NAME = "vibe64-fix-codex-report.mjs";
const MAX_FIX_CODEX_HELPER_BODY_BYTES = 128 * 1024;
const helperServers = new Map();

function publicFixCodexJob(job = {}) {
  return {
    completedAt: job.completedAt || "",
    createdAt: job.createdAt || "",
    id: job.id || "",
    message: job.message || "",
    repairTarget: job.repairTarget || "",
    scope: job.scope || "project",
    status: job.status || "running",
    subject: job.subject || "",
    targetRoot: job.targetRoot || "",
    terminalSessionId: job.terminalSessionId || "",
    verificationSummary: job.verificationSummary || "",
    workdir: job.workdir || ""
  };
}

function normalizeFixStatus(status = "") {
  const normalizedStatus = normalizeText(status);
  if (!FIX_CODEX_JOB_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(
      `Invalid Fix Codex status: ${normalizedStatus || "(empty)"}.`,
      "vibe64_fix_codex_status_invalid"
    );
  }
  return normalizedStatus;
}

function createFixCodexJobStore({
  clock = () => new Date()
} = {}) {
  const jobs = new Map();

  function createJob({
    prompt = "",
    repairTarget = "",
    scope = "project",
    subject = "",
    targetRoot = "",
    workdir = ""
  } = {}) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const job = {
      completedAt: "",
      createdAt: clock().toISOString(),
      id,
      message: "",
      prompt: String(prompt || ""),
      repairTarget: normalizeText(repairTarget),
      reportToken: token,
      scope: normalizeText(scope) || "project",
      status: "running",
      subject: normalizeText(subject),
      targetRoot: normalizeText(targetRoot),
      terminalSessionId: "",
      verificationSummary: "",
      workdir: normalizeText(workdir)
    };
    jobs.set(id, job);
    return {
      job: publicFixCodexJob(job),
      token
    };
  }

  function requireJob(jobId = "") {
    const job = jobs.get(normalizeText(jobId));
    if (!job) {
      throw vibe64Error(
        "Fix Codex job was not found.",
        "vibe64_fix_codex_job_not_found"
      );
    }
    return job;
  }

  function attachTerminal(jobId = "", terminalSessionId = "") {
    const job = requireJob(jobId);
    job.terminalSessionId = normalizeText(terminalSessionId);
    return publicFixCodexJob(job);
  }

  function readJob(jobId = "") {
    return publicFixCodexJob(requireJob(jobId));
  }

  function reportJob(jobId = "", input = {}) {
    const job = requireJob(jobId);
    if (job.status !== "running") {
      throw vibe64Error(
        "Fix Codex job has already been reported.",
        "vibe64_fix_codex_already_reported"
      );
    }
    const token = normalizeText(input.token);
    if (!token || token !== job.reportToken) {
      throw vibe64Error(
        "Fix Codex report token is invalid.",
        "vibe64_fix_codex_token_invalid"
      );
    }
    job.status = normalizeFixStatus(input.status);
    job.message = normalizeText(input.message);
    job.verificationSummary = normalizeText(input.verificationSummary);
    job.completedAt = clock().toISOString();
    job.reportToken = "";
    return publicFixCodexJob(job);
  }

  return Object.freeze({
    attachTerminal,
    createJob,
    readJob,
    reportJob
  });
}

const defaultFixCodexJobStore = createFixCodexJobStore();

async function reportFixCodexJob({
  fixJobStore,
  input = {},
  jobId = ""
} = {}) {
  const fixJob = fixJobStore.reportJob(jobId, input);
  if (fixJob.terminalSessionId) {
    await closeTerminalSession(fixJob.terminalSessionId, {
      namespace: fixCodexTerminalNamespace(jobId)
    });
  }
  return fixJob;
}

function helperRuntimeHostDir(targetRoot = "") {
  return path.join(path.resolve(targetRoot), ".vibe64", "runtime");
}

function helperSocketHostPath(targetRoot = "") {
  return path.join(helperRuntimeHostDir(targetRoot), FIX_CODEX_HELPER_SOCKET_NAME);
}

function helperSocketContainerPath() {
  return path.posix.join(FIX_CODEX_HELPER_SOCKET_CONTAINER_DIR, FIX_CODEX_HELPER_SOCKET_NAME);
}

function helperScriptHostPath(targetRoot = "") {
  return path.join(helperRuntimeHostDir(targetRoot), FIX_CODEX_HELPER_SCRIPT_NAME);
}

function helperMount(targetRoot = "") {
  return {
    source: helperRuntimeHostDir(targetRoot),
    target: FIX_CODEX_HELPER_SOCKET_CONTAINER_DIR
  };
}

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_FIX_CODEX_HELPER_BODY_BYTES) {
      const error = new Error("Fix Codex helper input is too large.");
      error.code = "vibe64_fix_codex_helper_input_too_large";
      throw error;
    }
  }
  try {
    const parsed = JSON.parse(body || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const error = new Error("Fix Codex helper input must be valid JSON.");
    error.code = "vibe64_fix_codex_helper_invalid_json";
    throw error;
  }
}

function sendJson(response, statusCode, payload = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function helperScriptSource() {
  return `#!/usr/bin/env node
import http from "node:http";
import process from "node:process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => resolve(text));
  });
}

async function payloadTextFromArgs(args) {
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) {
    const nextArg = args[jsonIndex + 1] || "";
    return nextArg && !nextArg.startsWith("--") ? nextArg : readStdin();
  }
  return readStdin();
}

function parsePayload(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim() || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Usage: vibe64-fix-codex-report --json '{\\"status\\":\\"fixed\\", ...}' or pipe JSON on stdin.");
  }
}

function postJsonToSocket({ payload, socketPath }) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/fix-codex/report",
      socketPath
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => resolve({
        statusCode: response.statusCode,
        text
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

const socketPath = process.env.VIBE64_FIX_CODEX_REPORT_SOCKET || "";
const jobId = process.env.VIBE64_FIX_CODEX_JOB_ID || "";
const token = process.env.VIBE64_FIX_CODEX_TOKEN || "";

try {
  if (!socketPath || !jobId || !token) {
    throw new Error("Vibe64 Fix Codex helper environment is not available.");
  }

  const payload = {
    ...parsePayload(await payloadTextFromArgs(process.argv.slice(2))),
    jobId,
    token
  };
  const response = await postJsonToSocket({
    payload,
    socketPath
  });
  process.stdout.write(response.text);
  if (Number(response.statusCode) >= 400) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(\`\${error?.message || error}\\n\`);
  process.exitCode = 1;
}
`;
}

function helperEnvironment({
  jobId = "",
  targetRoot = "",
  token = ""
} = {}) {
  return {
    VIBE64_FIX_CODEX_JOB_ID: normalizeText(jobId),
    VIBE64_FIX_CODEX_REPORT_HELPER: helperScriptHostPath(targetRoot),
    VIBE64_FIX_CODEX_REPORT_SOCKET: helperSocketContainerPath(),
    VIBE64_FIX_CODEX_TOKEN: normalizeText(token)
  };
}

async function writeHelperScript(targetRoot = "") {
  const scriptPath = helperScriptHostPath(targetRoot);
  await mkdir(path.dirname(scriptPath), {
    recursive: true
  });
  await writeFile(scriptPath, helperScriptSource(), "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function ensureFixCodexHelperServer({
  fixJobStore,
  targetRoot = ""
} = {}) {
  const socketPath = helperSocketHostPath(targetRoot);
  const existing = helperServers.get(socketPath);
  if (existing?.fixJobStore === fixJobStore) {
    return existing.server;
  }
  if (existing?.server) {
    await new Promise((resolve) => {
      existing.server.close(() => resolve());
    }).catch(() => null);
    helperServers.delete(socketPath);
  }

  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await rm(socketPath, {
    force: true
  });

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/fix-codex/report") {
      sendJson(response, 404, {
        ok: false,
        errors: [
          {
            code: "vibe64_fix_codex_helper_route_not_found",
            message: "Unknown Vibe64 Fix Codex helper route."
          }
        ]
      });
      return;
    }

    try {
      const input = await readRequestJson(request);
      const job = await reportFixCodexJob({
        fixJobStore,
        input,
        jobId: input.jobId
      });
      sendJson(response, 200, {
        fixJob: job,
        ok: true
      });
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_fix_codex_helper_request_failed",
        fallbackMessage: "Vibe64 Fix Codex helper request failed."
      });
      sendJson(response, vibe64StatusCode(payload), payload);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref?.();
  helperServers.set(socketPath, {
    fixJobStore,
    server
  });
  return server;
}

async function prepareFixCodexReportHelper({
  fixJobStore,
  jobId = "",
  targetRoot = "",
  token = ""
} = {}) {
  await ensureFixCodexHelperServer({
    fixJobStore,
    targetRoot
  });
  await writeHelperScript(targetRoot);
  return {
    env: helperEnvironment({
      jobId,
      targetRoot,
      token
    }),
    mount: helperMount(targetRoot)
  };
}

function fixCodexReportInstructions({
  job = {},
  token = ""
} = {}) {
  return [
    "Fix Codex reporting:",
    "When the fix is complete or blocked, report exactly once using the local Vibe64 Fix Codex callback before your final response.",
    "Do not finish with only a natural-language summary. The repair is not complete until this helper command returns ok.",
    "Preferred helper command:",
    `node "$VIBE64_FIX_CODEX_REPORT_HELPER" --json '${JSON.stringify({
      status: "fixed",
      message: "What changed or what blocked the fix.",
      verificationSummary: "Commands run and results, or why verification was not possible."
    })}'`,
    "After the helper reports ok, give a short final summary. If the helper fails, report that failure in the terminal instead of claiming the fix is complete.",
    "Callback fields:",
    JSON.stringify({
      jobId: job.id || "",
      status: "fixed | blocked",
      token,
      message: "What changed or what blocked the fix.",
      verificationSummary: "Commands run and results, or why verification was not possible."
    }, null, 2)
  ].join("\n");
}

export {
  FIX_CODEX_JOB_STATUSES,
  createFixCodexJobStore,
  defaultFixCodexJobStore,
  fixCodexReportInstructions,
  prepareFixCodexReportHelper,
  publicFixCodexJob,
  reportFixCodexJob
};
