import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  AGENT_PREVIEW_USAGE
} from "@local/vibe64-execution/server";
import {
  logsStdout,
  parsePreviewCommandArgs,
  previewInspectionUrl,
  previewStartStdout,
  previewStatusSummary,
  previewSummaryLines,
  statusStdout,
  waitForPreviewReady
} from "./agentPreviewStatusText.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { commandFailure } from "./commandFailure.js";

/** @typedef {import("./types.js").AgentPreviewWorkerRegistry} AgentPreviewWorkerRegistry */
/** @typedef {import("./types.js").OutputTargetTerminalController} OutputTargetTerminalController */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {typeof import("@local/vibe64-core/server/sessionUiSyncState").readSessionUiSyncStateForSession} ReadSessionUiSyncState */

/**
 * @param {RuntimeLogger} logger
 * @param {object} result
 * @param {object} fields
 */
function logPreviewCommandResult(logger, result = {}, fields = {}) {
  const ok = result.ok !== false && Number(result.exitCode || 0) === 0;
  logOperationalEvent(logger, ok ? "info" : "warn", {
    code: result.code || "",
    command: normalizeText(fields.command),
    component: "vibe64.agent_preview_command",
    cwd: normalizeText(fields.cwd),
    durationMs: Number(fields.durationMs || 0),
    event: "vibe64.agent_preview_command.finished",
    exitCode: Number(result.exitCode ?? (ok ? 0 : 1)),
    ok,
    outputTail: ok ? "" : sanitizeLogText(result.stderr || result.error || "").slice(-1000),
    sessionId: normalizeText(fields.sessionId)
  }, "Vibe64 agent preview command finished.");
}

/**
 * A status read that failed, as the command's result with its error on stderr.
 */
function failedStatusResult(status, fallbackError) {
  return {
    ...status,
    exitCode: 1,
    stderr: `${status.error || fallbackError}\n`
  };
}

/**
 * The `vibe64-helper preview` command line: status, targets, inspection URL,
 * logs, stop, ensure and restart, the project's managed app identities, and
 * the browser identity a Preview page asks for.
 * @param {object} dependencies
 * @param {AgentPreviewWorkerRegistry} dependencies.workerRegistry
 * @param {OutputTargetTerminalController} dependencies.launchTarget
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {ReadSessionUiSyncState} dependencies.readSessionUiState
 */
function createAgentPreviewCommandLine({
  workerRegistry,
  launchTarget,
  logger,
  project,
  readSessionUiState
}) {
  async function authorizeBrowserIdentity(sessionId = "", identity = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const requested = normalizeText(identity).toLowerCase();
    if (!normalizedSessionId) {
      return commandFailure(
        "Vibe64 preview command session id is required.",
        "vibe64_agent_preview_command_session_required"
      );
    }
    if (!requested) {
      return commandFailure(
        "Choose default, guest, or a configured managed app identity name.",
        "vibe64_agent_preview_identity_required"
      );
    }
    if (requested === "guest") {
      return launchTarget.selectPreviewIdentity(normalizedSessionId, {
        mode: "guest"
      });
    }
    return launchTarget.selectPreviewIdentity(normalizedSessionId, {
      identityName: requested,
      mode: "identity"
    });
  }

  /**
   * Managed app identities belong to the project; the session's bound project
   * and source scope every read and save, never a caller-supplied target.
   */
  async function previewIdentities(sessionId = "", args = [], stdin = "") {
    const words = (Array.isArray(args) ? args : []).map(normalizeText).filter(Boolean);
    const subcommand = words[1] || "";
    if (words[0] !== "identities" || words.length > (subcommand === "save" ? 2 : 1) || (subcommand && subcommand !== "save")) {
      return commandFailure(
        "Usage: vibe64-helper preview identities [save < identities.json]",
        "vibe64_agent_preview_identities_usage",
        { exitCode: 64 }
      );
    }
    const projectSlug = workerRegistry.sessionProjectSlug(sessionId);
    if (!projectSlug) {
      return commandFailure(
        "Managed app identities are not bound to this session's project. Reconnect the assistant.",
        "vibe64_agent_preview_identities_project_required"
      );
    }
    return project.runInProjectContext(projectSlug, async () => {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return status;
      const identityTypes = [...new Set((status.outputTargets || []).flatMap((target) => target.identityTypes || []))];
      let result;
      if (subcommand === "save") {
        let identities = null;
        try {
          const value = JSON.parse(String(stdin || ""));
          identities = Array.isArray(value) ? value : value?.identities;
        } catch {
          // Invalid JSON is reported with the usage error below.
        }
        if (!Array.isArray(identities)) {
          return commandFailure(
            "Provide the complete ordered identity list as a JSON array on stdin.",
            "vibe64_agent_preview_identities_input_invalid",
            { exitCode: 64 }
          );
        }
        const undeclared = identities.filter((identity) => !identityTypes.includes(normalizeText(identity?.type)));
        if (undeclared.length) {
          return commandFailure(
            identityTypes.length
              ? `Identity types must be ones this project's Stack declares in #### Preview identity: ${identityTypes.join(", ")}.`
              : "This project's Stack declares no #### Preview identity types; add the application's Preview identity command first (vibe64-helper spec outputs).",
            "vibe64_agent_preview_identities_type_undeclared"
          );
        }
        result = await project.savePreviewApplicationIdentities({ identities, sessionId });
      } else {
        result = await project.readPreviewApplicationIdentities({ sessionId });
      }
      return result?.ok === false ? result : {
        exitCode: 0,
        ok: true,
        stdout: `${JSON.stringify({ identities: result.identities, identityTypes }, null, 2)}\n`
      };
    });
  }

  /**
   * The Preview state the session's editor last synced.
   */
  function previewState(sessionId = "") {
    return readSessionUiState(sessionId)?.preview || null;
  }

  function statusSummary(status = {}, sessionId = "") {
    return previewStatusSummary(status, {
      previewState: previewState(sessionId)
    });
  }

  function inspectionUrl(status = {}, sessionId = "") {
    return previewInspectionUrl(status, {
      previewState: previewState(sessionId)
    });
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const parsed = parsePreviewCommandArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    const baseFields = {
      command: parsed.command,
      cwd: normalizeText(input.cwd),
      sessionId
    };
    const finish = (result = {}) => {
      logPreviewCommandResult(logger, result, {
        ...baseFields,
        durationMs: Date.now() - startedAtMs
      });
      return result;
    };

    if (!sessionId) {
      return finish(commandFailure("Vibe64 preview command session id is required.", "vibe64_agent_preview_command_session_required"));
    }
    if (parsed.error) return finish(commandFailure(parsed.error, "vibe64_preview_target_invalid"));
    if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
      return finish({
        exitCode: 0,
        ok: true,
        stdout: AGENT_PREVIEW_USAGE
      });
    }
    if (["status", "targets"].includes(parsed.command)) {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return finish(failedStatusResult(status, "Vibe64 preview status failed."));
      if (parsed.command === "targets") {
        const targets = (status.outputTargets || []).map((target) => ({
          id: target.id,
          label: target.label,
          default: target.default === true,
          available: target.available !== false,
          presentation: target.presentation?.kind || "",
          disabledReason: target.disabledReason || ""
        }));
        const output = parsed.json
          ? JSON.stringify({ targets }, null, 2)
          : targets.map((target) => {
            const reason = target.disabledReason ? ` — ${target.disabledReason}` : "";
            return `${target.id}: ${target.label} (${target.presentation})${reason}`;
          }).join("\n");
        return finish({
          ok: true,
          exitCode: 0,
          stdout: `${output}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: statusStdout(statusSummary(status, sessionId), {
          json: parsed.json
        })
      });
    }
    if (parsed.command === "inspect-url") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return finish(failedStatusResult(status, "Vibe64 preview status failed."));
      const url = inspectionUrl(status, sessionId);
      if (!url) {
        return finish(commandFailure(
          "Managed preview inspection URL is unavailable. Run vibe64-helper preview ensure --wait --json first.",
          "vibe64_agent_preview_command_inspection_url_unavailable",
          {
            exitCode: 1
          }
        ));
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: `${url}\n`
      });
    }
    if (parsed.command === "logs") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return finish(failedStatusResult(status, "Vibe64 preview logs failed."));
      return finish({
        exitCode: 0,
        ok: true,
        stdout: logsStdout(status, {
          json: parsed.json,
          lines: parsed.lines
        })
      });
    }
    if (parsed.command === "stop") {
      const current = await launchTarget.launchStatus(sessionId);
      if (current?.ok === false) return finish({ ...current, exitCode: 1, stderr: `${current.error}\n` });
      const stopped = await launchTarget.stopTerminal(sessionId, current.activeTerminal?.id || "");
      if (stopped?.ok === false) return finish({ ...stopped, exitCode: 1, stderr: `${stopped.error}\n` });
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) return finish({ ...status, exitCode: 1, stderr: `${status.error}\n` });
      const summary = statusSummary(status, sessionId);
      return finish({
        ok: true,
        exitCode: 0,
        stdout: parsed.json
          ? `${JSON.stringify(summary, null, 2)}\n`
          : `${previewSummaryLines(summary).join("\n")}\n`
      });
    }
    if (parsed.command === "identities") {
      const result = await previewIdentities(sessionId, input.args, input.stdin);
      return finish(result?.ok === false
        ? { ...result, exitCode: result.exitCode || 1, stderr: `${result.error || "Managed app identities failed."}\n` }
        : result);
    }
    if (!["ensure", "restart"].includes(parsed.command)) {
      return finish(commandFailure(`Unknown Vibe64 preview command: ${parsed.command}`, "vibe64_agent_preview_command_unknown", {
        exitCode: 2,
        stderr: AGENT_PREVIEW_USAGE
      }));
    }
    const ensuring = parsed.command === "ensure";

    let started;
    if (ensuring) {
      started = parsed.targetId
        ? await launchTarget.ensurePreview(sessionId, { outputTargetId: parsed.targetId })
        : await launchTarget.ensurePreview(sessionId);
    } else {
      started = await launchTarget.restartPreview(sessionId);
    }
    if (started?.ok === false) {
      return finish({
        ...started,
        exitCode: 1,
        stderr: `${started.error || (ensuring ? "Vibe64 managed preview could not start." : "Vibe64 preview restart failed.")}\n`
      });
    }
    let status = await launchTarget.launchStatus(sessionId);
    if (parsed.wait) {
      const waited = await waitForPreviewReady(launchTarget, sessionId, {
        terminalSessionId: started.id,
        timeoutMs: parsed.timeoutMs
      });
      status = waited.status || status;
      if (!waited.ok) {
        const timedOut = waited.timeout === true;
        const summary = statusSummary(status || {}, sessionId);
        return finish(commandFailure(
          timedOut
            ? "Timed out waiting for Vibe64 preview to become ready."
            : "Vibe64 preview did not become ready.",
          timedOut ? "vibe64_agent_preview_command_wait_timeout" : "vibe64_agent_preview_command_not_ready",
          {
            exitCode: 1,
            stdout: previewStartStdout({
              ...summary,
              timedOut
            }, {
              command: parsed.command,
              json: parsed.json
            })
          }
        ));
      }
    }
    return finish({
      exitCode: 0,
      ok: true,
      stdout: previewStartStdout(statusSummary(status || {}, sessionId), {
        command: parsed.command,
        json: parsed.json
      })
    });
  }

  return Object.freeze({
    authorizeBrowserIdentity,
    run
  });
}

export {
  createAgentPreviewCommandLine
};
