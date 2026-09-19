import { readFile } from "node:fs/promises";
import path from "node:path";
import { vibe64Driver } from "@local/vibe64-genesis/server/promptContext";

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

async function sessionEnvironmentForUpstreamSession(sessionId = "", client = null) {
  const environments = await sessionEnvironments();
  const visited = new Set();
  let id = text(sessionId);
  while (id && !visited.has(id) && visited.size < 32) {
    const selected = environments.find((entry) => text(entry?.upstreamSessionId) === id);
    if (selected) return selected;
    if (!client) return null;
    visited.add(id);
    const result = await client.session.get({ path: { id } });
    if (result.error) throw new Error("Vibe64 could not verify the subagent's parent session.");
    id = text(result.data?.parentID);
  }
  return null;
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

export const Vibe64SessionEnvironment = async ({ client } = {}) => ({
  "experimental.chat.system.transform": async (input = {}, output = {}) => {
    const selected = await sessionEnvironmentForUpstreamSession(input.sessionID || input.sessionId, client);
    if (selected?.promptContext?.scope === "session" &&
        selected.upstreamSessionId !== (input.sessionID || input.sessionId)) {
      // Genesis resolves the registered parent; native children inherit the
      // same managed capabilities through their verified ancestry here.
      const context = vibe64Driver(selected.promptContext);
      if (!output.system.includes(context)) output.system.push(context);
    }
    if (selected?.promptContext?.scope !== "ephemeral") return;
    // Non-project conversations have no Genesis project plugin. Their supplied
    // context replaces the coding-agent defaults, without changing user text.
    output.system.splice(0, output.system.length, vibe64Driver(selected.promptContext));
  },
  "chat.message": async (input = {}, output = {}) => {
    if (!text(input.agent).startsWith("vibe64-economy-")) return;
    const selected = await sessionEnvironmentForUpstreamSession(input.sessionID, client);
    if (!selected?.economyModelId || input.agent !== `vibe64-economy-${selected.modelProviderId}`) {
      throw new Error("This helper is not available through the session's selected AI account.");
    }
    output.message.model = { providerID: selected.modelProviderId, modelID: selected.economyModelId };
  },
  "chat.params": async (input = {}, output = {}) => {
    const selected = await sessionEnvironmentForUpstreamSession(input.sessionID, client);
    if (selected?.modelProviderId && input.model?.providerID !== selected.modelProviderId) {
      throw new Error("Assistants must use the session's selected AI account.");
    }
    if (text(input.agent).startsWith("vibe64-economy-")) {
      if (!selected?.economyModelId || input.agent !== `vibe64-economy-${selected.modelProviderId}` ||
          input.model?.providerID !== selected.modelProviderId || input.model?.id !== selected.economyModelId) {
        throw new Error("This helper is not available through the session's selected AI account.");
      }
    }
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
    output.messages = await Promise.all(messages.map(async (message) => {
      const selected = environments.find((entry) => (
        text(entry?.upstreamSessionId) === text(message?.info?.sessionID)
      )) || await sessionEnvironmentForUpstreamSession(message?.info?.sessionID, client);
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
    }));
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
    if (input.tool === "task") {
      const selected = await sessionEnvironmentForUpstreamSession(input.sessionID, client);
      if (text(output.args?.subagent_type).startsWith("vibe64-economy-") &&
          (!selected?.economyModelId || output.args.subagent_type !== `vibe64-economy-${selected.modelProviderId}`)) {
        throw new Error("Choose the helper belonging to this session's selected AI account.");
      }
      if (text(output.args?.task_id)) {
        const resumed = await sessionEnvironmentForUpstreamSession(output.args.task_id, client);
        if (!selected || resumed?.upstreamSessionId !== selected.upstreamSessionId) {
          throw new Error("This helper conversation does not belong to the current session.");
        }
      }
    }
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
      input.sessionID || input.sessionId, client
    );
    args.command = selected
      ? sessionCommand(args.command, selected)
      : unavailableCommand();
  }
});
