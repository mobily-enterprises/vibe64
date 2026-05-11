import crypto from "node:crypto";
import { spawn as spawnPty } from "node-pty";

const MAX_BUFFER_LENGTH = 160000;
const sessions = new Map();

function trimBuffer(output) {
  if (output.length <= MAX_BUFFER_LENGTH) {
    return output;
  }
  return output.slice(output.length - MAX_BUFFER_LENGTH);
}

function startTerminalSession({
  args,
  command,
  commandPreview,
  cwd = process.cwd()
}) {
  const id = crypto.randomUUID();
  const terminal = spawnPty(command, args, {
    cols: 100,
    cwd,
    env: process.env,
    name: "xterm-color",
    rows: 28
  });

  const session = {
    id,
    commandPreview,
    exitCode: null,
    output: "",
    status: "running",
    terminal
  };

  terminal.onData((data) => {
    session.output = trimBuffer(session.output + data);
  });

  terminal.onExit(({ exitCode }) => {
    session.exitCode = exitCode;
    session.status = "exited";
  });

  sessions.set(id, session);
  return readTerminalSession(id);
}

function readTerminalSession(id) {
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }

  return {
    ok: true,
    id: session.id,
    commandPreview: session.commandPreview,
    exitCode: session.exitCode,
    output: session.output,
    status: session.status
  };
}

function writeTerminalSession(id, data) {
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: false,
      error: "Terminal session not found."
    };
  }
  if (session.status !== "running") {
    return readTerminalSession(id);
  }

  session.terminal.write(String(data || ""));
  return readTerminalSession(id);
}

function closeTerminalSession(id) {
  const session = sessions.get(id);
  if (!session) {
    return {
      ok: true,
      closed: false
    };
  }

  if (session.status === "running") {
    session.terminal.kill();
  }
  sessions.delete(id);

  return {
    ok: true,
    closed: true
  };
}

export {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
};
