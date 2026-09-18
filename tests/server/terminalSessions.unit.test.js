import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_TERMINAL_BUFFER_LENGTH,
  MAX_TERMINAL_BUFFER_ROWS,
  beginTerminalNamespaceOperation,
  closeDetachedTerminalSessions,
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  freezeTerminalNamespaceAdmission,
  listTerminalSessions,
  readTerminalSession,
  readTerminalSessionControlState,
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  terminalKeyInput,
  terminalMovementState,
  terminalSessionContainsText,
  thawTerminalNamespaceAdmission,
  writeTerminalSession,
  writeTerminalSessionKey,
  writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";

function longRunningNodeArgs() {
  return [
    "-e",
    "process.stdin.resume(); setInterval(() => {}, 1000);"
  ];
}

test("terminal session callbacks receive resolved env", async () => {
  const namespace = `terminal-env-test-${crypto.randomUUID()}`;
  const seen = {};
  const session = startTerminalSession({
    args: ({ env }) => {
      seen.argsEnv = env;
      return ["-e", ""];
    },
    command: process.execPath,
    commandPreview: ({ env }) => `node env=${env.EXAMPLE_VALUE}`,
    env: {
      EXAMPLE_VALUE: "available"
    },
    metadata: ({ env }) => ({
      exampleValue: env.EXAMPLE_VALUE
    }),
    namespace
  });

  try {
    assert.equal(session.ok, true);
    assert.equal(session.commandPreview, "node env=available");
    assert.equal(session.metadata.exampleValue, "available");
    assert.equal(seen.argsEnv.EXAMPLE_VALUE, "available");
  } finally {
    await closeTerminalSession(session.id, {
      namespace
    });
  }
});

test("terminal sessions retain a bounded output buffer", () => {
  assert.equal(MAX_TERMINAL_BUFFER_LENGTH, 256 * 1024);
  assert.equal(MAX_TERMINAL_BUFFER_ROWS, 300);
});

test("terminal sessions retain only the latest 300 output rows", async () => {
  const namespace = `terminal-output-rows-${crypto.randomUUID()}`;
  const lines = Array.from({
    length: MAX_TERMINAL_BUFFER_ROWS + 20
  }, (_value, index) => `line-${index + 1}`);
  const session = startTerminalSession({
    args: [
      "-e",
      `process.stdout.write(${JSON.stringify(lines.join("\n"))});`
    ],
    command: process.execPath,
    commandPreview: "node rows",
    namespace
  });

  try {
    await waitFor(() => readTerminalSession(session.id, {
      namespace
    }).status === "exited");
    const output = readTerminalSession(session.id, {
      namespace
    }).output;

    assert.doesNotMatch(output, /line-20\r?\n/u);
    assert.match(output, /line-21\r?\n/u);
    assert.match(output, /line-320/u);
    assert.ok(output.split(/\r?\n/u).length <= MAX_TERMINAL_BUFFER_ROWS);
  } finally {
    await closeTerminalSession(session.id, {
      namespace
    });
  }
});

test("terminal sessions identify a missing server terminal structurally", () => {
  assert.deepEqual(readTerminalSession("missing", {
    namespace: `terminal-missing-${crypto.randomUUID()}`
  }), {
    code: "terminal_session_not_found",
    error: "Terminal session not found.",
    ok: false
  });
});

test("terminal session snapshots can opt into bounded output", async () => {
  const namespace = `terminal-output-limit-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-e",
      "process.stdout.write('abcdef'); process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node output",
    namespace
  });

  try {
    await waitFor(() => readTerminalSession(session.id, { namespace }).output.includes("abcdef"));

    const fullSnapshot = readTerminalSession(session.id, { namespace });
    assert.equal(fullSnapshot.output, "abcdef");
    assert.equal(fullSnapshot.outputTruncated, false);

    const limitedSnapshot = readTerminalSession(session.id, {
      namespace,
      outputLimit: 3
    });
    assert.equal(limitedSnapshot.output, "def");
    assert.equal(limitedSnapshot.outputTruncated, true);

    const subscription = subscribeTerminalSession(session.id, () => null, {
      namespace,
      outputLimit: 2
    });
    try {
      assert.equal(subscription.output, "ef");
      assert.equal(subscription.outputTruncated, true);
    } finally {
      subscription.unsubscribe();
    }
  } finally {
    await closeTerminalSession(session.id, {
      namespace
    });
  }
});

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
      metadata: {
        url: "http://127.0.0.1:4100/"
      },
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
    assert.equal(first.metadata.url, "http://127.0.0.1:4100/");
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 1);

    const reused = start(`${prefix}one`);
    assert.equal(reused.ok, true);
    assert.equal(reused.id, first.id);
    assert.equal(reused.metadata.url, first.metadata.url);
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

test("terminal session running cap can be scoped by metadata", async () => {
  const namespace = `terminal-filtered-cap-test-${crypto.randomUUID()}`;

  function start(owner) {
    return startTerminalSession({
      args: longRunningNodeArgs(),
      command: process.execPath,
      commandPreview: "node long-running",
      maxRunning: 1,
      metadata: {
        owner
      },
      namespace,
      runningLimitFilter: (session) => session.metadata?.owner === owner
    });
  }

  try {
    const firstOwner = start("first");
    assert.equal(firstOwner.ok, true);
    assert.equal(countRunningTerminalSessions({
      filter: (session) => session.metadata?.owner === "first",
      namespacePrefix: namespace
    }), 1);

    const secondOwner = start("second");
    assert.equal(secondOwner.ok, true);
    assert.equal(countRunningTerminalSessions({
      filter: (session) => session.metadata?.owner === "second",
      namespacePrefix: namespace
    }), 1);

    const blockedFirstOwner = start("first");
    assert.equal(blockedFirstOwner.ok, false);
    assert.equal(blockedFirstOwner.code, "terminal_limit");
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal session running cap defaults to the current namespace", async () => {
  const prefix = `terminal-namespace-cap-test-${crypto.randomUUID()}:`;
  const namespaceOne = `${prefix}one`;
  const namespaceTwo = `${prefix}two`;

  function start(namespace) {
    return startTerminalSession({
      args: longRunningNodeArgs(),
      command: process.execPath,
      commandPreview: "node long-running",
      maxRunning: 3,
      namespace
    });
  }

  try {
    assert.equal(start(namespaceOne).ok, true);
    assert.equal(start(namespaceOne).ok, true);
    assert.equal(start(namespaceOne).ok, true);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: namespaceOne }), 3);

    const blockedInSameNamespace = start(namespaceOne);
    assert.equal(blockedInSameNamespace.ok, false);
    assert.equal(blockedInSameNamespace.code, "terminal_limit");

    const allowedInAnotherNamespace = start(namespaceTwo);
    assert.equal(allowedInAnotherNamespace.ok, true);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: namespaceTwo }), 1);
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

test("terminal namespace operations and renewal freeze are atomic", () => {
  const namespace = `terminal-operation-test-${crypto.randomUUID()}`;
  const owner = `renewal:${crypto.randomUUID()}`;
  const operation = beginTerminalNamespaceOperation(namespace);
  assert.equal(operation.ok, true);
  assert.deepEqual(freezeTerminalNamespaceAdmission(namespace, { owner }), {
    code: "terminal_admission_busy",
    error: "A terminal operation is still finishing.",
    ok: false
  });

  operation.release();
  operation.release();
  assert.equal(freezeTerminalNamespaceAdmission(namespace, { owner }).ok, true);
  assert.deepEqual(beginTerminalNamespaceOperation(namespace), {
    code: "terminal_admission_frozen",
    error: "Terminal input is temporarily unavailable.",
    ok: false
  });
  assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
});

test("a frozen terminal namespace rejects input and close awaits process exit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-terminal-freeze-"));
  const sentinelPath = path.join(root, "sentinel.txt");
  const namespace = `terminal-freeze-test-${crypto.randomUUID()}`;
  const owner = `renewal:${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-e",
      [
        "const fs = require('node:fs');",
        "const sentinel = process.argv[1];",
        "console.log(`READY:${process.pid}`);",
        "process.stdin.on('data', (chunk) => fs.appendFileSync(sentinel, chunk));",
        "process.stdin.resume();",
        "setInterval(() => {}, 1000);"
      ].join(" "),
      sentinelPath
    ],
    command: process.execPath,
    commandPreview: "node terminal freeze sentinel",
    namespace
  });

  try {
    await waitFor(() => /READY:\d+/u.test(readTerminalSession(session.id, { namespace }).output));
    const pid = Number(/READY:(\d+)/u.exec(
      readTerminalSession(session.id, { namespace }).output
    )?.[1]);
    assert.ok(Number.isSafeInteger(pid) && pid > 1);

    assert.equal(writeTerminalSession(session.id, "before\n", { namespace }).ok, true);
    await waitFor(() => existsSync(sentinelPath) && readFileSync(sentinelPath, "utf8") === "before\n");

    assert.deepEqual(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }), {
      frozen: true,
      namespace,
      ok: true,
      owner
    });
    assert.deepEqual(writeTerminalSession(session.id, "after\n", { namespace }), {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      ok: false
    });
    assert.deepEqual(startTerminalSession({
      args: longRunningNodeArgs(),
      command: process.execPath,
      commandPreview: "node rejected after freeze",
      namespace
    }), {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      ok: false
    });

    assert.deepEqual(await closeTerminalSessionsForNamespace(namespace), {
      closed: 1,
      ok: true
    });
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.equal(readFileSync(sentinelPath, "utf8"), "before\n");
  } finally {
    thawTerminalNamespaceAdmission(namespace, { owner });
    await closeTerminalSessionsForNamespacePrefix(namespace);
    await rm(root, { force: true, recursive: true });
  }
});

test("bulk shutdown stops terminals across namespaces concurrently and idempotently", async () => {
  const namespacePrefix = `terminal-concurrent-close-${crypto.randomUUID()}`;
  const stopStarts = [];
  let releaseHeldStop = () => null;
  const heldStop = new Promise((resolve) => {
    releaseHeldStop = resolve;
  });
  const specifications = [{
    label: "held",
    namespace: `${namespacePrefix}:one`
  }, {
    label: "same-namespace",
    namespace: `${namespacePrefix}:one`
  }, {
    label: "other-namespace",
    namespace: `${namespacePrefix}:two`
  }];
  const sessions = specifications.map(({ label, namespace }) => startTerminalSession({
    args: [
      "-e",
      `console.log('PID:${label}:' + process.pid); process.stdin.resume(); setInterval(() => {}, 1000);`
    ],
    command: process.execPath,
    commandPreview: `node concurrent close ${label}`,
    namespace,
    async onStop() {
      stopStarts.push(label);
      if (label === "held") {
        await heldStop;
      }
    }
  }));
  const closing = [];

  try {
    await Promise.all(sessions.map(async (session, index) => {
      const { label, namespace } = specifications[index];
      await waitFor(() => readTerminalSession(session.id, { namespace }).output.includes(
        `PID:${label}:`
      ));
    }));
    const pids = sessions.map((session, index) => {
      const { label, namespace } = specifications[index];
      return Number(new RegExp(`PID:${label}:(\\d+)`, "u").exec(
        readTerminalSession(session.id, { namespace }).output
      )?.[1]);
    });
    assert.equal(pids.every((pid) => Number.isSafeInteger(pid) && pid > 1), true);

    let bulkCloseSettled = false;
    closing.push(closeTerminalSessionsForNamespacePrefix(namespacePrefix).finally(() => {
      bulkCloseSettled = true;
    }));
    closing.push(closeTerminalSessionsForNamespacePrefix(namespacePrefix));
    await waitFor(() => stopStarts.length === specifications.length);

    assert.deepEqual([...stopStarts].sort(), specifications.map(({ label }) => label).sort());
    await waitFor(() => pids.every((pid) => !processIsAlive(pid)), {
      timeoutMs: 2500
    });
    assert.equal(bulkCloseSettled, false);

    releaseHeldStop();
    const results = await Promise.all(closing);
    assert.deepEqual(results, [{
      closed: 3,
      ok: true
    }, {
      closed: 3,
      ok: true
    }]);
    assert.equal(pids.every((pid) => !processIsAlive(pid)), true);
    assert.equal(sessions.every((session, index) => readTerminalSession(
      session.id,
      { namespace: specifications[index].namespace }
    ).ok === false), true);
  } finally {
    releaseHeldStop();
    await Promise.allSettled(closing);
    await closeTerminalSessionsForNamespacePrefix(namespacePrefix);
  }
});

test("terminal close stops its process tree but stays pending until stop cleanup completes", async () => {
  const namespace = `terminal-stop-cleanup-${crypto.randomUUID()}`;
  let releaseStopHook = () => null;
  const heldStopHook = new Promise((resolve) => {
    releaseStopHook = resolve;
  });
  const session = startTerminalSession({
    args: [
      "-lc",
      `"${process.execPath}" -e 'process.stdin.resume(); setInterval(() => {}, 1000);' & ` +
        "child=$!; printf 'SHELL:%s CHILD:%s\\n' \"$$\" \"$child\"; wait \"$child\""
    ],
    command: "bash",
    commandPreview: "bash with held stop hook",
    namespace,
    async onStop({ setPhase }) {
      setPhase("held-stop");
      await heldStopHook;
    }
  });

  try {
    await waitFor(() => /SHELL:\d+ CHILD:\d+/u.test(
      readTerminalSession(session.id, { namespace }).output
    ));
    const processIds = /SHELL:(\d+) CHILD:(\d+)/u.exec(
      readTerminalSession(session.id, { namespace }).output
    ).slice(1).map(Number);
    let settled = false;
    const closing = closeTerminalSession(session.id, { namespace }).finally(() => { settled = true; });
    const concurrentClose = closeTerminalSession(session.id, { namespace });
    await waitFor(() => processIds.every((pid) => !processIsAlive(pid)));
    // Exceed the former five-second deadline while required cleanup is held.
    await new Promise((resolve) => setTimeout(resolve, 5200));
    assert.equal(settled, false);
    const pending = readTerminalSession(session.id, { namespace });
    assert.equal(pending.status, "closing");
    assert.equal(pending.closeError, "");
    assert.equal(countRunningTerminalSessions({ namespace }), 1);

    releaseStopHook();
    assert.deepEqual(await closing, { closed: true, ok: true });
    assert.deepEqual(await concurrentClose, { closed: true, ok: true });
  } finally {
    releaseStopHook();
    await closeTerminalSessionsForNamespacePrefix(namespace).catch(() => null);
  }
});

test("terminal close escalates signals when the child ignores graceful termination", async () => {
  const namespace = `terminal-resistant-child-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: ["-e", "process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}); console.log(`PID:${process.pid}`); setInterval(() => {}, 1000);"],
    command: process.execPath,
    namespace
  });
  try {
    await waitFor(() => /PID:\d+/u.test(readTerminalSession(session.id, { namespace }).output));
    const pid = Number(/PID:(\d+)/u.exec(readTerminalSession(session.id, { namespace }).output)[1]);
    assert.deepEqual(await closeTerminalSession(session.id, { namespace }), { closed: true, ok: true });
    assert.equal(processIsAlive(pid), false);
    assert.equal(readTerminalSession(session.id, { namespace }).ok, false);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal close stays pending until finalization completes, with no elapsed-time failure", async () => {
  const namespace = `terminal-close-cleanup-${crypto.randomUUID()}`;
  let releaseCloseHook = () => null;
  const heldCloseHook = new Promise((resolve) => {
    releaseCloseHook = resolve;
  });
  const session = startTerminalSession({
    args: [
      "-e",
      "console.log(`PID:${process.pid}`); process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node held close hook",
    namespace,
    async onClose({ setPhase }) {
      setPhase("held-finalization");
      await heldCloseHook;
    }
  });

  try {
    await waitFor(() => /PID:\d+/u.test(readTerminalSession(session.id, { namespace }).output));
    const pid = Number(/PID:(\d+)/u.exec(readTerminalSession(session.id, { namespace }).output)?.[1]);

    let settled = false;
    const closing = closeTerminalSession(session.id, { namespace }).finally(() => { settled = true; });
    await waitFor(() => !processIsAlive(pid));
    await new Promise((resolve) => setTimeout(resolve, 5200));
    assert.equal(settled, false);
    const pending = readTerminalSession(session.id, { namespace });
    assert.equal(pending.status, "closing");
    assert.equal(pending.closeError, "");
    assert.equal(countRunningTerminalSessions({ namespace }), 1);

    releaseCloseHook();
    assert.deepEqual(await closing, { closed: true, ok: true });
  } finally {
    releaseCloseHook();
    await closeTerminalSessionsForNamespacePrefix(namespace).catch(() => null);
  }
});

test("terminal close kills the child and reports a rejected stop hook", async () => {
  const namespace = `terminal-stop-rejection-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-e",
      "console.log(`PID:${process.pid}`); process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node rejected stop hook",
    namespace,
    async onStop() {
      throw new Error("stop cleanup rejected");
    }
  });

  try {
    await waitFor(() => /PID:\d+/u.test(readTerminalSession(session.id, { namespace }).output));
    const pid = Number(/PID:(\d+)/u.exec(readTerminalSession(session.id, { namespace }).output)?.[1]);

    assert.deepEqual(await closeTerminalSession(session.id, {
      namespace
    }), {
      closed: true,
      cleanupErrors: ["stop cleanup rejected"],
      ok: true
    });
    assert.equal(processIsAlive(pid), false);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace).catch(() => null);
  }
});

test("terminal sessions record input and output byte activity", async () => {
  const namespace = `terminal-activity-test-${crypto.randomUUID()}`;
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
    assert.equal(session.inputVersion, 0);
    assert.equal(session.outputVersion, 0);
    assert.equal(session.lastInputAt, "");
    assert.equal(session.lastOutputAt, "");

    const subscription = subscribeTerminalSession(session.id, (message) => {
      messages.push(message);
    }, {
      namespace
    });
    assert.equal(subscription.ok, true);

    const written = writeTerminalSession(session.id, "hello\n", {
      namespace
    });
    assert.equal(written.inputVersion, 1);
    assert.ok(Date.parse(written.lastInputAt));
    assert.equal(written.lastInputBytes, Buffer.byteLength("hello\n"));

    await waitFor(() => readTerminalSession(session.id, { namespace }).output.includes("echo:hello"));
    const snapshot = readTerminalSession(session.id, { namespace });
    assert.ok(Date.parse(snapshot.lastOutputAt));
    assert.ok(snapshot.lastOutputBytes > 0);
    assert.ok(snapshot.outputVersion > 0);
    assert.equal(messages.some((message) => message.type === "input"), false);
    assert.ok(messages.some((message) =>
      message.type === "output" &&
      message.outputVersion > 0 &&
      Date.parse(message.lastOutputAt)
    ));
    subscription.unsubscribe();
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions close detached terminals after the idle threshold", async () => {
  const namespace = `terminal-detached-cleanup-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: longRunningNodeArgs(),
    command: process.execPath,
    commandPreview: "node detached",
    namespace
  });

  try {
    const retained = await closeDetachedTerminalSessions({
      idleMs: 1000,
      namespace,
      now: Date.now()
    });
    assert.deepEqual(retained, {
      ok: true,
      closed: 0
    });
    assert.equal(readTerminalSession(session.id, { namespace }).ok, true);

    const closed = await closeDetachedTerminalSessions({
      idleMs: 0,
      namespace,
      now: Date.now()
    });
    assert.deepEqual(closed, {
      ok: true,
      closed: 1
    });
    assert.equal(readTerminalSession(session.id, { namespace }).ok, false);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions do not close subscribed terminals during detached cleanup", async () => {
  const namespace = `terminal-detached-subscribed-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: longRunningNodeArgs(),
    command: process.execPath,
    commandPreview: "node subscribed",
    namespace
  });

  try {
    const subscription = subscribeTerminalSession(session.id, () => null, {
      namespace
    });
    assert.equal(subscription.ok, true);

    const closed = await closeDetachedTerminalSessions({
      idleMs: 0,
      namespace,
      now: Date.now()
    });
    assert.deepEqual(closed, {
      ok: true,
      closed: 0
    });
    assert.equal(readTerminalSession(session.id, { namespace }).ok, true);
    subscription.unsubscribe();
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions schedule detached idle cleanup for opted-in terminals", async () => {
  const namespace = `terminal-detached-scheduled-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: longRunningNodeArgs(),
    command: process.execPath,
    commandPreview: "node scheduled cleanup",
    detachedIdleTimeoutMs: 25,
    namespace
  });

  try {
    await waitFor(() => readTerminalSession(session.id, { namespace }).ok === false);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions prune exited records after detached idle cleanup", async () => {
  const namespace = `terminal-detached-exited-test-${crypto.randomUUID()}`;
  let markExited = () => null;
  const exited = new Promise((resolve) => {
    markExited = resolve;
  });
  const session = startTerminalSession({
    args: ["-e", ""],
    command: process.execPath,
    commandPreview: "node exits",
    detachedIdleTimeoutMs: 100,
    namespace
  });
  const subscription = subscribeTerminalSession(session.id, (message) => {
    if (message.type === "status" && message.status === "exited") {
      markExited();
    }
  }, {
    namespace
  });
  let unsubscribe = subscription.unsubscribe;

  try {
    assert.equal(subscription.ok, true);
    await exited;
    assert.equal(readTerminalSession(session.id, { namespace }).status, "exited");

    unsubscribe();
    unsubscribe = () => null;
    const cleaned = await closeDetachedTerminalSessions({
      namespace,
      now: Date.now() + 100
    });
    assert.deepEqual(cleaned, {
      ok: true,
      closed: 1
    });
    assert.equal(readTerminalSession(session.id, { namespace }).ok, false);
  } finally {
    unsubscribe();
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal session control helpers send exact text, narrow keys, and expose quiet state", async () => {
  const namespace = `terminal-control-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-e",
      "process.stdin.on('data', (chunk) => process.stdout.write(`echo:${chunk}`)); process.stdin.resume();"
    ],
    command: process.execPath,
    commandPreview: "node echo",
    namespace
  });

  try {
    assert.equal(terminalKeyInput("escape"), "\u001b");
    assert.equal(terminalKeyInput("ctrl_c"), "\u0003");
    assert.equal(terminalKeyInput("delete"), "");

    const written = await writeTerminalSessionText(session.id, "hello\n", {
      namespace
    });
    assert.equal(written.ok, true);
    assert.equal(written.inputVersion, 1);

    await waitFor(() => readTerminalSession(session.id, { namespace }).output.includes("echo:hello"));
    const snapshot = readTerminalSessionControlState(session.id, {
      namespace
    });
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.lastMovementDirection, "output");
    assert.equal(terminalSessionContainsText(snapshot, "echo:hello").containsText, true);
    assert.equal(terminalSessionContainsText(snapshot, "missing").containsText, false);

    const keyWritten = writeTerminalSessionKey(session.id, "enter", {
      namespace
    });
    assert.equal(keyWritten.ok, true);
    assert.equal(keyWritten.inputVersion, 2);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal session text helper writes long text in one input write", async () => {
  const namespace = `terminal-single-write-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-e",
      [
        "process.stdin.setRawMode(true);",
        "let received = '';",
        "process.stdin.on('data', (chunk) => {",
        "  received += chunk.toString('utf8');",
        "  if (received.includes('\\n')) {",
        "    process.stdout.write(`received:${Buffer.byteLength(received, 'utf8')}`);",
        "  }",
        "});",
        "process.stdin.resume();"
      ].join(" ")
    ],
    command: process.execPath,
    commandPreview: "node raw echo",
    namespace
  });

  try {
    const text = `${"a".repeat(201)}\n`;
    const written = await writeTerminalSessionText(session.id, text, {
      namespace
    });
    assert.equal(written.ok, true);
    assert.equal(written.inputVersion, 1);

    await waitFor(() => readTerminalSession(session.id, {
      namespace
    }).output.includes("received:202"));
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal movement state treats input and output as activity for quiet checks", () => {
  const now = Date.now();
  const oldTimestamp = new Date(now - 4000).toISOString();
  const freshTimestamp = new Date(now - 500).toISOString();

  assert.deepEqual(terminalMovementState({
    createdAt: oldTimestamp,
    lastInputAt: "",
    lastOutputAt: ""
  }, {
    now,
    quietThresholdMs: 3000
  }), {
    idleForMs: 4000,
    lastMovementAt: oldTimestamp,
    lastMovementDirection: "created",
    quiet: true,
    quietThresholdMs: 3000
  });

  const activeState = terminalMovementState({
    createdAt: oldTimestamp,
    lastInputAt: freshTimestamp,
    lastOutputAt: oldTimestamp
  }, {
    now,
    quietThresholdMs: 3000
  });
  assert.equal(activeState.quiet, false);
  assert.equal(activeState.lastMovementDirection, "input");
});

test("terminal sessions resize the running PTY", async () => {
  const namespace = `terminal-resize-test-${crypto.randomUUID()}`;
  const session = startTerminalSession({
    args: [
      "-lc",
      "stty size; IFS= read -r _; stty size; sleep 1"
    ],
    command: "bash",
    commandPreview: "bash stty size",
    namespace
  });

  try {
    assert.equal(session.ok, true);
    await waitFor(() => /28\s+100/u.test(readTerminalSession(session.id, { namespace }).output));

    const resized = resizeTerminalSession(session.id, {
      cols: 123,
      rows: 41
    }, {
      namespace
    });
    assert.equal(resized.ok, true);
    assert.equal(resized.cols, 123);
    assert.equal(resized.rows, 41);

    writeTerminalSession(session.id, "\n", {
      namespace
    });

    await waitFor(() => /41\s+123/u.test(readTerminalSession(session.id, { namespace }).output));
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions can update metadata from output hooks", async () => {
  const namespace = `terminal-metadata-test-${crypto.randomUUID()}`;
  const messages = [];

  const session = startTerminalSession({
    args: [
      "-e",
      "setTimeout(() => { console.log('READY_MARKER'); setInterval(() => {}, 1000); }, 25);"
    ],
    command: process.execPath,
    commandPreview: "node ready marker",
    namespace,
    onOutput({ output, updateMetadata }) {
      if (String(output || "").includes("READY_MARKER")) {
        updateMetadata({
          ready: true
        });
      }
    }
  });

  try {
    const subscription = subscribeTerminalSession(session.id, (message) => {
      messages.push(message);
    }, {
      namespace
    });
    assert.equal(subscription.ok, true);

    await waitFor(() => messages.some((message) =>
      message.type === "metadata" && message.metadata?.ready === true
    ));
    assert.equal(readTerminalSession(session.id, { namespace }).metadata.ready, true);
    subscription.unsubscribe();
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions report exited after close hooks finish", async () => {
  const namespace = `terminal-close-hook-test-${crypto.randomUUID()}`;
  let finishCloseHook;
  const closeHookFinished = new Promise((resolve) => {
    finishCloseHook = resolve;
  });
  const messages = [];

  const session = startTerminalSession({
    args: [
      "-e",
      "setTimeout(() => process.exit(0), 50);"
    ],
    command: process.execPath,
    commandPreview: "node delayed exit",
    namespace,
    onClose: async () => {
      await closeHookFinished;
    }
  });

  try {
    const subscription = subscribeTerminalSession(session.id, (message) => {
      messages.push(message);
    }, {
      namespace
    });
    assert.equal(subscription.ok, true);

    await waitFor(() => messages.some((message) =>
      message.type === "status" && message.status === "closing"
    ));
    assert.equal(readTerminalSession(session.id, { namespace }).status, "closing");
    assert.equal(messages.some((message) => message.type === "status" && message.status === "exited"), false);

    await new Promise((resolve) => setTimeout(resolve, 5200));
    assert.equal(readTerminalSession(session.id, { namespace }).status, "closing");
    assert.equal(messages.some((message) => message.type === "error" || message.status === "exited"), false);
    finishCloseHook();

    await waitFor(() => messages.some((message) =>
      message.type === "status" && message.status === "exited"
    ));
    assert.equal(readTerminalSession(session.id, { namespace }).status, "exited");
    subscription.unsubscribe();
  } finally {
    finishCloseHook();
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions can stop a process without deleting its log", async () => {
  const namespace = `terminal-stop-test-${crypto.randomUUID()}`;
  const closeReasons = [];
  const messages = [];
  const stopReasons = [];

  const session = startTerminalSession({
    args: [
      "-e",
      "console.log('terminal log kept'); process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node stoppable",
    namespace,
    onClose: async ({ reason }) => {
      closeReasons.push(reason);
    },
    onStop: async ({ reason }) => {
      stopReasons.push(reason);
    }
  });

  try {
    const subscription = subscribeTerminalSession(session.id, (message) => {
      messages.push(message);
    }, {
      namespace
    });
    assert.equal(subscription.ok, true);

    await waitFor(() => readTerminalSession(session.id, { namespace }).output.includes("terminal log kept"));

    const stopped = stopTerminalSession(session.id, { namespace });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.status, "closing");
    assert.equal(listTerminalSessions({ namespace }).some((item) => item.id === session.id), true);

    await waitFor(() => stopReasons.includes("stop"));
    await waitFor(() => messages.some((message) =>
      message.type === "status" && message.status === "exited"
    ));
    assert.deepEqual(closeReasons, ["stop"]);

    const snapshot = readTerminalSession(session.id, { namespace });
    assert.equal(snapshot.status, "exited");
    assert.match(snapshot.output, /terminal log kept/u);
    subscription.unsubscribe();

    const closed = await closeTerminalSession(session.id, { namespace });
    assert.equal(closed.closed, true);
    assert.equal(readTerminalSession(session.id, { namespace }).ok, false);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("terminal sessions surface close hook failures", async () => {
  const namespace = `terminal-close-hook-failure-test-${crypto.randomUUID()}`;
  const messages = [];

  const session = startTerminalSession({
    args: [
      "-e",
      "setTimeout(() => process.exit(0), 50);"
    ],
    command: process.execPath,
    commandPreview: "node failed finalizer",
    namespace,
    onClose: async () => {
      throw new Error("adoption failed");
    }
  });

  try {
    const subscription = subscribeTerminalSession(session.id, (message) => {
      messages.push(message);
    }, {
      namespace
    });
    assert.equal(subscription.ok, true);

    await waitFor(() => messages.some((message) =>
      message.type === "error" && String(message.error || "").includes("adoption failed")
    ));
    await waitFor(() => messages.some((message) =>
      message.type === "status" &&
      message.status === "exited" &&
      String(message.closeError || "").includes("adoption failed")
    ));

    const snapshot = readTerminalSession(session.id, { namespace });
    assert.equal(snapshot.status, "exited");
    assert.match(snapshot.closeError, /adoption failed/);
    assert.match(snapshot.output, /Terminal finalization failed: adoption failed/);
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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}
