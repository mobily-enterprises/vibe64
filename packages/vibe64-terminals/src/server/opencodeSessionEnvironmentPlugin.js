import { readFile } from "node:fs/promises";
import path from "node:path";
import { vibe64Driver } from "@local/vibe64-genesis/server";

const OPENCODE_UNDECLARED_OUTPUT_TOKEN_MAX = 32_000;

function text(value = "") {
  return String(value ?? "").trim();
}

function pathContains(root = "", candidate = "") {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sessionEnvironments() {
  const registryPath = text(process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY);
  if (!registryPath) {
    return [];
  }
  const source = JSON.parse(await readFile(registryPath, "utf8"));
  return Array.isArray(source?.sessions) ? source.sessions : [];
}

async function sessionEnvironment(cwd = "") {
  const normalizedCwd = path.resolve(text(cwd) || process.cwd());
  return (await sessionEnvironments())
    .filter((entry) => text(entry?.workdir) && pathContains(path.resolve(entry.workdir), normalizedCwd))
    .sort((left, right) => path.resolve(right.workdir).length - path.resolve(left.workdir).length)[0] || null;
}

async function sessionEnvironmentForUpstreamSession(sessionId = "") {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  return (await sessionEnvironments()).find((entry) => (
    text(entry?.upstreamSessionId) === normalizedSessionId
  )) || null;
}

function shellQuote(value = "") {
  return `'${String(value ?? "").replaceAll("'", `'"'"'`)}'`;
}

function unavailableCommand() {
  return "printf '%s\\n' 'vibe64_agent_control_unavailable: Session command control is unavailable. Reconnect the assistant.' >&2; exit 126";
}

function unwrapSessionCommand(command = "", selected = null) {
  const original = String(command);
  const wrapperPath = text(selected?.env?.VIBE64_WRAPPER);
  if (!wrapperPath) {
    return original;
  }
  const prefix = `${shellQuote(wrapperPath)} '`;
  if (!original.startsWith(prefix) || !original.endsWith("'")) {
    return original;
  }
  const decoded = original.slice(prefix.length, -1).replaceAll(`'"'"'`, "'");
  return `${shellQuote(wrapperPath)} ${shellQuote(decoded)}` === original
    ? decoded
    : original;
}

function ordinarySessionCommand(command = "", selected = null) {
  let ordinary = String(command);
  let unwrapped = unwrapSessionCommand(ordinary, selected);
  while (unwrapped !== ordinary) {
    ordinary = unwrapped;
    unwrapped = unwrapSessionCommand(ordinary, selected);
  }
  return ordinary;
}

function sessionCommand(command = "", selected = null) {
  const wrapperPath = text(selected?.env?.VIBE64_WRAPPER);
  if (!wrapperPath) {
    return unavailableCommand();
  }
  const ordinary = ordinarySessionCommand(command, selected);
  return [
    shellQuote(wrapperPath),
    shellQuote(ordinary)
  ].join(" ");
}

export const Vibe64SessionEnvironment = async () => ({
  "experimental.chat.system.transform": async (input = {}, output = {}) => {
    const selected = await sessionEnvironmentForUpstreamSession(input.sessionID || input.sessionId);
    if (selected?.promptContext?.scope !== "ephemeral") return;
    // Non-project conversations have no Genesis project plugin. Their supplied
    // context replaces the coding-agent defaults, without changing user text.
    output.system.splice(0, output.system.length, vibe64Driver(selected.promptContext));
  },
  "chat.params": async (input = {}, output = {}) => {
    const advertisedOutputTokenLimit = input.model?.limit?.output;
    const supportedOutputTokenLimit = (
      Number.isSafeInteger(advertisedOutputTokenLimit) && advertisedOutputTokenLimit > 0
    )
      ? advertisedOutputTokenLimit
      : OPENCODE_UNDECLARED_OUTPUT_TOKEN_MAX;
    if (
      Number.isSafeInteger(output.maxOutputTokens) &&
      output.maxOutputTokens > supportedOutputTokenLimit
    ) {
      output.maxOutputTokens = supportedOutputTokenLimit;
    }
  },
  "experimental.chat.messages.transform": async (...hookArguments) => {
    const output = hookArguments[1] || {};
    const messages = Array.isArray(output.messages) ? output.messages : [];
    const environments = await sessionEnvironments();
    output.messages = messages.map((message) => {
      const selected = environments.find((entry) => (
        text(entry?.upstreamSessionId) === text(message?.info?.sessionID)
      ));
      if (!selected || !Array.isArray(message?.parts)) {
        return message;
      }
      let changed = false;
      const parts = message.parts.map((part) => {
        if (
          part?.type !== "tool" ||
          !["bash", "shell"].includes(text(part.tool).toLowerCase()) ||
          typeof part?.state?.input?.command !== "string"
        ) {
          return part;
        }
        const command = ordinarySessionCommand(part.state.input.command, selected);
        if (command === part.state.input.command) {
          return part;
        }
        changed = true;
        return {
          ...part,
          state: {
            ...part.state,
            input: {
              ...part.state.input,
              command
            }
          }
        };
      });
      return changed ? { ...message, parts } : message;
    });
  },
  "shell.env": async (input = {}, output = {}) => {
    const selected = await sessionEnvironment(input.cwd);
    if (!selected) {
      return;
    }
    const env = selected.env && typeof selected.env === "object" && !Array.isArray(selected.env)
      ? selected.env
      : {};
    const outputEnv = output.env && typeof output.env === "object" && !Array.isArray(output.env)
      ? output.env
      : {};
    output.env = outputEnv;
    Object.assign(outputEnv, env);
    const pathEntries = Array.isArray(selected.pathEntries)
      ? selected.pathEntries.map(text).filter(Boolean)
      : [];
    outputEnv.PATH = [
      ...pathEntries,
      text(env.PATH),
      text(process.env.PATH)
    ].filter(Boolean).join(path.delimiter);
  },
  "tool.execute.before": async (input = {}, output = {}) => {
    if (!["bash", "shell"].includes(text(input.tool).toLowerCase())) {
      return;
    }
    const args = output.args && typeof output.args === "object" && !Array.isArray(output.args)
      ? output.args
      : null;
    if (!args || typeof args.command !== "string") {
      return;
    }
    const selected = await sessionEnvironmentForUpstreamSession(
      input.sessionID || input.sessionId
    );
    args.command = selected
      ? sessionCommand(args.command, selected)
      : unavailableCommand();
  }
});
