import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  Vibe64SessionEnvironment
} from "../../packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js";

function wrappedCommand(wrapperPath, command) {
  return [wrapperPath, command].map((value) => `'${value.replaceAll("'", `'"'"'`)}'`).join(" ");
}

test("the OpenCode plugin loads without Genesis compiler or native parser modules", async () => {
  const pluginUrl = new URL("../../packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js", import.meta.url).href;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith("genesis-compiler") || specifier.startsWith("@ast-grep/")) {
        throw new Error("Native compiler dependency loaded by the OpenCode plugin: " + specifier);
      }
      return next(specifier, context);
    } });
    const { Vibe64SessionEnvironment } = await import(${JSON.stringify(pluginUrl)});
    await Vibe64SessionEnvironment();
  `]);
});

test("OpenCode raises output only for models with an advertised output limit", async () => {
  const plugin = await Vibe64SessionEnvironment();
  for (const [advertisedOutputTokenLimit, expectedOutputTokens] of [
    [131_072, 131_072],
    [65_536, 65_536],
    [16_384, 16_384],
    [0, 32_000],
    [undefined, 32_000]
  ]) {
    const output = { maxOutputTokens: 131_072 };
    await plugin["chat.params"]({
      model: {
        limit: { output: advertisedOutputTokenLimit }
      }
    }, output);
    assert.equal(output.maxOutputTokens, expectedOutputTokens);
  }
});

test("tool-free non-project conversations receive their own current system context without a project plugin", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-ephemeral-context-"));
  const registryPath = path.join(temporaryRoot, "sessions.json");
  const previousRegistry = process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
  t.after(async () => {
    if (previousRegistry === undefined) delete process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
    else process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = previousRegistry;
    await rm(temporaryRoot, { force: true, recursive: true });
  });
  const scope = { scope: "ephemeral", stableContext: "You have no tools or shell. Trusted host snapshot: active." };
  const sessions = [{ upstreamSessionId: "private-conversation", promptContext: scope }, {
    upstreamSessionId: "project-conversation",
    promptContext: { scope: "session" }
  }];
  await writeFile(registryPath, JSON.stringify({ sessions }));
  process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = registryPath;
  const plugin = await Vibe64SessionEnvironment();
  const transform = plugin["experimental.chat.system.transform"];
  const output = { system: ["You are a coding agent. Inspect the project."] };
  const system = output.system;
  await transform({ sessionID: "private-conversation" }, output);
  assert.equal(output.system, system);
  assert.deepEqual(system, [scope.stableContext]);

  scope.stableContext = "You have no tools or shell. Refreshed host snapshot: stopped.";
  await writeFile(registryPath, JSON.stringify({ sessions }));
  await transform({ sessionID: "private-conversation" }, output);
  await transform({ sessionID: "private-conversation" }, output);
  assert.deepEqual(output.system, [scope.stableContext]);

  for (const sessionID of ["project-conversation", "unregistered-conversation", ""]) {
    const ordinary = { system: ["Original project or provider guidance."] };
    await transform({ sessionID }, ordinary);
    assert.deepEqual(ordinary.system, ["Original project or provider guidance."]);
  }
  const messages = { messages: [{
    info: { role: "user", sessionID: "private-conversation" },
    parts: [{ type: "text", text: "What is wrong?\nPlease explain." }]
  }] };
  const authored = structuredClone(messages);
  await plugin["experimental.chat.messages.transform"]({}, messages);
  assert.deepEqual(messages, authored);
  const tool = { args: { command: "ls -la /private/conversation" } };
  await plugin["tool.execute.before"]({ sessionID: "private-conversation", tool: "bash" }, tool);
  assert.match(tool.args.command, /vibe64_agent_control_unavailable/u);
  assert.match(tool.args.command, /exit 126/u);

  scope.stableContext = "";
  await writeFile(registryPath, JSON.stringify({ sessions }));
  await assert.rejects(transform({ sessionID: "private-conversation" }, output), /bounded stableContext/u);
});

test("OpenCode binds shell commands once and hides the session wrapper from model history", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-session-environment-"));
  const registryPath = path.join(temporaryRoot, "sessions.json");
  const wrapperPath = "/managed/attachments/session-command/current/vibe64-session-command";
  const previousRegistry = process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
  try {
    await writeFile(registryPath, JSON.stringify({
      sessions: [{
        env: {
          VIBE64_WRAPPER: wrapperPath
        },
        upstreamSessionId: "upstream-session-1",
        workdir: "/managed/sessions/session-1/source"
      }]
    }));
    process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = registryPath;
    const plugin = await Vibe64SessionEnvironment();
    const command = "/usr/bin/google-chrome --headless https://example.test &";
    const output = {
      args: { command }
    };

    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, output);

    const wrapped = wrappedCommand(wrapperPath, command);
    assert.equal(output.args.command, wrapped);

    const copiedWrapper = {
      args: { command: wrapped }
    };
    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, copiedWrapper);
    assert.equal(copiedWrapper.args.command, wrapped);

    const nestedWrapper = wrappedCommand(wrapperPath, wrapped);
    const copiedNestedWrapper = {
      args: { command: nestedWrapper }
    };
    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "shell"
    }, copiedNestedWrapper);
    assert.equal(copiedNestedWrapper.args.command, wrapped);

    const quotedWrapper = wrappedCommand(wrapperPath, "printf '%s\\n' \"$HOME\" | cat\n# café");
    const copiedQuotedWrapper = {
      args: { command: quotedWrapper }
    };
    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, copiedQuotedWrapper);
    assert.equal(
      copiedQuotedWrapper.args.command,
      wrappedCommand(wrapperPath, "printf '%s\\n' \"$HOME\" | cat\n# café")
    );

    const storedPart = {
      state: {
        input: { command: nestedWrapper },
        status: "completed"
      },
      tool: "bash",
      type: "tool"
    };
    const history = {
      messages: [{
        info: { sessionID: "upstream-session-1" },
        parts: [
          storedPart,
          {
            state: {
              input: { command: quotedWrapper },
              status: "completed"
            },
            tool: "bash",
            type: "tool"
          },
          {
            state: {
              input: { command: "printf ordinary" },
              status: "completed"
            },
            tool: "shell",
            type: "tool"
          }
        ]
      }, {
        info: { sessionID: "another-session" },
        parts: [storedPart]
      }]
    };
    await plugin["experimental.chat.messages.transform"]({}, history);
    assert.equal(history.messages[0].parts[0].state.input.command, command);
    assert.equal(history.messages[0].parts[1].state.input.command, "printf '%s\\n' \"$HOME\" | cat\n# café");
    assert.equal(history.messages[0].parts[2].state.input.command, "printf ordinary");
    assert.equal(history.messages[1].parts[0].state.input.command, nestedWrapper);
    assert.equal(storedPart.state.input.command, nestedWrapper);

    const unknown = {
      args: { command: "pwd" }
    };
    await plugin["tool.execute.before"]({
      sessionID: "another-session",
      tool: "bash"
    }, unknown);
    assert.match(unknown.args.command, /vibe64_agent_control_unavailable/u);
    assert.match(unknown.args.command, /exit 126/u);
  } finally {
    if (previousRegistry === undefined) {
      delete process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
    } else {
      process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = previousRegistry;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("native child helpers inherit only their registered parent's account, command control, and Helper preference", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-child-boundary-"));
  const registryPath = path.join(root, "sessions.json");
  const previous = process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
  t.after(async () => {
    if (previous === undefined) delete process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
    else process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = previous;
    await rm(root, { recursive: true, force: true });
  });
  const sessions = [{
    upstreamSessionId: "shared-parent", modelProviderId: "deepseek", economyModelId: "chosen-helper",
    promptContext: { scope: "session", conversationKind: "main", session: {
      managedGit: true, managedPreview: false, managedEnvironment: false, managedDatabaseRefresh: false
    } },
    env: { VIBE64_WRAPPER: "/managed/shared-session-wrapper" }
  }, {
    upstreamSessionId: "owner-parent", modelProviderId: "zai-coding-plan", economyModelId: "glm-5-flash",
    env: { VIBE64_WRAPPER: "/managed/owner-session-wrapper" }
  }];
  await writeFile(registryPath, JSON.stringify({ sessions }));
  process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = registryPath;
  const parents = { child: "shared-parent", grandchild: "child", "owner-child": "owner-parent", loop: "loop" };
  let reads = 0;
  const plugin = await Vibe64SessionEnvironment({ client: { session: {
    async get({ path: { id } }) {
      reads += 1;
      if (id === "broken") return { error: new Error("Unavailable") };
      return { data: { id, parentID: parents[id] } };
    }
  } } });
  for (const sessionID of ["shared-parent", "child", "grandchild"]) {
    const command = { args: { command: "git status --short" } };
    await plugin["tool.execute.before"]({ sessionID, tool: "bash" }, command);
    assert.equal(command.args.command, wrappedCommand(sessions[0].env.VIBE64_WRAPPER, "git status --short"));
    await plugin["tool.execute.before"]({ sessionID, tool: "bash" }, command);
    assert.equal(command.args.command, wrappedCommand(sessions[0].env.VIBE64_WRAPPER, "git status --short"));
    const history = { messages: [{ info: { sessionID }, parts: [{ type: "tool", tool: "bash", state: { input: command.args } }] }] };
    await plugin["experimental.chat.messages.transform"]({}, history);
    assert.equal(history.messages[0].parts[0].state.input.command, "git status --short");
    await plugin["tool.execute.before"]({ sessionID, tool: "task" }, { args: { subagent_type: "vibe64-economy-deepseek" } });
    const output = { message: { model: { providerID: "deepseek", modelID: "old-default" } } };
    await plugin["chat.message"]({ sessionID, agent: "vibe64-economy-deepseek" }, output);
    assert.deepEqual(output.message.model, { providerID: "deepseek", modelID: "chosen-helper" });
    await plugin["chat.params"]({ sessionID, agent: "vibe64-economy-deepseek", model: { providerID: "deepseek", id: "chosen-helper" } }, {});
    // Task filtering alone is insufficient: native @mentions can bypass it.
    await assert.rejects(plugin["tool.execute.before"]({ sessionID, tool: "task" }, { args: { subagent_type: "vibe64-economy-zai-coding-plan" } }), /selected AI account/u);
    await assert.rejects(plugin["chat.message"]({ sessionID, agent: "vibe64-economy-zai-coding-plan" }, { message: {} }), /selected AI account/u);
    await assert.rejects(plugin["chat.params"]({ sessionID, agent: "vibe64-economy-zai-coding-plan", model: { providerID: "zai-coding-plan", id: "glm-5-flash" } }, {}), /selected AI account/u);
    await assert.rejects(plugin["chat.params"]({ sessionID, agent: "vibe64-economy-deepseek", model: { providerID: "zai-coding-plan", id: "glm-5-flash" } }, {}), /selected AI account/u);
  }
  await plugin["tool.execute.before"]({ sessionID: "shared-parent", tool: "task" }, { args: { subagent_type: "vibe64-economy-deepseek", task_id: "grandchild" } });
  const inherited = { system: ["Project guidance"] };
  await plugin["experimental.chat.system.transform"]({ sessionID: "grandchild" }, inherited);
  await plugin["experimental.chat.system.transform"]({ sessionID: "grandchild" }, inherited);
  assert.equal(inherited.system.length, 2);
  assert.match(inherited.system[1], /managed `git` and `gh` commands/u);
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "shared-parent", tool: "task" }, { args: { subagent_type: "vibe64-economy-deepseek", task_id: "owner-child" } }), /does not belong/u);
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "shared-parent", tool: "task" }, { args: { subagent_type: "general", task_id: "owner-child" } }), /does not belong/u);
  await assert.rejects(plugin["chat.params"]({ sessionID: "grandchild", agent: "general", model: { providerID: "zai-coding-plan", id: "glm-5-flash" } }, {}), /selected AI account/u);
  const owner = { message: {} };
  await plugin["chat.message"]({ sessionID: "owner-child", agent: "vibe64-economy-zai-coding-plan" }, owner);
  assert.equal(owner.message.model.providerID, "zai-coding-plan");
  for (const sessionID of ["unknown", "loop"]) {
    const output = { args: { command: "pwd" } };
    await plugin["tool.execute.before"]({ sessionID, tool: "bash" }, output);
    assert.match(output.args.command, /exit 126/u);
    await assert.rejects(plugin["chat.message"]({ sessionID, agent: "vibe64-economy-deepseek" }, { message: {} }), /selected AI account/u);
  }
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "broken", tool: "bash" }, { args: { command: "pwd" } }), /could not verify/u);
  assert.ok(reads < 100, "Parent cycles must terminate");
  sessions[0].economyModelId = "";
  await writeFile(registryPath, JSON.stringify({ sessions }));
  await assert.rejects(plugin["chat.message"]({ sessionID: "child", agent: "vibe64-economy-deepseek" }, { message: {} }), /selected AI account/u);
});
