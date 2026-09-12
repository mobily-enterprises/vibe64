import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionEnvironment
} from "../../packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js";

function wrappedCommand(wrapperPath, command) {
  return [wrapperPath, command].map((value) => `'${value.replaceAll("'", `'"'"'`)}'`).join(" ");
}

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
