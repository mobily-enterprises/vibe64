import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Controlled executable protocols transposed from the existing shared Codex and
// Claude conversation fixtures. Production drivers, storage and tools stay real.
export async function createControlledColleagueNativeCommands(root, responses) {
  const directory = path.join(root, "controlled-native");
  await mkdir(path.join(directory, "claude"), { recursive: true });
  const trace = path.join(directory, "trace.jsonl");
  const account = path.join(directory, "account.txt");
  const queue = path.join(directory, "responses.json");
  const codex = path.join(directory, "codex.mjs");
  const claude = path.join(directory, "claude.mjs");
  await writeFile(account, "owner@example.test");
  await writeFile(path.join(directory, "claude", ".credentials.json"), "owner@example.test");
  await writeFile(queue, JSON.stringify(responses));
  await writeFile(codex, `#!${process.execPath}
    import { createServer } from "node:http";
    import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
    import { randomUUID } from "node:crypto";
    import { WebSocketServer } from ${JSON.stringify(import.meta.resolve("ws"))};
    const args = process.argv.slice(2);
    if (args.includes("debug") && args.includes("models")) {
      process.stdout.write(JSON.stringify({ models: [{ slug: "test-model", priority: 0 }] }));
      process.exit(0);
    }
    const socket = args[args.indexOf("--listen") + 1].slice(7);
    const log = value => appendFileSync(process.env.TEST_TRACE, JSON.stringify(value) + "\\n");
    log({ args });
    const file = process.env.TEST_HISTORY;
    const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const threads = new Map((saved?.threads || (saved ? [saved] : []))
      .map(thread => [thread.id, { thread, loaded: false, runningTurn: null }]));
    const save = () => {
      const histories = [...threads.values()].map(state => state.thread);
      writeFileSync(file, JSON.stringify(histories.length === 1 ? histories[0] : { threads: histories }));
    };
    const server = createServer();
    const wss = new WebSocketServer({ server });
    const toolRequests = new Map();
    let requestId = 0;
    wss.on("connection", ws => ws.on("message", async data => {
      const { id, method, params = {}, result, error } = JSON.parse(data);
      if (!method) {
        log({ toolResponse: { id, result, error } });
        const pending = toolRequests.get(id); toolRequests.delete(id);
        if (error) pending.reject(new Error(error.message)); else pending.resolve(result);
        return;
      }
      const state = threads.get(params.threadId) || { thread: null, loaded: false, runningTurn: null };
      let thread = state.thread;
      log({ method, params });
      const reply = result => ws.send(JSON.stringify({ id, result }));
      if (["thread/read", "thread/turns/list"].includes(method) && existsSync(file + ".unavailable")) {
        ws.send(JSON.stringify({ id, error: { code: -32000, message: "Native history is temporarily unavailable" } }));
        return;
      }
      const emit = (method, params) => {
        const notification = { method, params: { threadId: thread.id, ...params } };
        log({ notification });
        ws.send(JSON.stringify(notification));
      };
      const callTool = (turn, tool, arguments_, foreign = false) => new Promise((resolve, reject) => {
        const id = "tool-request-" + (++requestId);
        toolRequests.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method: "item/tool/call", params: {
          threadId: foreign ? "another-thread" : thread.id, turnId: turn.id,
          callId: turn.id + "-" + requestId, tool, arguments: arguments_
        } }));
      });

      if (method === "initialize") {
        while (process.env.TEST_STARTUP_WAIT && !existsSync(process.env.TEST_STARTUP_WAIT) && ws.readyState === 1) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (ws.readyState === 1) reply({});
        return;
      }
      if (method === "initialized") return;
      if (method === "account/read") return reply({ account: { type: "chatgpt", email: readFileSync(process.env.TEST_ACCOUNT, "utf8") } });
      if (method === "config/read") return reply({ config: { mcp_servers: { ambient: {} } } });
      if (method === "hooks/list") {
        const flag = args.find(arg => arg.startsWith("hooks.PreToolUse="));
        const trusted = args.some(arg => arg.startsWith("hooks.state="));
        const hooks = [{ key: "ambient", source: "project", enabled: !trusted }];
        if (flag) hooks.push({ key: "command", source: "sessionFlags",
          eventName: "preToolUse", handlerType: "command", currentHash: "sha256:owned", enabled: true,
          trustStatus: trusted ? "trusted" : "untrusted", command: JSON.parse(flag.match(/command=(.*),timeout=30/u)[1]) });
        return reply({ data: [{ cwd: params.cwds[0], hooks, errors: [] }] });
      }
      if (method === "thread/start") {
        thread = { id: randomUUID(), historyMode: "paginated", modelProvider: params.modelProvider,
          environment: params.config.shell_environment_policy.set,
          goalsEnabled: params.config.features.goals, turns: [] };
        state.thread = thread; state.loaded = true; threads.set(thread.id, state); save();
        return reply({ thread, modelProvider: thread.modelProvider });
      }
      if (method === "thread/read") return reply({ thread: { ...thread,
        status: { type: !state.loaded ? "notLoaded" : state.runningTurn?.status === "inProgress" ? "active" : "idle" } } });
      if (method === "thread/turns/list") {
        const data = structuredClone([...thread.turns].reverse());
        const delayMs = params.itemsView === "full" ? state.completionReadDelayMs || 0 : 0;
        if (delayMs) {
          state.completionReadDelayMs = 0;
          log({ historyReadHeld: { threadId: thread.id, turnId: state.runningTurn.id, delayMs } });
          await new Promise(resolve => setTimeout(resolve, delayMs));
          log({ historyReadReturned: { threadId: thread.id, turnId: state.runningTurn.id } });
        }
        return reply({ data, nextCursor: null });
      }
      if (method === "thread/resume") { state.loaded = true; thread.modelProvider = params.modelProvider;
        thread.environment = params.config.shell_environment_policy.set;
        thread.goalsEnabled = params.config.features.goals; save(); return reply({ thread, modelProvider: thread.modelProvider }); }

      if (method === "thread/goal/get") return reply({ goal: thread?.goal || null });
      if (method === "thread/unsubscribe") { state.loaded = false; return reply({ status: "unsubscribed" }); }
      if (method === "turn/interrupt") {
        if (existsSync(file + ".refuse-interrupt")) {
          ws.send(JSON.stringify({ id, error: { code: -32602, message: "Controlled native interrupt refusal" } }));
          return;
        }
        if (state.runningTurn?.id === params.turnId) state.runningTurn.status = "interrupted";
        save();
        reply({});
        if (state.runningTurn?.id === params.turnId) emit("turn/completed", { turn: state.runningTurn });
        return;
      }

      if (method === "thread/inject_items" || method === "thread/name/set") return reply({});

      if (method === "turn/start") {
        const text = params.input[0].text;
        if (text === "rejected") return ws.send(JSON.stringify({ id, error: { code: -32602, message: "Turn rejected" } }));
        const turn = { id: randomUUID(), status: "inProgress", items: [{ id: "user", type: "userMessage", clientId: params.clientUserMessageId, content: params.input }] };
        state.runningTurn = turn;
        thread.turns.push(turn); save();
        emit("turn/started", { turn });
        if (text === "lost") return;
        reply({ turn });
        const emitTurn = (method, value) => emit(method, { turnId: turn.id, ...value });
        const queue = JSON.parse(readFileSync(process.env.TEST_RESPONSES, "utf8"));
        const response = queue.shift();
        writeFileSync(process.env.TEST_RESPONSES, JSON.stringify(queue));
        if (!response) {
          turn.status = "failed"; save();
          emitTurn("turn/completed", { turn: { ...turn, error: { message: "Unexpected native prompt" } } });
          return;
        }
        if (response.tool) {
          try {
            await callTool(turn, "assistant_action_contract", { actionId: response.tool.actionId, version: 1 });
            await callTool(turn, "assistant_action_execute", { actionId: response.tool.actionId, version: 1, input: response.tool.input });
          } catch (error) {
            // This probe retains actual native activity after the tool owner's
            // refusal. Only the original explicit Stop may settle this turn.
            if (response.mode === "active-tool-refusal") return;
            turn.status = "failed"; save();
            emitTurn("turn/completed", { turn: { ...turn, error: { message: error.message } } });
            return;
          }
        }
        // R06 variants change only the native wire/history supplied by this
        // executable. The actual driver decides whether any result is usable.
        if (response.mode === "disconnect") {
          log({ socketClosed: { threadId: thread.id, turnId: turn.id } });
          ws.close();
          return;
        }
        if (response.mode === "completion-before-delayed-final") {
          if (response.readDelayMs) {
            // The existing read-only contract tool waits for canonical input
            // admission before this fixture publishes native completion.
            await callTool(turn, "assistant_action_contract", { actionId: "vibe64.test.operate", version: 1 });
          }
          state.completionReadDelayMs = response.readDelayMs || 0;
          turn.status = "completed";
          save();
          emitTurn("turn/completed", { turn: { id: turn.id, status: turn.status } });
          setTimeout(() => {
            const answer = { id: "answer", type: "agentMessage", phase: "final_answer", text: response.text };
            turn.items.push(answer);
            save();
            emitTurn("item/completed", { item: answer });
          }, response.delayMs);
          return;
        }
        if (response.mode === "error-only-completed-no-turn-id") {
          turn.items.push({ id: "answer", type: "agentMessage", phase: "final_answer", text: response.text });
          turn.status = "completed";
          save();
          emit("error", { error: { message: "Controlled native provider error" }, willRetry: false });
          return;
        }
        if (response.mode === "error-only-active" || response.mode === "error-only-completed") {
          if (response.mode === "error-only-completed") {
            turn.items.push({ id: "answer", type: "agentMessage", phase: "final_answer", text: response.text });
            turn.status = "completed";
          }
          save();
          // No final item, turn/completed or idle notification supplies this
          // outcome. The original non-retrying error is the only wake signal.
          emitTurn("error", { error: { message: "Controlled native provider error" }, willRetry: false });
          return;
        }
        if (response.mode === "retrying-error") {
          emitTurn("error", { error: { message: "Controlled native provider error" }, willRetry: true });
        } else if (response.mode === "foreign-turn-error") {
          emit("error", { turnId: "another-turn", error: { message: "Controlled native provider error" }, willRetry: false });
        } else if (response.mode === "late-old-turn-error") {
          emit("error", { turnId: thread.turns.at(-2).id,
            error: { message: "Controlled native provider error" }, willRetry: false });
        }
        if (response.mode === "failed" || response.mode === "foreign-completed") {
          turn.status = "failed";
          if (response.mode === "foreign-completed") {
            thread.turns.push({ id: randomUUID(), status: "completed", items: [
              { id: "foreign-user", type: "userMessage", clientId: "foreign-user", content: [{ type: "text", text: "Another request" }] },
              { id: "foreign-answer", type: "agentMessage", phase: "final_answer", text: response.text }
            ] });
          }
          save();
          emitTurn("turn/completed", { turn: { id: turn.id, status: turn.status, error: { message: "Controlled native failure" } } });
          return;
        }
        const phase = "final_answer";
        if (response.mode === "history-final" || response.mode === "history-completed") {
          turn.items.push({ id: "answer", type: "agentMessage", phase, text: response.text });
          turn.status = "completed";
          save();
          if (response.mode === "history-final") {
            emitTurn("turn/completed", { turn: { id: turn.id, status: turn.status } });
          } else {
            emit("thread/status/changed", { status: { type: "idle" } });
          }
          return;
        }
        emitTurn("item/started", { item: { id: "answer", type: "agentMessage", phase } });
        emitTurn("item/reasoning/summaryTextDelta", { itemId: "reasoning", delta: "Reasoning" });
        emitTurn("item/reasoning/summaryTextDelta", { itemId: "reasoning", delta: " summary" });
        emitTurn("item/agentMessage/delta", { itemId: "answer", delta: response.text });
        const answer = { id: "answer", type: "agentMessage", phase, text: response.text };
        turn.items.push(answer);
        emitTurn("item/completed", { item: answer });
        turn.status = "completed"; save();
        emitTurn("turn/completed", { turn });
        return;
      }
      ws.send(JSON.stringify({ id, error: { code: -32601, message: "Unsupported method: " + method } }));
    }));
    server.listen(socket);
  `, { mode: 0o700 });
  await writeFile(claude, `#!${process.execPath}
    import { createInterface } from "node:readline";
    import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
    import path from "node:path";
    const args = process.argv.slice(2);
    const option = name => args[args.indexOf(name) + 1];
    const log = value => appendFileSync(process.env.TEST_TRACE, JSON.stringify(value) + "\\n");
    const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
    log({ args, routing: Object.fromEntries(["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_AUTO_COMPACT_WINDOW"].map(key => [key, process.env[key]])) });
    if (args[0] === "auth") {
      emit({ loggedIn: true, authMethod: "claude.ai", email: readFileSync(process.env.TEST_ACCOUNT, "utf8") });
      process.exit(0);
    }
    const id = option(args.includes("--resume") ? "--resume" : "--session-id");
    const project = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", process.cwd().replace(/[^a-zA-Z0-9]/gu, "-"));
    mkdirSync(project, { recursive: true });
    const record = frame => appendFileSync(path.join(project, id + ".jsonl"), JSON.stringify(frame) + "\\n");
    createInterface({ input: process.stdin }).on("line", async line => {
      const frame = JSON.parse(line);
      log({ frame });
      if (frame.type === "control_request") {
        if (frame.request.subtype === "initialize" && process.env.TEST_STARTUP_WAIT) return;
        const reject = frame.request.subtype === "apply_flag_settings" && process.env.TEST_REJECT_EFFORT && frame.request.settings.effortLevel === process.env.TEST_REJECT_EFFORT;
        emit({ type: "control_response", response: { request_id: frame.request_id,
          subtype: reject ? "error" : "success", error: reject ? "Settings rejected" : undefined, response: {} } });
        if (frame.request.subtype === "interrupt") emit({ type: "result", subtype: "success", terminal_reason: "aborted_streaming", result: "" });
        return;
      }
      record(frame);
      const queue = JSON.parse(readFileSync(process.env.TEST_RESPONSES, "utf8"));
      const response = queue.shift();
      writeFileSync(process.env.TEST_RESPONSES, JSON.stringify(queue));
      emit(frame);
      if (!response) {
        emit({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Unexpected native prompt"] });
        return;
      }
      const answer = { type: "assistant", uuid: frame.uuid + "-answer", message: { content: [{ type: "text", text: response.text }] } };
      emit({ type: "stream_event", event: { type: "message_start", message: { id: frame.uuid + "-stream" } } });
      emit({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
      emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: answer.message.content[0].text.slice(0, 8) } } });
      emit({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
      answer.message.id = frame.uuid + "-stream";
      const thinking = { type: "assistant", uuid: frame.uuid + "-thinking", message: { content: [{ type: "thinking", thinking: "Reasoning summary" }] } };
      record(thinking); emit(thinking);
      record(answer); emit(answer);
      emit({ type: "result", subtype: "success", result: answer.message.content[0].text });
    });
  `, { mode: 0o700 });
  return {
    async enqueue(responses) { await writeFile(queue, JSON.stringify(responses)); },
    host(scope) {
      return { workdir: scope.workdir, stateDirectory: scope.runtimeRoot, runtimeDirectory: directory,
        // Omitted execution uses the original standalone local native owner.
        env: { ...process.env, HOME: directory, CODEX_HOME: path.join(directory, "codex"),
          CLAUDE_CONFIG_DIR: path.join(directory, "claude"), ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: "",
          CLAUDE_CODE_OAUTH_TOKEN: "", TEST_ACCOUNT: account, TEST_TRACE: trace, TEST_RESPONSES: queue,
          TEST_HISTORY: path.join(directory, "codex-history.json") },
        commands: { codex, claude } };
    },
    async trace() {
      try { return (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    }
  };
}
