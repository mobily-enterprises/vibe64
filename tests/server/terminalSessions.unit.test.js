import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../server/lib/terminalSessions.js";

function longRunningNodeArgs() {
  return [
    "-e",
    "process.stdin.resume(); setInterval(() => {}, 1000);"
  ];
}

test("terminal sessions reuse one running terminal per namespace and enforce a running cap", async () => {
  const prefix = `terminal-test-${crypto.randomUUID()}:`;
  const closedTerminalIds = [];

  function start(namespace) {
    return startTerminalSession({
      args: ({ id }) => {
        assert.ok(id);
        return longRunningNodeArgs();
      },
      command: process.execPath,
      commandPreview: ({ id }) => `node ${id}`,
      maxRunning: 3,
      namespace,
      namespaceLimitPrefix: prefix,
      onClose: ({ id }) => {
        closedTerminalIds.push(id);
      },
      reuseRunning: true
    });
  }

  try {
    const first = start(`${prefix}one`);
    assert.equal(first.ok, true);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 1);

    const reused = start(`${prefix}one`);
    assert.equal(reused.ok, true);
    assert.equal(reused.id, first.id);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 1);

    const second = start(`${prefix}two`);
    const third = start(`${prefix}three`);
    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 3);

    const blocked = start(`${prefix}four`);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "terminal_limit");

    const closed = await closeTerminalSession(first.id, {
      namespace: `${prefix}one`
    });
    assert.equal(closed.closed, true);
    assert.deepEqual(closedTerminalIds, [first.id]);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 2);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(prefix);
  }
});

test("terminal sessions stream PTY output to subscribers", async () => {
  const namespace = `terminal-stream-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-e",
      "process.stdin.on('data', (chunk) => process.stdout.write(`echo:${chunk}`)); process.stdin.resume();"
    ],
    command: process.execPath,
    commandPreview: "node echo",
    namespace
  });
  const messages = [];

  try {
    const subscription = subscribeTerminalSession(session.id, (message) => {
      messages.push(message);
    }, {
      namespace
    });
    assert.equal(subscription.ok, true);

    writeTerminalSession(session.id, "hello\n", {
      namespace
    });

    await assert.doesNotReject(waitFor(() => messages.some((message) =>
      message.type === "output" && String(message.chunk || "").includes("echo:hello")
    )));
    subscription.unsubscribe();
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for terminal output."));
      }
    }, intervalMs);
  });
}
