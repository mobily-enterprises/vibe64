import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readOpenCodeEnvironments, openCodeEnvironmentForDirectory, openCodeEnvironmentForSession,
  createOpenCodeConversationPlugin, assertOpenCodeModelProvider, limitOpenCodeModelOutput } from "@jskit-ai/assistant-core/server/opencode-process";
import { vibe64Driver } from "@local/vibe64-genesis/server/promptContext";

function text(value = "") {
  return String(value ?? "").trim();
}

async function sessionEnvironments() {
  return readOpenCodeEnvironments(text(process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY));
}

async function sessionEnvironment(cwd = "") {
  return openCodeEnvironmentForDirectory(await sessionEnvironments(), cwd);
}

async function sessionEnvironmentForUpstreamSession(sessionId = "", client = null) {
  try {
    return await openCodeEnvironmentForSession(await sessionEnvironments(), sessionId, client);
  } catch (error) {
    if (error.code === "assistant_opencode_parent_unverified") {
      throw new Error("Vibe64 could not verify the subagent's parent session.");
    }
    throw error;
  }
}

function isSelectedHelperAgent(agent, selected) {
  return Boolean(selected?.helperModelId && agent === `vibe64-helper-${selected.modelProviderId}`);
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

export const Vibe64SessionEnvironment = async ({ client } = {}) => {
  const common = await createOpenCodeConversationPlugin({ client,
    registryPath: text(process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY),
    resolveHostInstructions: async (id) => {
      const selected = await sessionEnvironmentForUpstreamSession(id, client);
      if (!selected?.promptContext) return { conversation: selected?.conversation, instructions: null };
      const { workdir, promptContext } = selected;
      if (promptContext.scope === "learning") {
        return { conversation: selected.conversation, instructions: {
          identity: JSON.stringify(promptContext),
          placement: "append",
          read: () => promptContext.instructions
        } };
      }
      if (promptContext.scope === "ephemeral") {
        return { conversation: selected.conversation, instructions: {
          identity: JSON.stringify(promptContext),
          placement: "replace",
          read: () => vibe64Driver(promptContext)
        } };
      }
      return { conversation: selected.conversation, instructions: {
        // Project guidance can change independently of the registry: read it
        // before every inference instead of supplying a cached revision.
        placement: "append",
        read: () => {
          // Keep the compiler and native indexers out of OpenCode's plugin process.
          // The fixed composer shares OpenCode's existing managed process group.
          const executable = fileURLToPath(new URL("../../bin/vibe64-genesis-host-context",
            import.meta.resolve("@local/vibe64-genesis/server/promptContext")));
          return new Promise((resolve, reject) => {
            const child = execFile(executable, ["--instructions"], {
              cwd: workdir, timeout: 30_000, maxBuffer: 256 * 1024, encoding: "utf8"
            }, (error, stdout) => {
              if (error) reject(new Error("Project instructions could not be loaded. Retry the conversation.", { cause: error }));
              else resolve(stdout);
            });
            child.stdin.on("error", () => {});
            child.stdin.end(JSON.stringify({ workdir, promptContext }));
          });
        }
      } };
    }
  });
  return {
    ...common,
    "chat.message": async (input = {}, output = {}) => {
      if (!text(input.agent).startsWith("vibe64-helper-")) return;
      const selected = await sessionEnvironmentForUpstreamSession(input.sessionID, client);
      if (!isSelectedHelperAgent(input.agent, selected)) {
        throw new Error("This helper is not available through the session's selected AI account.");
      }
      output.message.model = { providerID: selected.modelProviderId, modelID: selected.helperModelId };
    },
    "chat.params": async (input = {}, output = {}) => {
      const selected = await sessionEnvironmentForUpstreamSession(input.sessionID, client);
      assertOpenCodeModelProvider(selected, input);
      if (text(input.agent).startsWith("vibe64-helper-") && (
        !isSelectedHelperAgent(input.agent, selected) ||
        input.model?.providerID !== selected.modelProviderId || input.model?.id !== selected.helperModelId
      )) {
        throw new Error("This helper is not available through the session's selected AI account.");
      }
      limitOpenCodeModelOutput(input, output);
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
      if (selected.conversation) return common["shell.env"](input, output);
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
      const selected = await sessionEnvironmentForUpstreamSession(
        input.sessionID || input.sessionId, client
      );
      if (!selected) {
        throw new Error("Vibe64 could not verify this conversation's tool access. Reconnect the assistant.");
      }
      if (selected.conversation) return common["tool.execute.before"](input, output);
      if (selected.promptContext?.scope === "ephemeral") {
        throw new Error("Tools are unavailable in this host conversation. Use only the supplied context.");
      }
      if (input.tool === "task") {
        if (text(output.args?.subagent_type).startsWith("vibe64-helper-") &&
            !isSelectedHelperAgent(output.args.subagent_type, selected)) {
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
      args.command = sessionCommand(args.command, selected);
    }
  };
};
